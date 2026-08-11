import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import crypto from 'crypto';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { signAccess } from '../src/middleware/auth.js';
import { SECCIONES_ADMIN } from '../src/constants/seccionesAdmin.js';
import origenRoutes, { tarjetaRouter } from '../src/routes/origen.js';
import { torreRouter } from '../src/routes/torre.js';
import { EN_PRODUCCION, SALTO_PROD } from './util/soloDev.js';

// ============================================================
// Test de integración contra una base real (mismo patrón que
// trazador.test.js/proveedor.test.js): hasta ahora NO existía ningún
// test HTTP de /api/torre/* ni /api/tarjeta/* (solo se probaban las
// funciones puras equivalentes en pasaporteOrigen.test.js). Cubre
// también la advertencia nueva de punto_id fuera de catálogo.
// ============================================================

const sufijo = crypto.randomBytes(4).toString('hex');

let server;
let baseUrl;
let adminToken;
let torreToken;
let loteIds = [];
let tarjetaIds = [];
let torreTerminalId;
let camionEnRuta;
let camionSinRuta;

before(async () => {
  if (EN_PRODUCCION) return; // los tests de BD quedan skipped: no montar nada

  await runMigrations();

  adminToken = signAccess({ id: crypto.randomUUID(), rol: 'admin', email: `admin-${sufijo}@ejemplo.cl`, secciones_admin: [...SECCIONES_ADMIN] });

  const app = express();
  app.use(express.json());
  app.use('/api/admin/origen', origenRoutes);
  app.use('/api/torre', torreRouter);
  app.use('/api/tarjeta', tarjetaRouter);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const resDemo = await fetch(`${baseUrl}/api/admin/origen/demo-torre`, {
    method: 'POST', headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(resDemo.status, 201);
  const demo = await resDemo.json();
  loteIds = demo.camiones.map((c) => c.lote.id);
  tarjetaIds = demo.camiones.map((c) => c.tarjeta.id);
  torreTerminalId = demo.torre.id;
  torreToken = signAccess({ id: torreTerminalId, rol: 'pos', email: null });
  camionEnRuta = demo.camiones[0]; // nace con un paso ya sellado (Mariscal Estigarribia)
  camionSinRuta = demo.camiones[2]; // nace sin pasos, para probar el paso nuevo
});

after(async () => {
  if (!EN_PRODUCCION) {
    if (tarjetaIds.length) await query(`DELETE FROM tarjetas_viaje WHERE id = ANY($1::uuid[])`, [tarjetaIds]);
    if (loteIds.length) await query(`DELETE FROM lotes_minerales WHERE id = ANY($1::uuid[])`, [loteIds]); // cascada: eslabones + torre_mensajes
    if (torreTerminalId) await query(`DELETE FROM pos_terminales WHERE id = $1`, [torreTerminalId]);
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.end(); // SIEMPRE: sin esto node:test se cuelga con el pool abierto
});

// ---------- GET /api/torre/flota ----------

test('GET /api/torre/flota sin token → 401', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/torre/flota`);
  assert.equal(res.status, 401);
});

test('GET /api/torre/flota con rol incorrecto (tarjeta, no pos) → 403', { skip: SALTO_PROD }, async () => {
  const resAuth = await fetch(`${baseUrl}/api/tarjeta/auth`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serial: camionEnRuta.tarjeta.serial, clave: camionEnRuta.tarjeta.clave }),
  });
  const { token: tarjetaToken } = await resAuth.json();
  const res = await fetch(`${baseUrl}/api/torre/flota`, { headers: { Authorization: `Bearer ${tarjetaToken}` } });
  assert.equal(res.status, 403);
});

test('GET /api/torre/flota refleja los camiones creados por demo-torre', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/torre/flota`, { headers: { Authorization: `Bearer ${torreToken}` } });
  assert.equal(res.status, 200);
  const { flota } = await res.json();
  const codigos = flota.map((f) => f.codigo);
  assert.ok(codigos.includes(camionEnRuta.lote.codigo));
  assert.ok(codigos.includes(camionSinRuta.lote.codigo));
  const filaEnRuta = flota.find((f) => f.codigo === camionEnRuta.lote.codigo);
  assert.equal(filaEnRuta.ultimo_paso.punto_id, 'mariscal-estigarribia');
});

// ---------- GET /api/admin/origen/corredor/:puntoId/qr.png ----------

test('GET /admin/origen/corredor/:puntoId/qr.png con id del catálogo → 200 PNG', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/origen/corredor/susques/qr.png`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.length > 100); // un PNG real, no una respuesta vacía
});

test('GET /admin/origen/corredor/:puntoId/qr.png con id fuera del catálogo → 404', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/origen/corredor/punto-inventado/qr.png`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(res.status, 404);
});

