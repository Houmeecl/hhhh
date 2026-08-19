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
