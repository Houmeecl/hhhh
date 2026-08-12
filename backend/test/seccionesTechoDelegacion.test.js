import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import crypto from 'crypto';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { signAccess } from '../src/middleware/auth.js';
import { SECCIONES_ADMIN, seccionesNoOtorgables } from '../src/constants/seccionesAdmin.js';
import adminRouter from '../src/routes/admin.js';
import { EN_PRODUCCION, SALTO_PROD } from './util/soloDev.js';

// ============================================================
// Techo de delegación: nadie otorga secciones que su propia cuenta no
// tiene. Cierra la escalada silenciosa que existía — un admin con la
// sección 'usuarios' se editaba a SÍ MISMO y se quedaba con el
// vocabulario completo (no llegaba a superadmin, protegido aparte por la
// migración 069, pero sí al equivalente funcional de "ver y usar todo").
// ============================================================

const sufijo = crypto.randomBytes(4).toString('hex');

let server;
let baseUrl;
let victimaId;

// Admin acotado: administra usuarios, pero solo ve prospectos además.
const tokenAcotado = () => signAccess({
  id: crypto.randomUUID(), rol: 'admin', email: `acotado-${sufijo}@ejemplo.cl`,
  panel: 'sicrep', secciones_admin: ['dashboard', 'usuarios', 'prospectos'],
});
const tokenSuperadmin = () => signAccess({
  id: crypto.randomUUID(), rol: 'admin', email: `super-${sufijo}@ejemplo.cl`,
  panel: 'sicrep', es_superadmin: true, secciones_admin: [],
});

before(async () => {
  if (EN_PRODUCCION) return;
  await runMigrations();
  const { rows } = await query(
    `INSERT INTO usuarios (email, nombre, rol, panel, estado, password_hash, secciones_admin)
     VALUES ($1,'Víctima','operador','sicrep','activo','hash-de-prueba', ARRAY['dashboard'])
     RETURNING id`,
    [`victima-${sufijo}@ejemplo.cl`]
  );
  victimaId = rows[0].id;

  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!EN_PRODUCCION) {
    await query(`DELETE FROM usuarios WHERE email LIKE $1`, [`%-${sufijo}@ejemplo.cl`]);
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

const put = (id, body, token) => fetch(`${baseUrl}/api/admin/usuarios/${id}`, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const post = (body, token) => fetch(`${baseUrl}/api/admin/usuarios`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// ---------- función pura ----------

test('seccionesNoOtorgables: devuelve solo las que el otorgante no tiene', () => {
  assert.deepEqual(seccionesNoOtorgables(['clientes', 'sii'], ['clientes']), ['sii']);
  assert.deepEqual(seccionesNoOtorgables(['clientes'], ['clientes', 'sii']), []);
  assert.deepEqual(seccionesNoOtorgables([], ['clientes']), []);
});

test("seccionesNoOtorgables: 'dashboard' nunca cuenta (el selector lo manda siempre marcado)", () => {
  assert.deepEqual(seccionesNoOtorgables(['dashboard'], []), []);
  assert.deepEqual(seccionesNoOtorgables(['dashboard', 'usuarios'], ['usuarios']), []);
});

// ---------- el camino de escalada que se cerró ----------

test('un admin acotado NO puede auto-otorgarse el vocabulario completo', { skip: SALTO_PROD }, async () => {
  const token = tokenAcotado();
  const res = await put(victimaId, { secciones_admin: [...SECCIONES_ADMIN] }, token);
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /no puedes otorgar secciones/i);

  // Y la fila no se movió.
  const { rows } = await query(`SELECT secciones_admin FROM usuarios WHERE id = $1`, [victimaId]);
  assert.deepEqual(rows[0].secciones_admin, ['dashboard']);
});

test('tampoco puede colar UNA sección ajena entre varias propias', { skip: SALTO_PROD }, async () => {
  const res = await put(victimaId, { secciones_admin: ['dashboard', 'prospectos', 'motor_externo'] }, tokenAcotado());
  assert.equal(res.status, 403);
  // El mensaje nombra la sección concreta, no un "no autorizado" opaco.
  assert.match((await res.json()).error, /motor_externo/);
});

test('sí puede otorgar el subconjunto que él mismo tiene', { skip: SALTO_PROD }, async () => {
  const res = await put(victimaId, { secciones_admin: ['dashboard', 'prospectos'] }, tokenAcotado());
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).usuario.secciones_admin, ['dashboard', 'prospectos']);
});

test('el alta (POST) tiene el mismo techo que la edición', { skip: SALTO_PROD }, async () => {
  const res = await post(
    { email: `nuevo-${sufijo}@ejemplo.cl`, nombre: 'Nuevo', rol: 'operador', secciones_admin: ['dashboard', 'usuarios', 'datos_personales'] },
    tokenAcotado()
  );
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /datos_personales/);
});

test('el superadmin queda exento: otorga cualquier sección', { skip: SALTO_PROD }, async () => {
  const res = await put(victimaId, { secciones_admin: [...SECCIONES_ADMIN] }, tokenSuperadmin());
  assert.equal(res.status, 200);
  assert.equal((await res.json()).usuario.secciones_admin.length, SECCIONES_ADMIN.length);
});

test('sin secciones_admin en el body, el techo no estorba (edición de otro campo)', { skip: SALTO_PROD }, async () => {
  const res = await put(victimaId, { nombre: 'Víctima renombrada' }, tokenAcotado());
  assert.equal(res.status, 200);
  assert.equal((await res.json()).usuario.nombre, 'Víctima renombrada');
});
