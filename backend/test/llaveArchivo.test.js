import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../src/config.js';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { signAccess } from '../src/middleware/auth.js';
import { SECCIONES_ADMIN } from '../src/constants/seccionesAdmin.js';
import llaveArchivoRouter from '../src/routes/llaveArchivo.js';
import adminRouter from '../src/routes/admin.js';
import { EN_PRODUCCION, SALTO_PROD } from './util/soloDev.js';

// ============================================================
// Llave de archivo (migración 068): a diferencia de WebAuthn, el login
// no requiere ningún ceremonial criptográfico de navegador — es solo
// serial + token + PIN — así que esta suite SÍ puede cubrir el camino
// de login completo, no solo las guardas.
// ============================================================

const sufijo = crypto.randomBytes(4).toString('hex');
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

let server;
let baseUrl;
let usuarioId;
let usuarioInactivoId;
let tokenAdmin;
let tokenNoAdmin;

before(async () => {
  if (EN_PRODUCCION) return;

  await runMigrations();
  await runMigrations(); // idempotencia, mismo criterio que el resto de la suite

  const { rows } = await query(
    `INSERT INTO usuarios (email, nombre, rol, panel, estado, password_hash, must_reset_password)
     VALUES ($1,'Llave Archivo Test','operador','sicrep','activo','x',false) RETURNING id`,
    [`llave-archivo-${sufijo}@ejemplo.cl`]
  );
  usuarioId = rows[0].id;

  const { rows: ui } = await query(
    `INSERT INTO usuarios (email, nombre, rol, panel, estado, password_hash, must_reset_password)
     VALUES ($1,'Llave Archivo Inactivo','operador','sicrep','suspendido','x',false) RETURNING id`,
    [`llave-archivo-inactivo-${sufijo}@ejemplo.cl`]
  );
  usuarioInactivoId = ui[0].id;

  tokenAdmin = signAccess({ id: crypto.randomUUID(), rol: 'admin', email: `admin-${sufijo}@ejemplo.cl`, panel: 'sicrep', secciones_admin: [...SECCIONES_ADMIN] });
  tokenNoAdmin = signAccess({ id: crypto.randomUUID(), rol: 'operador', email: `op-${sufijo}@ejemplo.cl`, panel: 'sicrep' });

  const app = express();
  app.use(express.json());
  app.use('/api/auth/llave-archivo', llaveArchivoRouter);
  app.use('/api/admin', adminRouter);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!EN_PRODUCCION) {
    if (usuarioId) await query(`DELETE FROM usuarios WHERE id = $1`, [usuarioId]);
    if (usuarioInactivoId) await query(`DELETE FROM usuarios WHERE id = $1`, [usuarioInactivoId]);
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.end(); // SIEMPRE: sin esto node:test se cuelga con el pool abierto
});

// ---------- Guardas de autorización (emisión, vive en admin.js) ----------

test('POST /admin/usuarios/:id/llaves-archivo sin sesión responde 401', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/usuarios/${usuarioId}/llaves-archivo`, { method: 'POST' });
  assert.equal(res.status, 401);
});

test('POST /admin/usuarios/:id/llaves-archivo con rol no-admin responde 403', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/usuarios/${usuarioId}/llaves-archivo`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenNoAdmin}` },
  });
  assert.equal(res.status, 403);
});

test('POST /admin/usuarios/:id/llaves-archivo con usuario inexistente responde 404', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/usuarios/${crypto.randomUUID()}/llaves-archivo`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdmin}` },
  });
  assert.equal(res.status, 404);
});

// ---------- Emisión: token y PIN viajan UNA sola vez ----------

let credencialId, serial, token, pin;

test('POST /admin/usuarios/:id/llaves-archivo emite token+PIN de alta entropía, hasheados en BD', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/usuarios/${usuarioId}/llaves-archivo`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'USB de prueba' }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();

  credencialId = body.credencial.id;
  serial = body.credencial.serial;
  token = body.archivo.token;
  pin = body.pin;

  assert.match(serial, /^LA-[0-9A-F]{4}$/);
  assert.equal(token.length, 96); // 48 bytes hex
  assert.match(pin, /^\d{6}$/);
  assert.deepEqual(body.archivo, { version: 1, tipo: 'llave-archivo', serial, email: `llave-archivo-${sufijo}@ejemplo.cl`, emitida: body.credencial.created_at, token });

  const { rows } = await query(`SELECT token_hash, pin_hash FROM credenciales_archivo WHERE id = $1`, [credencialId]);
  assert.equal(rows[0].token_hash, hashToken(token));
  assert.equal(await bcrypt.compare(pin, rows[0].pin_hash), true);
});

