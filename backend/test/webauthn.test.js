import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import crypto from 'crypto';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { signAccess } from '../src/middleware/auth.js';
import webauthnRouter from '../src/routes/webauthn.js';
import adminRouter from '../src/routes/admin.js';
import { EN_PRODUCCION, SALTO_PROD } from './util/soloDev.js';

// ============================================================
// Login sin contraseña con llave USB FIDO2 (migración 061). Esta suite
// cubre TODO lo que se puede probar sin un authenticator físico o
// virtual real: guardas de autorización, caminos de error (challenge
// vencido/ausente, respuesta malformada), y las restricciones del modelo
// de datos (UNIQUE, ON DELETE CASCADE, ON CONFLICT DO UPDATE del
// challenge). Las credenciales de prueba se insertan directo por SQL,
// sin pasar por el ceremonial criptográfico real.
//
// Lo que esta suite NO puede cubrir (necesita un navegador real o un
// authenticator virtual tipo CDP/Playwright, no algo que node:test pueda
// simular sin una reimplementación completa del protocolo): que
// Chrome/Edge/Firefox reconozcan el transporte `usb`, la verificación
// criptográfica real de una attestation/assertion de hardware, el
// comportamiento de residentKey de un firmware real, y cualquier
// cancelación/timeout real del usuario. Eso queda para la prueba manual
// con una llave FIDO2 real antes de dar la feature por cerrada.
// ============================================================

const sufijo = crypto.randomBytes(4).toString('hex');

let server;
let baseUrl;
let usuarioId;
let tokenAdmin;
let tokenNoAdmin;

before(async () => {
  if (EN_PRODUCCION) return; // los tests de BD quedan skipped: no montar nada

  await runMigrations();
  // Correrlas dos veces seguidas no debe fallar (idempotencia — mismo
  // criterio que el resto de las migraciones del proyecto).
  await runMigrations();

  const { rows } = await query(
    `INSERT INTO usuarios (email, nombre, rol, panel, estado, password_hash, must_reset_password)
     VALUES ($1,'WebAuthn Test','operador','sicrep','activo','x',false) RETURNING id`,
    [`webauthn-${sufijo}@ejemplo.cl`]
  );
  usuarioId = rows[0].id;

  tokenAdmin = signAccess({ id: crypto.randomUUID(), rol: 'admin', email: `admin-${sufijo}@ejemplo.cl`, panel: 'sicrep' });
  tokenNoAdmin = signAccess({ id: crypto.randomUUID(), rol: 'operador', email: `op-${sufijo}@ejemplo.cl`, panel: 'sicrep' });

  const app = express();
  app.use(express.json());
  app.use('/api/auth/webauthn', webauthnRouter);
  app.use('/api/admin', adminRouter);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!EN_PRODUCCION) {
    if (usuarioId) await query(`DELETE FROM usuarios WHERE id = $1`, [usuarioId]);
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.end(); // SIEMPRE: sin esto node:test se cuelga con el pool abierto
});

// ---------- Guardas de autorización (registro, vive en admin.js) ----------

test('POST /admin/usuarios/:id/webauthn/opciones sin sesión responde 401', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/usuarios/${usuarioId}/webauthn/opciones`, { method: 'POST' });
  assert.equal(res.status, 401);
});

test('POST /admin/usuarios/:id/webauthn/opciones con rol no-admin responde 403', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/usuarios/${usuarioId}/webauthn/opciones`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenNoAdmin}` },
  });
  assert.equal(res.status, 403);
});

test('POST /admin/usuarios/:id/webauthn/opciones con usuario inexistente responde 404', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/usuarios/${crypto.randomUUID()}/webauthn/opciones`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdmin}` },
  });
  assert.equal(res.status, 404);
});

// ---------- Generar opciones de registro: guarda el challenge ----------

test('POST /admin/usuarios/:id/webauthn/opciones (admin) genera opciones y guarda el challenge', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/usuarios/${usuarioId}/webauthn/opciones`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdmin}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.challenge);
  assert.equal(body.rp.name, 'sicr3p');

  const { rows } = await query(
    `SELECT challenge FROM webauthn_challenges WHERE usuario_id = $1 AND tipo = 'registro'`,
    [usuarioId]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].challenge, body.challenge);
});

