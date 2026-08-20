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

// ============================================================
// La API del Corredor, por HTTP y contra su propia base.
//
// Lo que estos casos cuidan, en orden de importancia:
//
//  1. QUE NINGUNA EMPRESA VEA LA CARGA DE OTRA. El exportador sale del
//     TOKEN, nunca del request. Es la garantía sobre la que se apoya todo
//     lo demás: sin ella el producto no se puede vender.
//  2. QUE EL NIVEL DE CONFIANZA NO SE PUEDA AUTO-OTORGAR. Mandar
//     nivel_confianza:4 y validado_por en el body no debe servir de nada.
//     Un exportador certificándose a sí mismo contra un registro público
//     es exactamente lo que la escalera viene a impedir.
//  3. QUE LA CLAVE TEMPORAL NO OPERE. Una clave dictada por teléfono que
//     queda funcionando indefinidamente es una cuenta compartida.
//  4. QUE SOBRE 4 HA SE EXIJA EL POLÍGONO. Aceptar un punto deja pasar una
//     parcela que la autoridad va a rechazar.
//
// Se saltan si el Corredor no está configurado: en el VPS todavía no lo
// está, y estos tests no pueden ser el motivo de que falle un despliegue.
// ============================================================

const SIN_CORREDOR = EN_PRODUCCION
  ? 'NODE_ENV=production'
  : (corredorConfigurado() ? false : 'el Corredor no está configurado en este entorno');

const PREDIO = { type: 'Polygon', coordinates: [[[-55.7, -12.5], [-55.6908, -12.5], [-55.6908, -12.5092], [-55.7, -12.5092], [-55.7, -12.5]]] };
const suf = crypto.randomBytes(3).toString('hex').toUpperCase();

let server; let baseUrl; let tkAdmin;
let empresaA; let empresaB; let tkA; let tkB;