test('GET /admin/usuarios/:id/llaves-archivo lista sin exponer los hashes', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/usuarios/${usuarioId}/llaves-archivo`, {
    headers: { Authorization: `Bearer ${tokenAdmin}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.llaves.length, 1);
  assert.equal(body.llaves[0].nombre, 'USB de prueba');
  assert.equal('token_hash' in body.llaves[0], false);
  assert.equal('pin_hash' in body.llaves[0], false);
});

test('UNIQUE(serial): una segunda fila con el mismo serial falla', { skip: SALTO_PROD }, async () => {
  await assert.rejects(
    query(
      `INSERT INTO credenciales_archivo (usuario_id, serial, token_hash, pin_hash) VALUES ($1,$2,'x','y')`,
      [usuarioId, serial]
    ),
    (err) => err.code === '23505'
  );
});

// ---------- Login: camino feliz y fallos ----------

test('POST /auth/llave-archivo con serial/token/PIN correctos entra con el shape de /auth/login', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/auth/llave-archivo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serial, token, pin }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.accessToken);
  assert.ok(body.refreshToken);
  assert.equal(body.user.email, `llave-archivo-${sufijo}@ejemplo.cl`);
  assert.equal(body.user.panel, 'sicrep');

  const { rows } = await query(`SELECT intentos_fallidos, last_used_at FROM credenciales_archivo WHERE id = $1`, [credencialId]);
  assert.equal(rows[0].intentos_fallidos, 0);
  assert.ok(rows[0].last_used_at);
});

test('un token inválido responde 401 y NO incrementa el contador de bloqueo', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/auth/llave-archivo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serial, token: 'token-que-no-es', pin }),
  });
  assert.equal(res.status, 401);
  const { rows } = await query(`SELECT intentos_fallidos FROM credenciales_archivo WHERE id = $1`, [credencialId]);
  assert.equal(rows[0].intentos_fallidos, 0);
});

test('un PIN incorrecto responde 401 y SÍ incrementa el contador', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/auth/llave-archivo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serial, token, pin: '000000' }),
  });
  assert.equal(res.status, 401);
  const { rows } = await query(`SELECT intentos_fallidos FROM credenciales_archivo WHERE id = $1`, [credencialId]);
  assert.equal(rows[0].intentos_fallidos, 1);
});

test('al 5.º PIN incorrecto se bloquea 15 minutos (429)', { skip: SALTO_PROD }, async () => {
  // Salta directo al 4.º intento fallido por SQL en vez de gastar 3
  // POST más — el punto es probar el bloqueo, no el conteo.
  await query(`UPDATE credenciales_archivo SET intentos_fallidos = 4 WHERE id = $1`, [credencialId]);
  const res = await fetch(`${baseUrl}/api/auth/llave-archivo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serial, token, pin: '000000' }),
  });
  assert.equal(res.status, 429);
  const { rows } = await query(`SELECT intentos_fallidos, bloqueado_hasta FROM credenciales_archivo WHERE id = $1`, [credencialId]);
  assert.equal(rows[0].intentos_fallidos, 5);
  assert.ok(new Date(rows[0].bloqueado_hasta) > new Date());
});

test('bloqueada: incluso el PIN correcto responde 429', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/auth/llave-archivo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serial, token, pin }),
  });
  assert.equal(res.status, 429);
});

test('cuenta inactiva responde 403 tras validar la llave', { skip: SALTO_PROD }, async () => {
  const p2 = await fetch(`${baseUrl}/api/admin/usuarios/${usuarioInactivoId}/llaves-archivo`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const { credencial, archivo, pin: pin2 } = await p2.json();

  const res = await fetch(`${baseUrl}/api/auth/llave-archivo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serial: credencial.serial, token: archivo.token, pin: pin2 }),
  });
  assert.equal(res.status, 403);
});

