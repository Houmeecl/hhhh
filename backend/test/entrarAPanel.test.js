import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from '../src/config.js';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { signAccess } from '../src/middleware/auth.js';
import { hashApiKey } from '../src/services/mandante.js';
import adminRouter from '../src/routes/admin.js';
import authRouter from '../src/routes/auth.js';
import { adminRouter as posAdminRouter } from '../src/routes/pos.js';
import { EN_PRODUCCION, SALTO_PROD } from './util/soloDev.js';

// ============================================================
// POST /api/admin/entrar-a-panel (migración 069/070): un superadmin
// canjea su sesión por un token de VISTA de otro panel, sin crear fila
// nueva en `usuarios`. Cubre el contrato completo: rechazo sin la marca
// es_superadmin, panel/entidad inválidos, éxito con FK resuelta, que
// GET /api/auth/me responda desde el payload (rama `imp`) sin tocar la
// BD, y que PUT /api/auth/password quede bloqueado para esa sesión.
// ============================================================

const sufijo = crypto.randomBytes(4).toString('hex');

let server;
let baseUrl;
let puertoId;
let tokenSuperadmin;
let tokenAdminNormal;

before(async () => {
  if (EN_PRODUCCION) return;

  await runMigrations();

  const { rows: puertos } = await query(
    `INSERT INTO puertos (nombre, punto_id, token_hash, activo) VALUES ($1,$2,$3,true) RETURNING id`,
    [`Puerto Test ${sufijo}`, `pt-test-${sufijo}`, hashApiKey(`pto_test_${sufijo}`)]
  );
  puertoId = puertos[0].id;

  tokenSuperadmin = signAccess({
    id: crypto.randomUUID(), rol: 'admin', email: `super-${sufijo}@ejemplo.cl`,
    panel: 'sicrep', es_superadmin: true,
  });
  tokenAdminNormal = signAccess({
    id: crypto.randomUUID(), rol: 'admin', email: `admin-${sufijo}@ejemplo.cl`,
    panel: 'sicrep', es_superadmin: false,
  });

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  // '/api/admin/pos' va ANTES del genérico '/api/admin' — mismo motivo que
  // en index.js: si no, requireHomePanel('sicrep') de adminRouter
  // interceptaría las rutas de aduana_verde antes de llegar a su router.
  app.use('/api/admin/pos', posAdminRouter);
  app.use('/api/admin', adminRouter);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!EN_PRODUCCION && puertoId) await query(`DELETE FROM puertos WHERE id = $1`, [puertoId]);
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('POST /admin/entrar-a-panel responde 403 si la cuenta no es superadmin', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/entrar-a-panel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdminNormal}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ panel: 'puerto', entidad_id: puertoId }),
  });
  assert.equal(res.status, 403);
});

test('POST /admin/entrar-a-panel responde 400 con panel inválido', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/entrar-a-panel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenSuperadmin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ panel: 'no_existe' }),
  });
  assert.equal(res.status, 400);
});

test('POST /admin/entrar-a-panel responde 400 sin entidad_id para un panel que la exige', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/entrar-a-panel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenSuperadmin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ panel: 'puerto' }),
  });
  assert.equal(res.status, 400);
});

test('POST /admin/entrar-a-panel responde 404 con entidad_id inexistente', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/entrar-a-panel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenSuperadmin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ panel: 'puerto', entidad_id: crypto.randomUUID() }),
  });
  assert.equal(res.status, 404);
});

let tokenVista;

test('POST /admin/entrar-a-panel emite un token de vista con sub sintético y rol operador', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/entrar-a-panel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenSuperadmin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ panel: 'puerto', entidad_id: puertoId }),
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(typeof body.accessToken, 'string');
  tokenVista = body.accessToken;

  const payload = jwt.verify(tokenVista, config.jwt.accessSecret);
  assert.match(payload.sub, /^imp:.+:puerto$/);
  assert.equal(payload.imp, true);
  assert.equal(payload.rol, 'operador');
  assert.equal(payload.panel, 'puerto');
  assert.equal(payload.puerto_id, puertoId);
});