const pedir = async (m, p, tk, body) => {
  const r = await fetch(baseUrl + p, {
    method: m,
    headers: { ...(tk ? { Authorization: `Bearer ${tk}` } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, d: await r.json().catch(() => null) };
};

// Crea la empresa, entra con la clave temporal y define una propia.
async function enrolarYEntrar(nombre, rut, email) {
  const alta = await pedir('POST', '/api/corredor/exportadores', tkAdmin,
    { nombre_empresa: nombre, rut, pais: 'BR', contacto_email: email });
  const login = await pedir('POST', '/api/corredor/auth/login', null,
    { email, password: alta.d.password_temporal });
  const cambio = await pedir('POST', '/api/corredor/auth/cambiar-password', login.d.access,
    { password: 'ClaveDePrueba1' });
  return { alta, login, token: cambio.d.access };
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
     VALUES ($1,'Admin de Prueba','x','admin',false) RETURNING *`, [`admin-rutas-${suf}@ejemplo.cl`]);
  tkAdmin = firmarTokenCorredor(rows[0]);

  const a = await enrolarYEntrar(`Empresa A ${suf}`, `96${suf}111`, `a-rutas-${suf}@ejemplo.cl`);
  const b = await enrolarYEntrar(`Empresa B ${suf}`, `96${suf}222`, `b-rutas-${suf}@ejemplo.cl`);
  empresaA = a; empresaB = b; tkA = a.token; tkB = b.token;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (corredorDisponible()) {
    await queryCorredor(`DELETE FROM usuarios_corredor WHERE email LIKE $1`, [`%-${suf}@ejemplo.cl`]).catch(() => {});
    await queryCorredor(`DELETE FROM exportadores WHERE nombre_empresa LIKE $1`, [`%${suf}`]).catch(() => {});
  }
  await cerrarCorredor();
});

// ---------- 1. Aislamiento entre empresas ----------

test('una empresa NO ve la carga de otra: 404, no 403',
  { skip: SIN_CORREDOR }, async () => {
    // 404 y no 403 a propósito: decir "existe pero no es tuya" ya confirma
    // que existe, y con eso se puede sondear el padrón de otra empresa.
    const carga = await pedir('POST', '/api/corredor/cargas', tkA,
      { codigo_nc: '1201', descripcion: 'Soya', cantidad: 100, pais_origen: 'BR' });
    assert.equal(carga.status, 201);
    const espia = await pedir('GET', `/api/corredor/cargas/${carga.d.carga.id}`, tkB);
    assert.equal(espia.status, 404);
  });

test('la lista de cargas viene filtrada por la empresa del token',
  { skip: SIN_CORREDOR }, async () => {
    const deB = await pedir('GET', '/api/corredor/cargas', tkB);
    assert.equal(deB.d.cargas.length, 0);
    const deA = await pedir('GET', '/api/corredor/cargas', tkA);
    assert.ok(deA.d.cargas.length > 0);
  });

test('un operador no puede mirar otra empresa pasándola por query',
  { skip: SIN_CORREDOR }, async () => {
    // El exportador sale del token; el query solo lo respeta un admin.
    const idDeA = empresaA.alta.d.exportador.id;
    const intento = await pedir('GET', `/api/corredor/cargas?exportador_id=${idDeA}`, tkB);
    assert.equal(intento.d.cargas.length, 0);
  });

// ---------- 2. El nivel se calcula, no se recibe ----------

test('mandar nivel_confianza:4 en el body no sirve de nada',
  { skip: SIN_CORREDOR }, async () => {
    const r = await pedir('POST', '/api/corredor/parcelas', tkA, {
      nombre: 'Intento de nivel', pais: 'BR', lat: -12.5, lng: -55.7, area_ha: 2,
      origen_coordenada: 'mapa', nivel_confianza: 4,
    });
    assert.equal(r.status, 201);
    assert.equal(r.d.parcela.nivel_confianza, 1); // dibujado en el mapa
  });

test('un exportador no puede certificarse a sí mismo contra un registro',
  { skip: SIN_CORREDOR }, async () => {
    const r = await pedir('POST', '/api/corredor/parcelas', tkA, {
      nombre: 'Auto-validada', pais: 'BR', poligono: PREDIO, area_ha: 102.4,
      origen_coordenada: 'registro',
      validado_por: 'yo mismo', validado_fuente: 'car', validado_at: '2026-01-01',
    });
    assert.equal(r.status, 201);
    assert.equal(r.d.parcela.validado_por, null);
    assert.notEqual(r.d.parcela.nivel_confianza, 4);
  });

test('el archivo del catastro que calza sí llega a nivel 3',
  { skip: SIN_CORREDOR }, async () => {
    const r = await pedir('POST', '/api/corredor/parcelas', tkA,
      { nombre: 'Fazenda', pais: 'BR', poligono: PREDIO, area_ha: 102.4, origen_coordenada: 'archivo' });
    assert.equal(r.d.parcela.nivel_confianza, 3);
    assert.equal(r.d.parcela.desacuerdo_area, null);
  });

test('el desacuerdo de área se registra y ninguna cifra se pisa',
  { skip: SIN_CORREDOR }, async () => {
    const r = await pedir('POST', '/api/corredor/parcelas', tkA,
      { nombre: 'No calza', pais: 'BR', poligono: PREDIO, area_ha: 300, origen_coordenada: 'archivo' });
    assert.equal(Number(r.d.parcela.area_ha), 300);      // la declarada sigue ahí
    assert.ok(r.d.parcela.desacuerdo_area);              // y el desacuerdo consta
    assert.equal(r.d.parcela.nivel_confianza, 2);        // sin subir a consistente
  });

// ---------- 3. La clave temporal no opera ----------

test('con la clave temporal solo se puede cambiar la clave',
  { skip: SIN_CORREDOR }, async () => {
    const alta = await pedir('POST', '/api/corredor/exportadores', tkAdmin,
      { nombre_empresa: `Recien Creada ${suf}`, rut: `96${suf}333`, contacto_email: `c-rutas-${suf}@ejemplo.cl` });
    const login = await pedir('POST', '/api/corredor/auth/login', null,
      { email: `c-rutas-${suf}@ejemplo.cl`, password: alta.d.password_temporal });
    assert.equal(login.d.usuario.must_reset_password, true);
    const bloqueado = await pedir('GET', '/api/corredor/parcelas', login.d.access);
    assert.equal(bloqueado.status, 403);
    assert.equal(bloqueado.d.codigo, 'clave_temporal');
  });

test('la clave temporal no tiene caracteres ambiguos: se dicta por teléfono',
  { skip: SIN_CORREDOR }, async () => {
    const p = empresaA.alta.d.password_temporal;
    assert.equal(p.length, 12);
    assert.doesNotMatch(p, /[0O1lI]/);
  });

// ---------- 4. Reglas del EUDR ----------

test('sobre 4 ha no basta un punto: se exige el polígono',
  { skip: SIN_CORREDOR }, async () => {
    const r = await pedir('POST', '/api/corredor/parcelas', tkA,
      { nombre: 'Grande', pais: 'BR', lat: -12.5, lng: -55.7, area_ha: 50 });
    assert.equal(r.status, 400);
    assert.match(r.d.error, /pol[íi]gono/i);
  });

test('una parcela declarada solo con polígono SÍ geolocaliza la carga',
  { skip: SIN_CORREDOR }, async () => {
    // Es el caso obligatorio sobre 4 ha. Pedir lat/lng dejaba sin cumplir
    // justo a la parcela mejor declarada de todas.
    const carga = await pedir('POST', '/api/corredor/cargas', tkA,
      { codigo_nc: '1201', descripcion: 'Soya con parcela', cantidad: 500, pais_origen: 'BR' });
    const parcela = await pedir('POST', '/api/corredor/parcelas', tkA,
      { nombre: 'Solo polígono', pais: 'BR', poligono: PREDIO, area_ha: 102.4, origen_coordenada: 'archivo' });
    await queryCorredor('INSERT INTO carga_parcelas (carga_id, parcela_id) VALUES ($1,$2)',
      [carga.d.carga.id, parcela.d.parcela.id]);
    await queryCorredor(
      `INSERT INTO carga_produccion (carga_id, desde, hasta, libre_deforestacion_declarado, legalidad_declarada,
        determinacion_emisor, determinacion_linea_base, determinacion_at)
       VALUES ($1,'2026-02-01','2026-04-30',true,true,'Consultora Ejemplo','MapBiomas 2020','2026-05-10')`,
      [carga.d.carga.id]);

    const det = await pedir('GET', `/api/corredor/cargas/${carga.d.carga.id}`, tkA);
    assert.equal(det.status, 200);
    assert.ok(!det.d.exportacion.bloques[0].faltantes.includes('geolocalizacion'));
    assert.equal(det.d.exportacion.listo, true);
  });

test('la carga de soya cae en EUDR y lo urgente es la prohibición',
  { skip: SIN_CORREDOR }, async () => {
    const r = await pedir('POST', '/api/corredor/cargas', tkA,
      { codigo_nc: '1201', descripcion: 'Soya sin nada', cantidad: 10, pais_origen: 'BR' });
    assert.deepEqual(r.d.exportacion.regimenes, ['eudr']);
    assert.equal(r.d.exportacion.urgencia.consecuencia.tipo, 'prohibicion');
  });

test('el código de una carga empieza en CB, nunca en LM',
  { skip: SIN_CORREDOR }, async () => {
    const r = await pedir('POST', '/api/corredor/cargas', tkA,
      { descripcion: 'Sin código arancelario', cantidad: 5, pais_origen: 'PY' });
    assert.match(r.d.carga.codigo, /^CB-\d{4}-\d{6}$/);
    // Y sin código arancelario no se opina sobre el régimen.
    assert.deepEqual(r.d.exportacion.regimenes, []);
    assert.equal(r.d.exportacion.listo, null);
  });

// ---------- Sesión ----------

test('un token de otra app no entra al Corredor',
  { skip: SIN_CORREDOR }, async () => {
    // Firmado con el secreto de sicr3p, no con el del Corredor.
    const { signAccess } = await import('../src/middleware/auth.js');
    const ajeno = signAccess({ id: crypto.randomUUID(), rol: 'admin', email: 'x@ejemplo.cl', panel: 'sicrep' });
    const r = await pedir('GET', '/api/corredor/me', ajeno);
    assert.equal(r.status, 401);
  });

test('credenciales malas no distinguen entre correo inexistente y clave errada',
  { skip: SIN_CORREDOR }, async () => {
    const inexistente = await pedir('POST', '/api/corredor/auth/login', null,
      { email: `nadie-${suf}@ejemplo.cl`, password: 'loquesea' });
    const claveMala = await pedir('POST', '/api/corredor/auth/login', null,
      { email: `a-rutas-${suf}@ejemplo.cl`, password: 'incorrecta' });
    assert.equal(inexistente.status, 401);
    assert.equal(claveMala.status, 401);
    assert.equal(inexistente.d.error, claveMala.d.error);
  });

// ---------- 5. Enlazar predios y declarar producción ----------

test('el listado y el detalle NO pueden contradecirse sobre la misma carga',
  { skip: SIN_CORREDOR }, async () => {
    // El listado evaluaba solo la carga y el detalle evaluaba la carga más
    // sus predios: la lista decía "faltan 4 datos" de una carga que el
    // detalle mostraba completa. Dos pantallas del mismo producto
    // discrepando sobre si algo cumple es peor que cualquier consulta de más.
    const carga = await pedir('POST', '/api/corredor/cargas', tkA,
      { codigo_nc: '1201', descripcion: 'Soya coherencia', cantidad: 200, pais_origen: 'BR' });
    const parcela = await pedir('POST', '/api/corredor/parcelas', tkA,
      { nombre: 'Predio coherencia', pais: 'BR', poligono: PREDIO, area_ha: 102.4, origen_coordenada: 'archivo' });

    await pedir('POST', `/api/corredor/cargas/${carga.d.carga.id}/parcelas`, tkA,
      { parcela_id: parcela.d.parcela.id });
    await pedir('PUT', `/api/corredor/cargas/${carga.d.carga.id}/produccion`, tkA, {
      desde: '2026-02-01', hasta: '2026-04-30',
      libre_deforestacion_declarado: true, legalidad_declarada: true,
      determinacion_emisor: 'Consultora Ejemplo', determinacion_linea_base: 'MapBiomas 2020',
    });

    const detalle = await pedir('GET', `/api/corredor/cargas/${carga.d.carga.id}`, tkA);
    const lista = await pedir('GET', '/api/corredor/cargas', tkA);
    const enLista = lista.d.cargas.find((c) => c.id === carga.d.carga.id);

    assert.equal(detalle.d.exportacion.listo, true);
    assert.equal(enLista.exportacion.listo, detalle.d.exportacion.listo);
    assert.equal(enLista.exportacion.glosa, detalle.d.exportacion.glosa);
  });

test('no se puede enlazar el predio de otra empresa',
  { skip: SIN_CORREDOR }, async () => {
    // Sin este chequeo, una carga quedaría "geolocalizada" con las
    // coordenadas de un predio ajeno.
    const carga = await pedir('POST', '/api/corredor/cargas', tkA,
      { codigo_nc: '1201', descripcion: 'Soya ajena', cantidad: 10, pais_origen: 'BR' });
    const deB = await pedir('POST', '/api/corredor/parcelas', tkB,
      { nombre: 'Predio de B', pais: 'BR', lat: -12.5, lng: -55.7, area_ha: 2 });

    const intento = await pedir('POST', `/api/corredor/cargas/${carga.d.carga.id}/parcelas`, tkA,
      { parcela_id: deB.d.parcela.id });
    assert.equal(intento.status, 400);
    assert.match(intento.d.error, /no existe entre los tuyos/);
  });

test('un aporte de 0% no es un origen',
  { skip: SIN_CORREDOR }, async () => {
    const carga = await pedir('POST', '/api/corredor/cargas', tkA,
      { descripcion: 'Aporte cero', cantidad: 5, pais_origen: 'BR' });
    const parcela = await pedir('POST', '/api/corredor/parcelas', tkA,
      { nombre: 'Predio aporte', pais: 'BR', lat: -12.5, lng: -55.7, area_ha: 2 });
    const r = await pedir('POST', `/api/corredor/cargas/${carga.d.carga.id}/parcelas`, tkA,
      { parcela_id: parcela.d.parcela.id, aporte_pct: 0 });
    assert.equal(r.status, 400);
  });

test('declarar "libre de deforestación" exige decir QUIÉN lo determinó',
  { skip: SIN_CORREDOR }, async () => {
    // sicr3p no analiza imágenes satelitales. Aceptar un "sí" suelto sería
    // exactamente la declaración sin respaldo que el producto existe para
    // evitar — misma doctrina que "el nivel más alto nunca se emite solo".
    const carga = await pedir('POST', '/api/corredor/cargas', tkA,
      { codigo_nc: '1201', descripcion: 'Sin emisor', cantidad: 10, pais_origen: 'BR' });
    const r = await pedir('PUT', `/api/corredor/cargas/${carga.d.carga.id}/produccion`, tkA,
      { libre_deforestacion_declarado: true });
    assert.equal(r.status, 400);
    assert.equal(r.d.codigo, 'falta_emisor_determinacion');
  });

test('un intervalo de producción al revés se rechaza',
  { skip: SIN_CORREDOR }, async () => {
    const carga = await pedir('POST', '/api/corredor/cargas', tkA,
      { descripcion: 'Fechas al revés', cantidad: 5, pais_origen: 'BR' });
    const r = await pedir('PUT', `/api/corredor/cargas/${carga.d.carga.id}/produccion`, tkA,
      { desde: '2026-06-01', hasta: '2026-02-01' });
    assert.equal(r.status, 400);
  });

test('enlazar dos veces el mismo predio actualiza el aporte, no falla',
  { skip: SIN_CORREDOR }, async () => {
    const carga = await pedir('POST', '/api/corredor/cargas', tkA,
      { descripcion: 'Doble enlace', cantidad: 5, pais_origen: 'BR' });
    const parcela = await pedir('POST', '/api/corredor/parcelas', tkA,
      { nombre: 'Predio doble', pais: 'BR', lat: -12.5, lng: -55.7, area_ha: 2 });
    const p1 = await pedir('POST', `/api/corredor/cargas/${carga.d.carga.id}/parcelas`, tkA,
      { parcela_id: parcela.d.parcela.id, aporte_pct: 40 });
    const p2 = await pedir('POST', `/api/corredor/cargas/${carga.d.carga.id}/parcelas`, tkA,
      { parcela_id: parcela.d.parcela.id, aporte_pct: 60 });
    assert.equal(p1.status, 201);
    assert.equal(p2.status, 201);
    const det = await pedir('GET', `/api/corredor/cargas/${carga.d.carga.id}`, tkA);
    assert.equal(det.d.parcelas.length, 1);
    assert.equal(Number(det.d.parcelas[0].aporte_pct), 60);
  });

test('soltar un predio lo saca de la carga',
  { skip: SIN_CORREDOR }, async () => {
    const carga = await pedir('POST', '/api/corredor/cargas', tkA,
      { descripcion: 'Para soltar', cantidad: 5, pais_origen: 'BR' });
    const parcela = await pedir('POST', '/api/corredor/parcelas', tkA,
      { nombre: 'Predio a soltar', pais: 'BR', lat: -12.5, lng: -55.7, area_ha: 2 });
    await pedir('POST', `/api/corredor/cargas/${carga.d.carga.id}/parcelas`, tkA, { parcela_id: parcela.d.parcela.id });
    const r = await pedir('DELETE', `/api/corredor/cargas/${carga.d.carga.id}/parcelas/${parcela.d.parcela.id}`, tkA);
    assert.equal(r.status, 200);
    const det = await pedir('GET', `/api/corredor/cargas/${carga.d.carga.id}`, tkA);
    assert.equal(det.d.parcelas.length, 0);
  });

test('la otra empresa no puede soltar un predio de una carga ajena',
  { skip: SIN_CORREDOR }, async () => {
    const carga = await pedir('POST', '/api/corredor/cargas', tkA,
      { descripcion: 'Ajena para soltar', cantidad: 5, pais_origen: 'BR' });
    const parcela = await pedir('POST', '/api/corredor/parcelas', tkA,
      { nombre: 'Predio protegido', pais: 'BR', lat: -12.5, lng: -55.7, area_ha: 2 });
    await pedir('POST', `/api/corredor/cargas/${carga.d.carga.id}/parcelas`, tkA, { parcela_id: parcela.d.parcela.id });
    const intento = await pedir('DELETE', `/api/corredor/cargas/${carga.d.carga.id}/parcelas/${parcela.d.parcela.id}`, tkB);
    assert.equal(intento.status, 404);
    const det = await pedir('GET', `/api/corredor/cargas/${carga.d.carga.id}`, tkA);
    assert.equal(det.d.parcelas.length, 1); // sigue enlazado
  });

// ---------- 6. El código arancelario, tal como lo escribe la gente ----------

test('el código arancelario con puntos se guarda como código y decide el régimen',
  { skip: SIN_CORREDOR }, async () => {
    // El arancel se publica "1201.90.00" y así se copia. Guardado tal cual,
    // `validarNc` lo rechazaba en silencio: la carga quedaba con su código
    // a la vista y el semáforo decía «falta declarar el código
    // arancelario». Y la soya sin código se ve en regla justo donde no lo
    // está, que es el error caro de este producto.
    const r = await pedir('POST', '/api/corredor/cargas', tkA,
      { codigo_nc: '1201.90.00', descripcion: 'Soya con puntos', cantidad: 100, pais_origen: 'BR' });
    assert.equal(r.status, 201);
    assert.equal(r.d.carga.codigo_nc, '12019000');
    assert.deepEqual(r.d.exportacion.regimenes, ['eudr']);
  });

test('un código arancelario que no existe se rechaza en vez de guardarse',
  { skip: SIN_CORREDOR }, async () => {
    const r = await pedir('POST', '/api/corredor/cargas', tkA,
      { codigo_nc: 'soja', descripcion: 'Código inventado', cantidad: 10, pais_origen: 'BR' });
    assert.equal(r.status, 400);
    assert.equal(r.d.codigo, 'nc_invalido');
  });

// ---------- 7. La brecha se puede cerrar (flujo 4 del plan) ----------

test('lo que faltaba al crear la carga se puede completar después',
  { skip: SIN_CORREDOR }, async () => {
    // Sin esto, la carga nacía con lo que se supiera ese día y no había
    // forma de agregarle nada: los cuatro datos de CBAM —instalación,
    // emisiones directas, indirectas y método— solo entraban en el alta.
    // Un panel cuyo producto es «acá está lo que te falta» que no deja
    // completarlo no tiene salida.
    const alta = await pedir('POST', '/api/corredor/cargas', tkA,
      { codigo_nc: '7601', descripcion: 'Aluminio incompleto', cantidad: 20, pais_origen: 'BR' });
    assert.equal(alta.status, 201);
    assert.deepEqual(alta.d.exportacion.regimenes, ['cbam']);
    assert.equal(alta.d.exportacion.listo, false);

    const r = await pedir('PATCH', `/api/corredor/cargas/${alta.d.carga.id}`, tkA, {
      instalacion: 'Fundición Ejemplo',
      emisiones_directas_tco2e_t: 8.1,
      emisiones_indirectas_tco2e_t: 0,
      metodo_emisiones: 'valores_reales',
    });
    assert.equal(r.status, 200);
    assert.equal(r.d.exportacion.listo, true);
    assert.equal(r.d.exportacion.semaforo, 'verde');
    // El cero declarado es un valor, no una ausencia.
    assert.equal(Number(r.d.carga.emisiones_indirectas_tco2e_t), 0);
  });

test('completar la carga deja constancia de lo que cambió',
  { skip: SIN_CORREDOR }, async () => {
    const alta = await pedir('POST', '/api/corredor/cargas', tkA,
      { descripcion: 'Con bitácora', cantidad: 5, pais_origen: 'BR' });
    await pedir('PATCH', `/api/corredor/cargas/${alta.d.carga.id}`, tkA, { codigo_nc: '1201' });
    const { rows } = await queryCorredor(
      `SELECT detalle FROM actividad_corredor WHERE entidad_id = $1 AND accion = 'editar_carga'`,
      [alta.d.carga.id]);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].detalle.cambios.codigo_nc, { antes: null, despues: '1201' });
  });

test('la carga de otra empresa no se puede editar',
  { skip: SIN_CORREDOR }, async () => {
    const alta = await pedir('POST', '/api/corredor/cargas', tkA,
      { descripcion: 'Ajena para editar', cantidad: 5, pais_origen: 'BR' });
    const intento = await pedir('PATCH', `/api/corredor/cargas/${alta.d.carga.id}`, tkB,
      { instalacion: 'Metida de mano' });
    assert.equal(intento.status, 404);
  });

test('el código de la carga y su empresa no se pueden cambiar: están sellados',
  { skip: SIN_CORREDOR }, async () => {
    const alta = await pedir('POST', '/api/corredor/cargas', tkA,
      { descripcion: 'Código sellado', cantidad: 5, pais_origen: 'BR' });
    const r = await pedir('PATCH', `/api/corredor/cargas/${alta.d.carga.id}`, tkA,
      { codigo: 'CB-2000-000001', exportador_id: empresaB.alta.d.exportador.id });
    assert.equal(r.status, 400);
    const det = await pedir('GET', `/api/corredor/cargas/${alta.d.carga.id}`, tkA);
    assert.equal(det.d.carga.codigo, alta.d.carga.codigo);
  });

// ---------- 8. Cerrar y anular: los estados que el esquema ya define ----------

test('una carga cerrada no admite cambios, y reabrirla los vuelve a permitir',
  { skip: SIN_CORREDOR }, async () => {
    const alta = await pedir('POST', '/api/corredor/cargas', tkA,
      { descripcion: 'Para cerrar', cantidad: 5, pais_origen: 'BR' });
    const id = alta.d.carga.id;
    assert.equal(alta.d.carga.estado, 'abierta');

    const cierre = await pedir('PATCH', `/api/corredor/cargas/${id}`, tkA, { estado: 'cerrada' });
    assert.equal(cierre.status, 200);
    assert.equal(cierre.d.carga.estado, 'cerrada');

    const bloqueado = await pedir('PATCH', `/api/corredor/cargas/${id}`, tkA, { instalacion: 'Tarde' });
    assert.equal(bloqueado.status, 409);
    assert.equal(bloqueado.d.codigo, 'carga_cerrada');

    const doc = await pedir('POST', `/api/corredor/cargas/${id}/produccion`, tkA, { desde: '2026-01-01' });
    assert.equal(doc.status, 404); // POST no existe; el PUT sí y también queda bloqueado
    const prod = await pedir('PUT', `/api/corredor/cargas/${id}/produccion`, tkA, { desde: '2026-01-01' });
    assert.equal(prod.status, 409);

    const reapertura = await pedir('PATCH', `/api/corredor/cargas/${id}`, tkA, { estado: 'abierta' });
    assert.equal(reapertura.status, 200);
    const ahora = await pedir('PATCH', `/api/corredor/cargas/${id}`, tkA, { instalacion: 'A tiempo' });
    assert.equal(ahora.status, 200);
    assert.equal(ahora.d.carga.instalacion, 'A tiempo');
  });

test('anular es definitivo: una carga anulada no se reabre',
  { skip: SIN_CORREDOR }, async () => {
    // Se anula la que se creó por error. Que se pudiera «desanular» haría
    // desaparecer el hecho de que se anuló, y el código ya se gastó.
    const alta = await pedir('POST', '/api/corredor/cargas', tkA,
      { descripcion: 'Creada por error', cantidad: 5, pais_origen: 'BR' });
    const id = alta.d.carga.id;
    const anula = await pedir('PATCH', `/api/corredor/cargas/${id}`, tkA, { estado: 'anulada' });
    assert.equal(anula.status, 200);
    const intento = await pedir('PATCH', `/api/corredor/cargas/${id}`, tkA, { estado: 'abierta' });
    assert.equal(intento.status, 409);
  });

// ---------- 9. El hito del viaje: se registra el paso, no el móvil ----------

test('registrar el paso por un punto de control queda en la carga',
  { skip: SIN_CORREDOR }, async () => {
    // `carga_pasos` se leía en el detalle y no la escribía nadie: el viaje
    // de una carga siempre salía vacío.
    const alta = await pedir('POST', '/api/corredor/cargas', tkA,
      { codigo_nc: '1201', descripcion: 'Soya en viaje', cantidad: 30, pais_origen: 'BR' });
    const id = alta.d.carga.id;
    await pedir('PUT', `/api/corredor/cargas/${id}/tramo`, tkA,
      { punto_origen: 'campo-grande', punto_destino: 'puerto-antofagasta' });

    const r = await pedir('POST', `/api/corredor/cargas/${id}/pasos`, tkA,
      { punto_id: 'ponta-pora', capturado_at: '2026-03-02T14:20:00Z', via_qr: true });
    assert.equal(r.status, 201);
    assert.equal(r.d.paso.punto_id, 'ponta-pora');
    assert.equal(r.d.fuera_del_tramo, false);

    const det = await pedir('GET', `/api/corredor/cargas/${id}`, tkA);
    assert.equal(det.d.pasos.length, 1);
    assert.equal(det.d.pasos[0].punto_nombre, 'Ponta Porã (frontera BR/PY)');
  });

test('el hito NO acepta la posición del vehículo, aunque se la manden',
  { skip: SIN_CORREDOR }, async () => {
    // Regla dura del producto: se registra el paso por un punto de control
    // fijo y público, nunca dónde está la carga. La tabla no tiene columna
    // y la ruta tampoco la recibe: un rastro en vivo de una carga valiosa
    // que cruza cuatro países es el mapa que necesita quien la intercepte.
    const alta = await pedir('POST', '/api/corredor/cargas', tkA,
      { descripcion: 'Sin GPS', cantidad: 5, pais_origen: 'BR' });
    const r = await pedir('POST', `/api/corredor/cargas/${alta.d.carga.id}/pasos`, tkA,
      { punto_id: 'ponta-pora', lat: -22.5, lng: -55.7 });
    assert.equal(r.status, 400);
    assert.equal(r.d.codigo, 'sin_posicion');
  });

test('el mismo hito reintentado desde la cola no se duplica',
  { skip: SIN_CORREDOR }, async () => {
    // Los pasos fronterizos son justo donde no hay señal: el registro se
    // encola y se reintenta. Reintentar no puede inventar dos cruces.
    const alta = await pedir('POST', '/api/corredor/cargas', tkA,
      { descripcion: 'Cola sin señal', cantidad: 5, pais_origen: 'BR' });
    const id = alta.d.carga.id;
    const cuerpo = { punto_id: 'pozo-hondo', capturado_at: '2026-03-04T09:00:00Z' };
    const uno = await pedir('POST', `/api/corredor/cargas/${id}/pasos`, tkA, cuerpo);
    const dos = await pedir('POST', `/api/corredor/cargas/${id}/pasos`, tkA, cuerpo);
    assert.equal(uno.status, 201);
    assert.equal(dos.status, 200);
    assert.equal(dos.d.duplicado, true);
    const det = await pedir('GET', `/api/corredor/cargas/${id}`, tkA);
    assert.equal(det.d.pasos.length, 1);
  });

test('un hito fuera del tramo declarado se registra igual, y se dice',
  { skip: SIN_CORREDOR }, async () => {
    // El desacuerdo se registra, no se corrige: si la carga pasó por donde
    // no dijo que iba a pasar, el hecho vale más que la declaración, y
    // ninguna de las dos se pisa.
    const alta = await pedir('POST', '/api/corredor/cargas', tkA,
      { descripcion: 'Se desvió', cantidad: 5, pais_origen: 'BR' });
    const id = alta.d.carga.id;
    await pedir('PUT', `/api/corredor/cargas/${id}/tramo`, tkA,
      { punto_origen: 'campo-grande', punto_destino: 'loma-plata' });
    const r = await pedir('POST', `/api/corredor/cargas/${id}/pasos`, tkA, { punto_id: 'calama' });
    assert.equal(r.status, 201);
    assert.equal(r.d.fuera_del_tramo, true);
  });

test('un punto que no está en el catálogo no es un hito',
  { skip: SIN_CORREDOR }, async () => {
    const alta = await pedir('POST', '/api/corredor/cargas', tkA,
      { descripcion: 'Punto inventado', cantidad: 5, pais_origen: 'BR' });
    const r = await pedir('POST', `/api/corredor/cargas/${alta.d.carga.id}/pasos`, tkA,
      { punto_id: 'la-esquina-de-mi-casa' });
    assert.equal(r.status, 400);
  });

// ---------- 10. La empresa completa sus propios datos ----------

test('el exportador completa su EORI y su dirección: nadie más los tiene',
  { skip: SIN_CORREDOR }, async () => {
    // El EORI es lo que identifica al operador ante la aduana de la UE y
    // sin él la declaración de diligencia debida no se presenta. Solo lo
    // podía escribir el admin del Corredor, en el alta, adivinándolo — la
    // empresa no tenía dónde ponerlo.
    const antes = await pedir('GET', '/api/corredor/me', tkA);
    assert.equal(antes.d.usuario.onboarding_completado, false);

    const r = await pedir('PUT', '/api/corredor/mi-empresa', tkA,
      { eori: 'br 1234567890', direccion: 'Av. Afonso Pena 1000, Campo Grande' });
    assert.equal(r.status, 200);
    assert.equal(r.d.exportador.eori, 'BR1234567890');

    // Y con los datos completos, el onboarding se da por cerrado SOLO. Es
    // una columna que existía desde la primera migración y no escribía
    // nadie: la empresa quedaba "sin datos" para siempre.
    const despues = await pedir('GET', '/api/corredor/me', tkA);
    assert.equal(despues.d.usuario.onboarding_completado, true);
  });

test('el EORI no se inventa: un identificador que no tiene forma de EORI se rechaza',
  { skip: SIN_CORREDOR }, async () => {
    const r = await pedir('PUT', '/api/corredor/mi-empresa', tkA, { eori: '¿?' });
    assert.equal(r.status, 400);
  });

test('la razón social y el identificador tributario no se cambian desde el panel',
  { skip: SIN_CORREDOR }, async () => {
    const r = await pedir('PUT', '/api/corredor/mi-empresa', tkA, { rut: '111111111' });
    assert.equal(r.status, 400);
    assert.equal(r.d.codigo, 'campo_no_editable');
  });

// ---------- 11. Una empresa que perdió su clave no queda afuera ----------

test('el admin puede volver a emitir la clave temporal de una empresa',
  { skip: SIN_CORREDOR }, async () => {
    // Sin esto, un exportador que olvidaba su contraseña quedaba fuera para
    // siempre: no hay correo de recuperación, y volver a crear la empresa
    // choca contra el identificador tributario único.
    const alta = await pedir('POST', '/api/corredor/exportadores', tkAdmin, {
      nombre_empresa: `Empresa Olvidadiza ${suf}`, rut: `96${suf}444`,
      contacto_email: `d-rutas-${suf}@ejemplo.cl`,
    });
    const id = alta.d.exportador.id;
    const primera = alta.d.password_temporal;

    const nueva = await pedir('POST', `/api/corredor/exportadores/${id}/clave-temporal`, tkAdmin);
    assert.equal(nueva.status, 200);
    assert.equal(nueva.d.password_temporal.length, 12);
    assert.notEqual(nueva.d.password_temporal, primera);

    const vieja = await pedir('POST', '/api/corredor/auth/login', null,
      { email: `d-rutas-${suf}@ejemplo.cl`, password: primera });
    assert.equal(vieja.status, 401);

    const entra = await pedir('POST', '/api/corredor/auth/login', null,
      { email: `d-rutas-${suf}@ejemplo.cl`, password: nueva.d.password_temporal });
    assert.equal(entra.status, 200);
    // Y nace obligada a cambiarse: una clave dictada por teléfono que queda
    // operando indefinidamente es una cuenta compartida.
    assert.equal(entra.d.usuario.must_reset_password, true);
  });

test('un operador no puede emitirle una clave a nadie',
  { skip: SIN_CORREDOR }, async () => {
    const r = await pedir('POST', `/api/corredor/exportadores/${empresaB.alta.d.exportador.id}/clave-temporal`, tkA);
    assert.equal(r.status, 403);
  });
