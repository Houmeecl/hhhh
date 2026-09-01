import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import crypto from 'crypto';
import { queryCorredor, cerrarCorredor, corredorDisponible } from '../src/lib/dbCorredor.js';
import { runMigrationsCorredor } from '../src/lib/migrate.js';
import { firmarTokenCorredor, corredorConfigurado } from '../src/middleware/authCorredor.js';
import corredorApi from '../src/routes/corredorApi.js';
import { EN_PRODUCCION } from './util/soloDev.js';
import { limpiarCorredorPorEmpresa, limpiarUsuariosCorredor } from './util/limpiarCorredor.js';

// ============================================================
// Documentos exigidos POR TRAMO, por HTTP y contra la base del Corredor.
//
// Lo que se cuida acá:
//  1. Que el tramo cambie la lista. Un Campo Grande→Antofagasta y un
//     Calama→Antofagasta no piden lo mismo; si pidieran lo mismo, la
//     tabla `documentos_por_tramo` no serviría de nada.
//  2. Que sin tramo el semáforo sea GRIS, no rojo. Sin origen ni destino
//     no hay contra qué comparar.
//  3. Que la cadena de hash del Corredor sea la SUYA y quede encadenada.
//  4. Que el archivo NO se guarde: se sella el sha256 y nada más.
//  5. Que el aislamiento entre empresas siga valiendo también acá.
// ============================================================

const SIN_CORREDOR = EN_PRODUCCION
  ? 'NODE_ENV=production'
  : (corredorConfigurado() ? false : 'el Corredor no está configurado en este entorno');

const suf = crypto.randomBytes(3).toString('hex').toUpperCase();
let server; let baseUrl; let tkAdmin; let tkA; let tkB; let cargaA;