test('GET /admin/origen/corredor/:puntoId/qr.png sin token → 401', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/origen/corredor/susques/qr.png`);
  assert.equal(res.status, 401);
});

// ---------- POST /api/tarjeta/paso ----------

test('POST /api/tarjeta/paso con punto_id fuera del catálogo: se guarda igual, con advertencia', { skip: SALTO_PROD }, async () => {
  const resAuth = await fetch(`${baseUrl}/api/tarjeta/auth`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serial: camionSinRuta.tarjeta.serial, clave: camionSinRuta.tarjeta.clave }),
  });
  const { token } = await resAuth.json();

  const res = await fetch(`${baseUrl}/api/tarjeta/paso`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ punto_control: 'Lugar inventado', punto_id: 'punto-inventado', pais: 'BR' }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.eslabon.datos.punto_id, 'punto-inventado'); // append-only: se guarda igual
  assert.ok(body.advertencias.some((a) => a.includes("'punto-inventado'") && a.includes('catálogo')));
});

test('POST /api/tarjeta/paso con punto_id del catálogo real: sin advertencia de punto', { skip: SALTO_PROD }, async () => {
  const resAuth = await fetch(`${baseUrl}/api/tarjeta/auth`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serial: camionEnRuta.tarjeta.serial, clave: camionEnRuta.tarjeta.clave }),
  });
  const { token } = await resAuth.json();

  const res = await fetch(`${baseUrl}/api/tarjeta/paso`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ punto_control: 'Susques', punto_id: 'susques', pais: 'AR' }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.ok(!body.advertencias.some((a) => a.includes('catálogo del corredor')));
});

test('POST /api/tarjeta/paso sin via_qr: la clave no aparece en datos (retrocompatibilidad)', { skip: SALTO_PROD }, async () => {
  const resAuth = await fetch(`${baseUrl}/api/tarjeta/auth`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serial: camionEnRuta.tarjeta.serial, clave: camionEnRuta.tarjeta.clave }),
  });
  const { token } = await resAuth.json();
  const res = await fetch(`${baseUrl}/api/tarjeta/paso`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ punto_control: 'Susques', punto_id: 'susques', pais: 'AR' }),
  });
  assert.equal(res.status, 201);
  const { eslabon } = await res.json();
  assert.equal('via_qr' in eslabon.datos, false);
  assert.equal('capturado_en' in eslabon.datos, false);
});

test('POST /api/tarjeta/paso con via_qr:true y capturado_en: quedan guardados en datos', { skip: SALTO_PROD }, async () => {
  const resAuth = await fetch(`${baseUrl}/api/tarjeta/auth`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serial: camionEnRuta.tarjeta.serial, clave: camionEnRuta.tarjeta.clave }),
  });
  const { token } = await resAuth.json();
  const capturadoEn = new Date(Date.now() - 3_600_000).toISOString(); // encolado hace 1h, reenviado ahora
  const res = await fetch(`${baseUrl}/api/tarjeta/paso`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ punto_control: 'Susques', punto_id: 'susques', pais: 'AR', via_qr: true, capturado_en: capturadoEn }),
  });
  assert.equal(res.status, 201);
  const { eslabon } = await res.json();
  assert.equal(eslabon.datos.via_qr, true);
  assert.equal(eslabon.datos.capturado_en, capturadoEn);
});

// ---------- POST /api/torre/mensaje ----------

test('POST /api/torre/mensaje con destino inválido → 400', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/torre/mensaje`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${torreToken}` },
    body: JSON.stringify({ codigo_lote: camionEnRuta.lote.codigo, destino: 'aeropuerto' }),
  });
  assert.equal(res.status, 400);
});

test('POST /api/torre/mensaje con frontera y zona fuera de los 3 pasos conocidos → 400', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/torre/mensaje`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${torreToken}` },
    body: JSON.stringify({ codigo_lote: camionEnRuta.lote.codigo, destino: 'frontera', zona: 'zona-inventada' }),
  });
  assert.equal(res.status, 400);
});

test('POST /api/torre/mensaje con estacionamiento y zona → 201', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/torre/mensaje`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${torreToken}` },
    body: JSON.stringify({ codigo_lote: camionEnRuta.lote.codigo, destino: 'estacionamiento', zona: 'Zona E-3, La Negra' }),
  });
  assert.equal(res.status, 201);
  const { mensaje } = await res.json();
  assert.equal(mensaje.destino, 'estacionamiento');
  assert.equal(mensaje.zona, 'Zona E-3, La Negra');
});

test('POST /api/torre/mensaje con rol incorrecto (tarjeta, no pos) → 403', { skip: SALTO_PROD }, async () => {
  const resAuth = await fetch(`${baseUrl}/api/tarjeta/auth`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serial: camionEnRuta.tarjeta.serial, clave: camionEnRuta.tarjeta.clave }),
  });
  const { token: tarjetaToken } = await resAuth.json();
  const res = await fetch(`${baseUrl}/api/torre/mensaje`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tarjetaToken}` },
    body: JSON.stringify({ codigo_lote: camionEnRuta.lote.codigo, destino: 'puerto' }),
  });
  assert.equal(res.status, 403);
});

test('POST /api/torre/mensaje sin token → 401', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/torre/mensaje`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo_lote: camionEnRuta.lote.codigo, destino: 'puerto' }),
  });
  assert.equal(res.status, 401);
});