test('el token de vista es de SOLO LECTURA: nivel_acceso="lectura" en todos los paneles', { skip: SALTO_PROD }, async () => {
  // Regresión de la propiedad central: con nivel_acceso='operador' este
  // token pasaba requireNivelOperador y permitía FIRMAR UN LOTE con el RUT
  // y la razón social del proveedor — un eslabón sellado en la cadena de
  // custodia que no distingue quién lo firmó, y que además deja al
  // proveedor real sin poder firmar (409). Es "vista", no suplantación.
  for (const cuerpo of [{ panel: 'aduana_verde' }, { panel: 'puerto', entidad_id: puertoId }]) {
    const res = await fetch(`${baseUrl}/api/admin/entrar-a-panel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenSuperadmin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    const { accessToken } = await res.json();
    assert.equal(jwt.verify(accessToken, config.jwt.accessSecret).nivel_acceso, 'lectura', cuerpo.panel);
  }
});

test('GET /auth/me con un token de vista responde desde el payload, sin tocar usuarios', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${tokenVista}` },
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.user.panel, 'puerto');
  assert.equal(body.user.puerto_id, puertoId);
  assert.equal(body.user.rol, 'operador');
  assert.equal(body.user.must_reset_password, false);
});

test('PUT /auth/password responde 403 con un token de vista', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/auth/password`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${tokenVista}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ actual: 'x', nueva: 'y'.repeat(12) }),
  });
  assert.equal(res.status, 403);
});

test('POST /admin/entrar-a-panel con aduana_verde no exige entidad_id', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/entrar-a-panel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenSuperadmin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ panel: 'aduana_verde' }),
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  const payload = jwt.verify(body.accessToken, config.jwt.accessSecret);
  assert.equal(payload.panel, 'aduana_verde');
  assert.equal(payload.puerto_id, null);
});

// Regresión: aduana_verde ('Terreno') es un panel INTERNO — su adminRouter
// (routes/pos.js) exige rol='admin' igual que cualquier cuenta real, a
// diferencia de los 5 paneles externos (puerto/mandante/agencia/trazador/
// proveedor) que no tienen ese concepto y siempre reciben 'operador'. Con
// 'operador' la vista quedaba en "No autorizado" apenas cargaba el panel
// (GET /admin/pos/compensaciones/resumen y el resto del dashboard).
test('POST /admin/entrar-a-panel con aduana_verde emite rol=admin (panel interno)', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/entrar-a-panel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenSuperadmin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ panel: 'aduana_verde' }),
  });
  const { accessToken } = await res.json();
  const payload = jwt.verify(accessToken, config.jwt.accessSecret);
  assert.equal(payload.rol, 'admin');
  assert.equal(payload.nivel_acceso, 'lectura');
});

test('el token de vista de aduana_verde SÍ lee el panel (GET /admin/pos/*)', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/entrar-a-panel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenSuperadmin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ panel: 'aduana_verde' }),
  });
  const { accessToken } = await res.json();

  const resumen = await fetch(`${baseUrl}/api/admin/pos/compensaciones/resumen`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  assert.equal(resumen.status, 200);
});

test('el token de vista de aduana_verde NO puede editar la tarifa (PUT /admin/pos/config)', { skip: SALTO_PROD }, async () => {
  // Mismo principio que el eslabón de la cadena de custodia: es una VISTA,
  // no un turno de trabajo — nivel_acceso='lectura' debe bloquear la única
  // mutación de este panel igual que ya bloquea las de agencia/proveedor.
  const res = await fetch(`${baseUrl}/api/admin/entrar-a-panel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenSuperadmin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ panel: 'aduana_verde' }),
  });
  const { accessToken } = await res.json();

  const put = await fetch(`${baseUrl}/api/admin/pos/config`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tarifa_clp_tco2e: 6000 }),
  });
  assert.equal(put.status, 403);
});
