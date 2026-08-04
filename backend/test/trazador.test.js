import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import crypto from 'crypto';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { signAccess } from '../src/middleware/auth.js';
import { hashApiKey } from '../src/services/mandante.js';
import trazadorRouter from '../src/routes/trazador.js';
import { EN_PRODUCCION, SALTO_PROD } from './util/soloDev.js';

// ============================================================
// Test de integración contra una base real (mismo Postgres que usa el
// backend en desarrollo — ver backend/.env DATABASE_URL). Es el único
// archivo de la suite que toca la base de datos: el resto de sicr3p
// prueba solo unidades puras (ver el comentario de auth.test.js), pero
// la regla central de este panel — "whitelist vacía o RUT fuera de ella
// = 403, nunca acceso total" — vive en una consulta SQL real, así que
// se verifica contra filas reales, nunca con datos sintéticos servidos
// desde la migración ni desde el arranque del servidor (058_trazador.sql
// nace vacía a propósito).
//
// Todas las filas de este test son fixtures propias, creadas y
// eliminadas aquí mismo (nunca por la migración ni por un seed global).
// ============================================================

const sufijo = crypto.randomBytes(4).toString('hex');
const RUT_PERMITIDO = `9${crypto.randomInt(10000000, 99999999)}`; // dentro de la whitelist
const RUT_FUERA = `8${crypto.randomInt(10000000, 99999999)}`;     // nunca se agrega a la whitelist

let server;
let baseUrl;
let trazadorId;
let sesionId;
let facturaId;
let tokenTrazador;
const API_KEY = `trz_test_${crypto.randomBytes(16).toString('hex')}`;

before(async () => {
  if (EN_PRODUCCION) return; // los tests de BD quedan skipped: no montar nada

  await runMigrations(); // idempotente: valida además el punto 6 del encargo (correr no falla)

  const { rows: trazadores } = await query(
    `INSERT INTO trazadores (nombre, token_hash) VALUES ($1, $2) RETURNING id`,
    [`Test Trazador ${sufijo}`, hashApiKey(API_KEY)]
  );
  trazadorId = trazadores[0].id;

  await query(`INSERT INTO trazador_ruts (trazador_id, rut) VALUES ($1, $2)`, [trazadorId, RUT_PERMITIDO]);

  // Datos reales sobre el RUT permitido: una sesión (como_cliente) y una
  // factura donde ese RUT es el receptor (recibe_de), igual que consulta
  // routes/buscar.js — nada de esto se inventa, son filas de verdad.
  const { rows: sesiones } = await query(
    `INSERT INTO sesiones (rut_cliente, nombre_cliente, email_cliente, total_co2e)
     VALUES ($1, $2, $3, 12.5) RETURNING id`,
    [RUT_PERMITIDO, `Cliente Test ${sufijo}`, `test-${sufijo}@ejemplo.cl`]
  );
  sesionId = sesiones[0].id;

  const { rows: facturas } = await query(
    `INSERT INTO facturas (sesion_id, numero_venta, rut_emisor, rut_receptor, categoria, total_co2e, status)
     VALUES ($1, $2, $3, $4, 'Transporte', 3.2, 'procesada') RETURNING id`,
    [sesionId, `T-${sufijo}`, '77777777', RUT_PERMITIDO]
  );
  facturaId = facturas[0].id;

  tokenTrazador = signAccess({ id: crypto.randomUUID(), rol: 'operador', email: `op-${sufijo}@ejemplo.cl`, panel: 'trazador', trazador_id: trazadorId });

  const app = express();
  app.use(express.json());
  app.use('/api/trazador', trazadorRouter);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!EN_PRODUCCION) {
    if (facturaId) await query(`DELETE FROM facturas WHERE id = $1`, [facturaId]);
    if (sesionId) await query(`DELETE FROM sesiones WHERE id = $1`, [sesionId]);
    if (trazadorId) await query(`DELETE FROM trazador_ruts WHERE trazador_id = $1`, [trazadorId]);
    if (trazadorId) await query(`DELETE FROM trazadores WHERE id = $1`, [trazadorId]);
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.end(); // SIEMPRE: sin esto node:test se cuelga con el pool abierto
});