const pedir = async (m, p, tk, body) => {
  const r = await fetch(baseUrl + p, {
    method: m,
    headers: { ...(tk ? { Authorization: `Bearer ${tk}` } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, d: await r.json().catch(() => null) };
};

const subirArchivo = async (p, tk, { tipo, nombre, contenido, sha }) => {
  const fd = new FormData();
  fd.append('tipo_documento', tipo);
  if (sha) fd.append('sha256', sha);
  if (contenido != null) fd.append('archivo', new Blob([contenido]), nombre);
  else fd.append('archivo_original', nombre);
  const r = await fetch(baseUrl + p, { method: 'POST', headers: { Authorization: `Bearer ${tk}` }, body: fd });
  return { status: r.status, d: await r.json().catch(() => null) };
};

async function enrolarYEntrar(nombre, rut, email) {
  const alta = await pedir('POST', '/api/corredor/exportadores', tkAdmin,
    { nombre_empresa: nombre, rut, pais: 'BR', contacto_email: email });
  const login = await pedir('POST', '/api/corredor/auth/login', null,
    { email, password: alta.d.password_temporal });
  const cambio = await pedir('POST', '/api/corredor/auth/cambiar-password', login.d.access,
    { password: 'ClaveDePrueba1' });
  return cambio.d.access;
}

before(async () => {
  if (SIN_CORREDOR) return;
  await runMigrationsCorredor();
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/corredor', corredorApi);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const { rows } = await queryCorredor(
    `INSERT INTO usuarios_corredor (email,nombre,password_hash,rol,must_reset_password)
     VALUES ($1,'Admin de Prueba','x','admin',false) RETURNING *`, [`admin-tramo-${suf}@ejemplo.cl`]);
  tkAdmin = firmarTokenCorredor(rows[0]);

  tkA = await enrolarYEntrar(`Tramo A ${suf}`, `97${suf}111`, `a-tramo-${suf}@ejemplo.cl`);
  tkB = await enrolarYEntrar(`Tramo B ${suf}`, `97${suf}222`, `b-tramo-${suf}@ejemplo.cl`);

  const c = await pedir('POST', '/api/corredor/cargas', tkA,
    { codigo_nc: '1201', descripcion: `Soya ${suf}`, cantidad: 500, pais_origen: 'BR' });
  cargaA = c.d.carga;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (corredorDisponible()) {
    // Las cargas ANTES que el exportador: `cargas → exportadores` es la
    // única llave RESTRICT del Corredor. Ver test/util/limpiarCorredor.js.
    await limpiarCorredorPorEmpresa(`Tramo % ${suf}`);
    await limpiarUsuariosCorredor(`%-tramo-${suf}@ejemplo.cl`);
  }
  await cerrarCorredor();
});

test('el catálogo de puntos viene del Corredor, no de sicr3p', { skip: SIN_CORREDOR }, async () => {
  // '/catalogo/puntos' y no '/puntos': ese último lo atiende routes/public.js
  // —el catálogo del mapa de la torre, que sale de la OTRA base— y está
  // montado antes. Ver test/corredorRutasSinTapar.test.js.
  const r = await pedir('GET', '/api/corredor/catalogo/puntos', tkA);
  assert.equal(r.status, 200);
  assert.ok(r.d.puntos.length >= 14);
  assert.ok(r.d.puntos.some((p) => p.id === 'paso-de-jama' && p.es_frontera));
  // El catálogo son lugares fijos: no hay nada acá que diga dónde está una carga.
  assert.ok(r.d.puntos.every((p) => !('carga_id' in p)));
});

test('sin tramo definido, el semáforo documental es GRIS', { skip: SIN_CORREDOR }, async () => {
  const r = await pedir('GET', `/api/corredor/cargas/${cargaA.id}`, tkA);
  assert.equal(r.status, 200);
  assert.equal(r.d.documental.listo, null);
  assert.equal(r.d.documental.semaforo, 'gris');
  assert.equal(r.d.tramo, null);
});

test('definir el tramo cambia lo que se pide', { skip: SIN_CORREDOR }, async () => {
  const r = await pedir('PUT', `/api/corredor/cargas/${cargaA.id}/tramo`, tkA,
    { punto_origen: 'campo-grande', punto_destino: 'puerto-antofagasta' });
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.d.tramo.cruces.map((c) => `${c.pais_desde}→${c.pais_hasta}`), ['BR→PY', 'PY→AR', 'AR→CL']
  );
  const tipos = r.d.documental.items.map((i) => i.tipo_documento);
  assert.ok(tipos.includes('certificado_fitosanitario'), 'el cruce BR→PY lo exige');
  assert.equal(r.d.documental.semaforo, 'rojo', 'todavía no llegó ninguno');

  // EL CORREDOR SE INCORPORA UNA FRONTERA A LA VEZ (migración 004), y
  // Chile todavía no está. El cruce AR→CL se REPORTA como pendiente y no
  // exige nada: sus reglas están escritas pero nadie las contrastó contra
  // el SAG ni el SENASA. Presentarlas como obligación sería exactamente
  // lo que el resto del producto evita — no definido no es lo mismo que
  // faltante.
  assert.ok(
    !tipos.includes('declaracion_jurada_origen'),
    'el cruce AR→CL no está definido: no puede exigir nada'
  );
  assert.deepEqual(
    r.d.documental.cruces_pendientes.map((c) => c.cruce), ['AR→CL']
  );
  assert.match(r.d.documental.cruces_pendientes[0].nota, /Chile todav.a no est./,
    'y se dice POR QUÉ está pendiente: "todavía no está" sin motivo es una excusa');
});

test('con un cruce sin definir, el tramo NO puede darse por completo',
  { skip: SIN_CORREDOR }, async () => {
    // Aunque llegaran todos los documentos de los cruces ya definidos, el
    // tramo entero no se declara listo: nadie revisó qué pide el último
    // cruce. Un verde que no se puede sostener cuesta más caro que un gris.
    const c = await pedir('POST', '/api/corredor/cargas', tkA,
      { codigo_nc: '1201', descripcion: `Soya completa ${suf}`, cantidad: 20, pais_origen: 'BR' });
    const id = c.d.carga.id;
    await pedir('PUT', `/api/corredor/cargas/${id}/tramo`, tkA,
      { punto_origen: 'campo-grande', punto_destino: 'puerto-antofagasta' });

    const antes = await pedir('GET', `/api/corredor/cargas/${id}`, tkA);
    for (const tipo of antes.d.documental.items.filter((i) => i.obligatorio).map((i) => i.tipo_documento)) {
      await subirArchivo(`/api/corredor/cargas/${id}/documentos`, tkA,
        { tipo, nombre: `${tipo}.pdf`, contenido: `${tipo} de ${suf}` });
    }

    const r = await pedir('GET', `/api/corredor/cargas/${id}`, tkA);
    assert.equal(r.d.documental.faltantes.length, 0, 'no falta ninguno de los definidos');
    assert.equal(r.d.documental.listo, null, 'y aun así no está listo: queda un cruce sin definir');
    assert.equal(r.d.documental.semaforo, 'gris');
    assert.match(r.d.documental.glosa, /Est. todo lo de los cruces ya definidos/);
    assert.match(r.d.documental.glosa, /todav.a no est. incorporado en sicr3p/);
  });

test('un tramo sin fronteras pide menos que uno que cruza tres', { skip: SIN_CORREDOR }, async () => {
  const c = await pedir('POST', '/api/corredor/cargas', tkA,
    { codigo_nc: '1201', descripcion: `Soya nacional ${suf}`, cantidad: 10, pais_origen: 'CL' });
  const largo = await pedir('PUT', `/api/corredor/cargas/${cargaA.id}/tramo`, tkA,
    { punto_origen: 'campo-grande', punto_destino: 'puerto-antofagasta' });
  const corto = await pedir('PUT', `/api/corredor/cargas/${c.d.carga.id}/tramo`, tkA,
    { punto_origen: 'calama', punto_destino: 'puerto-antofagasta' });
  assert.equal(corto.status, 200);
  assert.deepEqual(corto.d.tramo.cruces, []);
  assert.ok(
    corto.d.documental.items.length < largo.d.documental.items.length,
    'si los dos tramos pidieran lo mismo, la tabla por tramo no serviría de nada'
  );
});

test('origen igual a destino, o un punto inventado, se rechazan', { skip: SIN_CORREDOR }, async () => {
  const igual = await pedir('PUT', `/api/corredor/cargas/${cargaA.id}/tramo`, tkA,
    { punto_origen: 'calama', punto_destino: 'calama' });
  assert.equal(igual.status, 400);
  const inventado = await pedir('PUT', `/api/corredor/cargas/${cargaA.id}/tramo`, tkA,
    { punto_origen: 'campo-grande', punto_destino: 'macondo' });
  assert.equal(inventado.status, 400);
  assert.match(inventado.d.error, /no est. en el cat.logo/);
});

test('sellar un documento: se guarda el sha256 y NO el archivo', { skip: SIN_CORREDOR }, async () => {
  const contenido = `factura de prueba ${suf}`;
  const esperado = crypto.createHash('sha256').update(contenido).digest('hex');
  const r = await subirArchivo(`/api/corredor/cargas/${cargaA.id}/documentos`, tkA,
    { tipo: 'factura_comercial', nombre: 'factura.pdf', contenido });
  assert.equal(r.status, 201);
  assert.equal(r.d.documento.sha256, esperado);
  assert.equal(r.d.documento.extension, 'pdf');
  assert.ok(r.d.documento.hash_cadena, 'queda encadenado');
  assert.ok(r.d.documento.eslabon >= 1);
  // Ninguna columna guarda el contenido: sicr3p sella la huella, no se
  // queda con la documentación comercial de cuatro países.
  assert.ok(!JSON.stringify(r.d.documento).includes(contenido));
  // Y el semáforo se mueve solo.
  assert.ok(r.d.documental.items.find((i) => i.tipo_documento === 'factura_comercial').cumplido);
});

test('el sha256 declarado que no calza con el archivo se rechaza', { skip: SIN_CORREDOR }, async () => {
  const r = await subirArchivo(`/api/corredor/cargas/${cargaA.id}/documentos`, tkA,
    { tipo: 'packing_list', nombre: 'pl.pdf', contenido: 'contenido real', sha: 'a'.repeat(64) });
  assert.equal(r.status, 400);
  assert.equal(r.d.codigo, 'sha_no_calza');
});

test('el mismo archivo no se sella dos veces en la misma carga', { skip: SIN_CORREDOR }, async () => {
  const contenido = `origen ${suf}`;
  const uno = await subirArchivo(`/api/corredor/cargas/${cargaA.id}/documentos`, tkA,
    { tipo: 'certificado_origen', nombre: 'origen.pdf', contenido });
  assert.equal(uno.status, 201);
  const dos = await subirArchivo(`/api/corredor/cargas/${cargaA.id}/documentos`, tkA,
    { tipo: 'certificado_origen', nombre: 'origen-copia.pdf', contenido });
  assert.equal(dos.status, 409);
  assert.equal(dos.d.codigo, 'documento_duplicado');
});

test('la cadena del Corredor avanza de a un eslabón y engancha con el anterior', { skip: SIN_CORREDOR }, async () => {
  const { rows } = await queryCorredor(
    'SELECT eslabon, hash_anterior, hash_cadena FROM carga_documentos WHERE carga_id = $1 ORDER BY eslabon', [cargaA.id]
  );
  assert.ok(rows.length >= 2);
  for (let i = 1; i < rows.length; i += 1) {
    assert.equal(rows[i].hash_anterior, rows[i - 1].hash_cadena, 'cada eslabón cuelga del anterior');
    assert.equal(Number(rows[i].eslabon), Number(rows[i - 1].eslabon) + 1);
  }
});

test('una empresa no puede sellar documentos en la carga de otra', { skip: SIN_CORREDOR }, async () => {
  const r = await subirArchivo(`/api/corredor/cargas/${cargaA.id}/documentos`, tkB,
    { tipo: 'factura_comercial', nombre: 'ajena.pdf', contenido: 'ajeno' });
  assert.equal(r.status, 404);
  const tramo = await pedir('PUT', `/api/corredor/cargas/${cargaA.id}/tramo`, tkB,
    { punto_origen: 'calama', punto_destino: 'puerto-antofagasta' });
  assert.equal(tramo.status, 404);
  const doc = await pedir('GET', `/api/corredor/cargas/${cargaA.id}/documentos`, tkB);
  assert.equal(doc.status, 404);
});

test('el catálogo de reglas se puede consultar para explicar el porqué', { skip: SIN_CORREDOR }, async () => {
  const r = await pedir('GET', '/api/corredor/tramos/documentos', tkA);
  assert.equal(r.status, 200);
  assert.ok(r.d.reglas.length >= 10);
  assert.ok(r.d.reglas.every((x) => typeof x.tipo_documento === 'string' && x.tipo_documento));
  // Cada regla dice PARA QUÉ se pide: sin eso la lista es una orden sin motivo.
  assert.ok(r.d.reglas.every((x) => x.nota));
});