test('panel que no coincide responde 403 (espejo de /auth/login y webauthn)', { skip: SALTO_PROD }, async () => {
  const p2 = await fetch(`${baseUrl}/api/admin/usuarios/${usuarioId}/llaves-archivo`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const { credencial, archivo, pin: pin2 } = await p2.json();

  const res = await fetch(`${baseUrl}/api/auth/llave-archivo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serial: credencial.serial, token: archivo.token, pin: pin2, panel: 'puerto' }),
  });
  assert.equal(res.status, 403);
  await query(`UPDATE credenciales_archivo SET activo = false WHERE id = $1`, [credencial.id]); // limpieza manual, no cuelga de usuarioId de otro test
});

// ---------- Revocación ----------

test('POST .../revocar de una llave inexistente responde 404', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/usuarios/${usuarioId}/llaves-archivo/${crypto.randomUUID()}/revocar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdmin}` },
  });
  assert.equal(res.status, 404);
});

test('revocar desactiva la llave y el login pasa a responder 401', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/usuarios/${usuarioId}/llaves-archivo/${credencialId}/revocar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdmin}` },
  });
  assert.equal(res.status, 200);

  // Se desbloquea antes de revocar para que el 401 sea por revocación, no por el bloqueo del test anterior.
  await query(`UPDATE credenciales_archivo SET bloqueado_hasta = NULL, intentos_fallidos = 0 WHERE id = $1`, [credencialId]);
  const login = await fetch(`${baseUrl}/api/auth/llave-archivo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serial, token, pin }),
  });
  assert.equal(login.status, 401);
});

test('revocar una llave ya revocada responde 404 (no se puede reactivar por acá)', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/usuarios/${usuarioId}/llaves-archivo/${credencialId}/revocar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdmin}` },
  });
  assert.equal(res.status, 404);
});

// ---------- Regresión: el JWT no debe perder el _id del panel de la cuenta ----------
// El SELECT del login hace JOIN con usuarios; si se olvida traer alguna
// columna *_id, signAccess() la firma como null aunque la cuenta sí la
// tenga, y esa persona queda con la sesión rota en silencio en su propio
// panel (ver requirePanel de cada router, ej. routes/trazador.js).

test('login de una cuenta del panel trazador conserva trazador_id en el JWT', { skip: SALTO_PROD }, async () => {
  const { rows: t } = await query(`INSERT INTO trazadores (nombre) VALUES ('Trazador Test') RETURNING id`);
  const trazadorId = t[0].id;
  const { rows: u } = await query(
    `INSERT INTO usuarios (email, nombre, rol, panel, estado, password_hash, must_reset_password, trazador_id)
     VALUES ($1,'Trazador User','operador','trazador','activo','x',false,$2) RETURNING id`,
    [`trazador-archivo-${sufijo}@ejemplo.cl`, trazadorId]
  );
  const uid = u[0].id;

  const emitir = await fetch(`${baseUrl}/api/admin/usuarios/${uid}/llaves-archivo`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const { credencial, archivo, pin: pinTraz } = await emitir.json();

  const login = await fetch(`${baseUrl}/api/auth/llave-archivo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serial: credencial.serial, token: archivo.token, pin: pinTraz }),
  });
  assert.equal(login.status, 200);
  const { accessToken } = await login.json();
  const payload = jwt.verify(accessToken, config.jwt.accessSecret);
  assert.equal(payload.panel, 'trazador');
  assert.equal(payload.trazador_id, trazadorId);

  await query(`DELETE FROM usuarios WHERE id = $1`, [uid]);
  await query(`DELETE FROM trazadores WHERE id = $1`, [trazadorId]);
});

// ---------- ON DELETE CASCADE ----------

test('ON DELETE CASCADE: borrar el usuario borra sus llaves de archivo', { skip: SALTO_PROD }, async () => {
  const { rows: u } = await query(
    `INSERT INTO usuarios (email, nombre, rol, panel, estado, password_hash, must_reset_password)
     VALUES ($1,'Cascade Archivo','operador','sicrep','activo','x',false) RETURNING id`,
    [`cascade-archivo-${sufijo}@ejemplo.cl`]
  );
  const uid = u[0].id;
  const { rows: c } = await query(
    `INSERT INTO credenciales_archivo (usuario_id, serial, token_hash, pin_hash) VALUES ($1,'LA-CASC','x','y') RETURNING id`,
    [uid]
  );
  await query(`DELETE FROM usuarios WHERE id = $1`, [uid]);
  const { rows: restante } = await query(`SELECT id FROM credenciales_archivo WHERE id = $1`, [c[0].id]);
  assert.equal(restante.length, 0);
});
