import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { signAccess } from '../src/middleware/auth.js';
import { hashApiKey } from '../src/services/mandante.js';
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
let usuarioPuertoId;
let puertoId;
let tokenAdmin;
let tokenSuperadmin;

before(async () => {
  if (EN_PRODUCCION) return; // los tests de BD quedan skipped: no montar nada

  await runMigrations();

  const { rows: clientes } = await query(
    `INSERT INTO clientes (rut, nombre_empresa, contacto_email) VALUES ($1,$2,$3) RETURNING id`,
    [`${crypto.randomInt(10000000, 99999999)}-${sufijo.slice(0, 1)}`, `Cliente Test ${sufijo}`, `contacto-${sufijo}@ejemplo.cl`]
  );
  clienteId = clientes[0].id;

  const { rows: puertos } = await query(
    `INSERT INTO puertos (nombre, punto_id, token_hash, activo) VALUES ($1,$2,$3,true) RETURNING id`,
    [`Puerto Cuentas ${sufijo}`, `pt-cuentas-${sufijo}`, hashApiKey(`pto_cuentas_${sufijo}`)]
  );
  puertoId = puertos[0].id;

  tokenAdmin = signAccess({ id: crypto.randomUUID(), rol: 'admin', email: `admin-${sufijo}@ejemplo.cl`, panel: 'sicrep' });
  tokenSuperadmin = signAccess({
    id: crypto.randomUUID(), rol: 'admin', email: `super-${sufijo}@ejemplo.cl`,
    panel: 'sicrep', es_superadmin: true,
  });

  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!EN_PRODUCCION) {
    if (usuarioPuertoId) await query(`DELETE FROM usuarios WHERE id = $1`, [usuarioPuertoId]);
    if (usuarioGeneralId) await query(`DELETE FROM usuarios WHERE id = $1`, [usuarioGeneralId]);
    if (usuarioClienteId) await query(`DELETE FROM usuarios WHERE id = $1`, [usuarioClienteId]);
    if (puertoId) await query(`DELETE FROM puertos WHERE id = $1`, [puertoId]);
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

// ============================================================
// Pantalla única de cuentas (Usuarios.jsx): POST /admin/usuarios ahora
// también da de alta cuentas de los 5 paneles externos (delegando en
// crearCuentaEntidad, compartida con routes/accesos.js), y GET/PUT
// exponen es_superadmin/nivel_acceso (migraciones 069/070).
// ============================================================

test('GET /admin/usuarios incluye es_superadmin y nivel_acceso', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/usuarios`, {
    headers: { Authorization: `Bearer ${tokenAdmin}` },
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  const fila = body.usuarios.find((u) => u.id === usuarioGeneralId);
  assert.equal(fila.es_superadmin, false);
  assert.equal(fila.nivel_acceso, 'operador');
});

test('POST /admin/usuarios con panel externo sin entidad_id responde 400', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/usuarios`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `sin-entidad-${sufijo}@ejemplo.cl`, nombre: 'Sin Entidad', panel: 'puerto' }),
  });
  assert.equal(res.status, 400);
});

test('POST /admin/usuarios con panel="puerto" delega en crearCuentaEntidad y respeta nivel_acceso', { skip: SALTO_PROD }, async () => {
  const email = `puerto-${sufijo}@ejemplo.cl`;
  const res = await fetch(`${baseUrl}/api/admin/usuarios`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, nombre: 'Operador Puerto', panel: 'puerto', entidad_id: puertoId, nivel_acceso: 'lectura' }),
  });
  const body = await res.json();
  assert.equal(res.status, 201);
  assert.equal(body.email, email);
  assert.equal(typeof body.password, 'string');
  usuarioPuertoId = body.usuario_id;

  const { rows } = await query(`SELECT panel, puerto_id, nivel_acceso, rol FROM usuarios WHERE id = $1`, [usuarioPuertoId]);
  assert.equal(rows[0].panel, 'puerto');
  assert.equal(rows[0].puerto_id, puertoId);
  assert.equal(rows[0].nivel_acceso, 'lectura');
  assert.equal(rows[0].rol, 'operador');
});

test('PUT /admin/usuarios/:id acepta nivel_acceso pero ignora es_superadmin si el llamador no es superadmin', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/usuarios/${usuarioGeneralId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nivel_acceso: 'lectura', es_superadmin: true }),
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.usuario.nivel_acceso, 'lectura');
  assert.equal(body.usuario.es_superadmin, false); // sin efecto: tokenAdmin no es superadmin

  const { rows } = await query(`SELECT es_superadmin FROM usuarios WHERE id = $1`, [usuarioGeneralId]);
  assert.equal(rows[0].es_superadmin, false);
});

test('PUT /admin/usuarios/:id honra es_superadmin cuando el llamador SÍ es superadmin', { skip: SALTO_PROD }, async () => {
  // El CHECK usuarios_superadmin_requiere_sicrep_admin exige panel='sicrep'
  // Y rol='admin' — usuarioGeneralId nació con rol='operador' (test de
  // arriba), así que este PUT sube ambos campos en la MISMA sentencia:
  // Postgres evalúa el CHECK sobre el estado final de la fila, no sobre
  // pasos intermedios.
  const res = await fetch(`${baseUrl}/api/admin/usuarios/${usuarioGeneralId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${tokenSuperadmin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rol: 'admin', es_superadmin: true }),
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.usuario.es_superadmin, true);

  // Revertir a como estaba (rol operador, sin superadmin) para no dejar
  // una fixture de superadmin de sobra en la BD de test.
  await query(`UPDATE usuarios SET es_superadmin = false, rol = 'operador' WHERE id = $1`, [usuarioGeneralId]);
});