test('runMigrations es idempotente: correr dos veces seguidas no falla', { skip: SALTO_PROD }, async () => {
  await assert.doesNotReject(runMigrations());
});

test('GET /api/trazador/buscar sin sesión responde 401', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/trazador/buscar?rut=${RUT_PERMITIDO}`);
  assert.equal(res.status, 401);
});

test('GET /api/trazador/buscar con un RUT fuera de la whitelist responde 403', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/trazador/buscar?rut=${RUT_FUERA}`, {
    headers: { Authorization: `Bearer ${tokenTrazador}` },
  });
  const body = await res.json();
  assert.equal(res.status, 403);
  assert.match(body.error, /No tienes acceso/);
});

test('GET /api/trazador/buscar con un RUT dentro de la whitelist responde 200 con los cruces reales', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/trazador/buscar?rut=${RUT_PERMITIDO}`, {
    headers: { Authorization: `Bearer ${tokenTrazador}` },
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.cruces.rut, RUT_PERMITIDO);
  assert.equal(body.cruces.como_cliente.n_sesiones, 1);
  assert.equal(Number(body.cruces.como_cliente.total_co2e), 12.5);
  assert.equal(body.cruces.recibe_de.length, 1);
  assert.equal(body.cruces.recibe_de[0].rut_emisor, '77777777');
  assert.equal(Number(body.cruces.recibe_de[0].total_co2e), 3.2);
  assert.equal(body.cruces.emite_a.length, 0); // el RUT no emite documentos en este fixture
});

test('GET /api/trazador/rutas-permitidas devuelve solo la whitelist de ESE trazador', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/trazador/rutas-permitidas`, {
    headers: { Authorization: `Bearer ${tokenTrazador}` },
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(body.ruts, [RUT_PERMITIDO]);
});

test('GET /api/trazador/buscar con un usuario de otro panel (sicrep) responde 403 por panel, no por whitelist', { skip: SALTO_PROD }, async () => {
  const tokenOtroPanel = signAccess({ id: crypto.randomUUID(), rol: 'admin', email: `admin-${sufijo}@ejemplo.cl`, panel: 'sicrep' });
  const res = await fetch(`${baseUrl}/api/trazador/buscar?rut=${RUT_PERMITIDO}`, {
    headers: { Authorization: `Bearer ${tokenOtroPanel}` },
  });
  assert.equal(res.status, 403);
});

// ---------- Camino X-Api-Key (migración 060) — integración de un socio
// externo (ej. Kontax) que consulta el RUT programáticamente ----------

test('GET /api/trazador/buscar con X-Api-Key inválida responde 401', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/trazador/buscar?rut=${RUT_PERMITIDO}`, {
    headers: { 'X-Api-Key': 'trz_no_existe' },
  });
  assert.equal(res.status, 401);
});

test('GET /api/trazador/buscar con X-Api-Key válida y RUT dentro de la whitelist responde 200', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/trazador/buscar?rut=${RUT_PERMITIDO}`, {
    headers: { 'X-Api-Key': API_KEY },
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.cruces.rut, RUT_PERMITIDO);
});

test('GET /api/trazador/buscar con X-Api-Key válida pero RUT fuera de la whitelist responde 403', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/trazador/buscar?rut=${RUT_FUERA}`, {
    headers: { 'X-Api-Key': API_KEY },
  });
  assert.equal(res.status, 403);
});

test('GET /api/trazador/rutas-permitidas con X-Api-Key devuelve la whitelist', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/trazador/rutas-permitidas`, {
    headers: { 'X-Api-Key': API_KEY },
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(body.ruts, [RUT_PERMITIDO]);
});