test('un segundo POST de opciones de registro reemplaza el challenge anterior (ON CONFLICT DO UPDATE)', { skip: SALTO_PROD }, async () => {
  const primero = await (await fetch(`${baseUrl}/api/admin/usuarios/${usuarioId}/webauthn/opciones`, {
    method: 'POST', headers: { Authorization: `Bearer ${tokenAdmin}` },
  })).json();
  const segundo = await (await fetch(`${baseUrl}/api/admin/usuarios/${usuarioId}/webauthn/opciones`, {
    method: 'POST', headers: { Authorization: `Bearer ${tokenAdmin}` },
  })).json();
  assert.notEqual(primero.challenge, segundo.challenge);

  const { rows } = await query(
    `SELECT challenge FROM webauthn_challenges WHERE usuario_id = $1 AND tipo = 'registro'`,
    [usuarioId]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].challenge, segundo.challenge);
});

// ---------- Registro con respuesta malformada / challenge vencido ----------

test('POST /admin/usuarios/:id/webauthn/verificar con respuesta malformada responde 400', { skip: SALTO_PROD }, async () => {
  await query(
    `INSERT INTO webauthn_challenges (usuario_id, tipo, challenge, expires_at)
     VALUES ($1,'registro','challenge-de-prueba',$2)
     ON CONFLICT (usuario_id, tipo) DO UPDATE SET challenge = EXCLUDED.challenge, expires_at = EXCLUDED.expires_at`,
    [usuarioId, new Date(Date.now() + 120000)]
  );
  const res = await fetch(`${baseUrl}/api/admin/usuarios/${usuarioId}/webauthn/verificar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ respuesta: { esto: 'no es una respuesta WebAuthn real' }, nombre_dispositivo: 'Llave de prueba' }),
  });
  assert.equal(res.status, 400);
});

test('POST /admin/usuarios/:id/webauthn/verificar sin challenge previo responde 400', { skip: SALTO_PROD }, async () => {
  await query(`DELETE FROM webauthn_challenges WHERE usuario_id = $1 AND tipo = 'registro'`, [usuarioId]);
  const res = await fetch(`${baseUrl}/api/admin/usuarios/${usuarioId}/webauthn/verificar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ respuesta: { id: 'algo' } }),
  });
  assert.equal(res.status, 400);
});

test('POST /admin/usuarios/:id/webauthn/verificar con challenge vencido responde 400', { skip: SALTO_PROD }, async () => {
  await query(
    `INSERT INTO webauthn_challenges (usuario_id, tipo, challenge, expires_at)
     VALUES ($1,'registro','challenge-vencido',$2)
     ON CONFLICT (usuario_id, tipo) DO UPDATE SET challenge = EXCLUDED.challenge, expires_at = EXCLUDED.expires_at`,
    [usuarioId, new Date(Date.now() - 1000)]
  );
  const res = await fetch(`${baseUrl}/api/admin/usuarios/${usuarioId}/webauthn/verificar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ respuesta: { id: 'algo' } }),
  });
  assert.equal(res.status, 400);
});

// ---------- Modelo de datos: fixture insertado directo por SQL ----------

let credencialId;
const CREDENTIAL_ID = `cred-${crypto.randomBytes(8).toString('base64url')}`;

test('insertar una credencial de prueba directo por SQL', { skip: SALTO_PROD }, async () => {
  const { rows } = await query(
    `INSERT INTO credenciales_webauthn (usuario_id, credential_id, public_key, counter, nombre_dispositivo)
     VALUES ($1,$2,'clave-publica-de-prueba',0,'Llave de prueba') RETURNING id`,
    [usuarioId, CREDENTIAL_ID]
  );
  credencialId = rows[0].id;
  assert.ok(credencialId);
});

test('UNIQUE(credential_id): una segunda fila con el mismo credential_id falla', { skip: SALTO_PROD }, async () => {
  await assert.rejects(
    query(
      `INSERT INTO credenciales_webauthn (usuario_id, credential_id, public_key, counter)
       VALUES ($1,$2,'otra-clave',0)`,
      [usuarioId, CREDENTIAL_ID]
    ),
    (err) => err.code === '23505'
  );
});

test('GET /admin/usuarios/:id/webauthn lista las llaves registradas', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/usuarios/${usuarioId}/webauthn`, {
    headers: { Authorization: `Bearer ${tokenAdmin}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.llaves.length, 1);
  assert.equal(body.llaves[0].nombre_dispositivo, 'Llave de prueba');
});

// ---------- Login: opciones con credenciales existentes ----------

test('POST /auth/webauthn/login/opciones con email inexistente responde 401 genérico', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/auth/webauthn/login/opciones`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `no-existe-${sufijo}@ejemplo.cl` }),
  });
  assert.equal(res.status, 401);
});

