import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import authRouter from '../src/routes/auth.js';
import { EN_PRODUCCION, SALTO_PROD } from './util/soloDev.js';

// ============================================================
// POST /api/auth/login sin `panel` en el body: es lo que usa el login
// general (frontend/src/pages/IngresarPanel.jsx) para no obligar a elegir
// de antemano una de las seis URLs de login por panel. El backend debe
// devolver el panel real de la cuenta sin exigir coincidencia; los seis
// logins propios de cada panel (que SIEMPRE mandan `panel`) deben seguir
// exigiendo coincidencia exacta, sin cambios de comportamiento.
// ============================================================

const sufijo = crypto.randomBytes(4).toString('hex');
const PASSWORD = 'clave-de-prueba-123';

let server;
let baseUrl;
let usuarioId;

before(async () => {
  if (EN_PRODUCCION) return; // los tests de BD quedan skipped: no montar nada

  await runMigrations();
  const hash = await bcrypt.hash(PASSWORD, 4);
  // 'aduana_verde' no exige FK de entidad (a diferencia de puerto/mandante/
  // agencia/trazador) — más simple para este fixture, y distinto de
  // 'sicrep' para no depender del viejo default implícito.
  const { rows } = await query(
    `INSERT INTO usuarios (email, nombre, rol, panel, estado, password_hash, must_reset_password)
     VALUES ($1,'Terreno Test','operador','aduana_verde','activo',$2,false) RETURNING id`,
    [`terreno-${sufijo}@ejemplo.cl`, hash]
  );
  usuarioId = rows[0].id;

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
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

test('login SIN panel detecta el panel real de la cuenta y no exige coincidencia', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `terreno-${sufijo}@ejemplo.cl`, password: PASSWORD }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.user.panel, 'aduana_verde');
  assert.ok(body.accessToken);
});

test('login CON el panel correcto sigue funcionando igual que antes', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `terreno-${sufijo}@ejemplo.cl`, password: PASSWORD, panel: 'aduana_verde' }),
  });
  assert.equal(res.status, 200);
});

test('login CON un panel distinto al de la cuenta sigue rechazando con 403', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `terreno-${sufijo}@ejemplo.cl`, password: PASSWORD, panel: 'sicrep' }),
  });
  assert.equal(res.status, 403);
});

test('login con un panel inválido (ni siquiera en la lista) responde 400, no filtra por sicrep', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `terreno-${sufijo}@ejemplo.cl`, password: PASSWORD, panel: 'no-existe' }),
  });
  assert.equal(res.status, 400);
});

test('login sin panel con contraseña incorrecta sigue devolviendo 401 genérico', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `terreno-${sufijo}@ejemplo.cl`, password: 'clave-mala' }),
  });
  assert.equal(res.status, 401);
});
