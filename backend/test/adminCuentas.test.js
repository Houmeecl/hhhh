import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { signAccess } from '../src/middleware/auth.js';
import adminRouter from '../src/routes/admin.js';
import { EN_PRODUCCION, SALTO_PROD } from './util/soloDev.js';

// ============================================================
// Test de integración contra Postgres real (mismo patrón que
// test/trazador.test.js): cubre que la creación/regeneración de cuentas en
// admin.js ya NO depende de correo saliente — devuelve una contraseña en
// texto plano una sola vez, con la cuenta activa de inmediato y
// must_reset_password=true. Fixtures propias, creadas y eliminadas aquí.
// ============================================================

const sufijo = crypto.randomBytes(4).toString('hex');

let server;
let baseUrl;
let clienteId;
let usuarioClienteId;
let usuarioGeneralId;
let tokenAdmin;

before(async () => {
  if (EN_PRODUCCION) return; // los tests de BD quedan skipped: no montar nada

  await runMigrations();

  const { rows: clientes } = await query(
    `INSERT INTO clientes (rut, nombre_empresa, contacto_email) VALUES ($1,$2,$3) RETURNING id`,
    [`${crypto.randomInt(10000000, 99999999)}-${sufijo.slice(0, 1)}`, `Cliente Test ${sufijo}`, `contacto-${sufijo}@ejemplo.cl`]
  );
  clienteId = clientes[0].id;

  tokenAdmin = signAccess({ id: crypto.randomUUID(), rol: 'admin', email: `admin-${sufijo}@ejemplo.cl`, panel: 'sicrep' });

  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!EN_PRODUCCION) {
    if (usuarioGeneralId) await query(`DELETE FROM usuarios WHERE id = $1`, [usuarioGeneralId]);
    if (usuarioClienteId) await query(`DELETE FROM usuarios WHERE id = $1`, [usuarioClienteId]);
    if (clienteId) await query(`DELETE FROM clientes WHERE id = $1`, [clienteId]);
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.end(); // SIEMPRE: sin esto node:test se cuelga con el pool abierto
});

test('POST /admin/clientes/:id/crear-cuenta devuelve password en vez de correo_enviado, con estado activo', { skip: SALTO_PROD }, async () => {
  const email = `cliente-${sufijo}@ejemplo.cl`;
  const res = await fetch(`${baseUrl}/api/admin/clientes/${clienteId}/crear-cuenta`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, nombre: 'Contacto Cliente' }),
  });
  const body = await res.json();
  assert.equal(res.status, 201);
  assert.equal(body.ok, true);
  assert.equal(body.email, email);
  assert.equal(typeof body.password, 'string');
  assert.ok(body.password.length >= 10);
  assert.equal(body.correo_enviado, undefined);
  assert.equal(body.dev_activation_link, undefined);
  usuarioClienteId = body.usuario_id;

  const { rows } = await query(`SELECT estado, must_reset_password, password_hash FROM usuarios WHERE id = $1`, [usuarioClienteId]);
  assert.equal(rows[0].estado, 'activo');
  assert.equal(rows[0].must_reset_password, true);
  assert.equal(await bcrypt.compare(body.password, rows[0].password_hash), true);
});

test('POST /admin/clientes/:id/crear-cuenta responde 409 si el correo ya existe', { skip: SALTO_PROD }, async () => {
  const email = `cliente-${sufijo}@ejemplo.cl`; // mismo correo del test anterior
  const res = await fetch(`${baseUrl}/api/admin/clientes/${clienteId}/crear-cuenta`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, nombre: 'Otra vez' }),
  });
  assert.equal(res.status, 409);
});

test('POST /admin/usuarios devuelve password en vez de correo_enviado, con estado activo', { skip: SALTO_PROD }, async () => {
  const email = `usuario-${sufijo}@ejemplo.cl`;
  const res = await fetch(`${baseUrl}/api/admin/usuarios`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, nombre: 'Operador Test', rol: 'operador' }),
  });
  const body = await res.json();
  assert.equal(res.status, 201);
  assert.equal(body.usuario.email, email);
  assert.equal(typeof body.password, 'string');
  assert.ok(body.password.length >= 10);
  assert.equal(body.correo_enviado, undefined);
  assert.equal(body.dev_activation_link, undefined);
  usuarioGeneralId = body.usuario.id;

  const { rows } = await query(`SELECT estado, must_reset_password, password_hash FROM usuarios WHERE id = $1`, [usuarioGeneralId]);
  assert.equal(rows[0].estado, 'activo');
  assert.equal(rows[0].must_reset_password, true);
  assert.equal(await bcrypt.compare(body.password, rows[0].password_hash), true);
});

test('POST /admin/usuarios/:id/reenviar-activacion regenera la contraseña y funciona con bcrypt.compare', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/usuarios/${usuarioGeneralId}/reenviar-activacion`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdmin}` },
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(typeof body.password, 'string');
  assert.ok(body.password.length >= 10);

  const { rows } = await query(`SELECT must_reset_password, password_hash FROM usuarios WHERE id = $1`, [usuarioGeneralId]);
  assert.equal(rows[0].must_reset_password, true);
  assert.equal(await bcrypt.compare(body.password, rows[0].password_hash), true);
});

test('POST /admin/usuarios/:id/reenviar-activacion responde 404 para un usuario inexistente', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/usuarios/${crypto.randomUUID()}/reenviar-activacion`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdmin}` },
  });
  assert.equal(res.status, 404);
});