test('POST /auth/webauthn/login/opciones con cuenta que SÍ tiene llave devuelve allowCredentials', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/auth/webauthn/login/opciones`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `webauthn-${sufijo}@ejemplo.cl` }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.allowCredentials.length, 1);
  assert.equal(body.allowCredentials[0].id, CREDENTIAL_ID);

  const { rows } = await query(
    `SELECT challenge FROM webauthn_challenges WHERE usuario_id = $1 AND tipo = 'login'`,
    [usuarioId]
  );
  assert.equal(rows.length, 1);
});

test('POST /auth/webauthn/login/verificar con respuesta malformada responde 400 (no revienta el proceso)', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/auth/webauthn/login/verificar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `webauthn-${sufijo}@ejemplo.cl`, respuesta: { id: CREDENTIAL_ID, esto: 'no es real' } }),
  });
  assert.equal(res.status, 400);
});

test('POST /auth/webauthn/login/verificar con panel que no coincide responde 403 (espejo de /auth/login)', { skip: SALTO_PROD }, async () => {
  // El fixture es panel 'sicrep': pedir 'puerto' debe rebotar en el
  // servidor, sin depender del check del cliente.
  const res = await fetch(`${baseUrl}/api/auth/webauthn/login/verificar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `webauthn-${sufijo}@ejemplo.cl`, panel: 'puerto', respuesta: { id: CREDENTIAL_ID } }),
  });
  assert.equal(res.status, 403);
});

test('POST /auth/webauthn/login/verificar con un credential_id que no pertenece a la cuenta responde 401', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/auth/webauthn/login/verificar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `webauthn-${sufijo}@ejemplo.cl`, respuesta: { id: 'credential-que-no-existe' } }),
  });
  assert.equal(res.status, 401);
});

// ---------- DELETE de la llave ----------

test('DELETE /admin/usuarios/:id/webauthn/:credencialId de una llave inexistente responde 404', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/usuarios/${usuarioId}/webauthn/${crypto.randomUUID()}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenAdmin}` },
  });
  assert.equal(res.status, 404);
});

test('DELETE /admin/usuarios/:id/webauthn/:credencialId elimina la llave', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/usuarios/${usuarioId}/webauthn/${credencialId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenAdmin}` },
  });
  assert.equal(res.status, 200);
  const { rows } = await query(`SELECT id FROM credenciales_webauthn WHERE id = $1`, [credencialId]);
  assert.equal(rows.length, 0);
});

// ---------- ON DELETE CASCADE ----------

test('ON DELETE CASCADE: borrar el usuario borra sus credenciales y challenges', { skip: SALTO_PROD }, async () => {
  const { rows: u } = await query(
    `INSERT INTO usuarios (email, nombre, rol, panel, estado, password_hash, must_reset_password)
     VALUES ($1,'Cascade Test','operador','sicrep','activo','x',false) RETURNING id`,
    [`cascade-${sufijo}@ejemplo.cl`]
  );
  const uid = u[0].id;
  await query(
    `INSERT INTO credenciales_webauthn (usuario_id, credential_id, public_key, counter)
     VALUES ($1,$2,'clave',0)`,
    [uid, `cred-cascade-${sufijo}`]
  );
  await query(
    `INSERT INTO webauthn_challenges (usuario_id, tipo, challenge, expires_at)
     VALUES ($1,'login','challenge-cascade',$2)`,
    [uid, new Date(Date.now() + 120000)]
  );

  await query(`DELETE FROM usuarios WHERE id = $1`, [uid]);

  const { rows: credRows } = await query(`SELECT id FROM credenciales_webauthn WHERE usuario_id = $1`, [uid]);
  const { rows: chRows } = await query(`SELECT id FROM webauthn_challenges WHERE usuario_id = $1`, [uid]);
  assert.equal(credRows.length, 0);
  assert.equal(chRows.length, 0);
});
