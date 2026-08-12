import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import crypto from 'crypto';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { signAccess } from '../src/middleware/auth.js';
import { SECCIONES_ADMIN } from '../src/constants/seccionesAdmin.js';
import capitalRouter from '../src/routes/capital.js';
import buscarRouter from '../src/routes/buscar.js';
import transporteRouter from '../src/routes/transporte.js';
import { EN_PRODUCCION, SALTO_PROD } from './util/soloDev.js';

// ============================================================
// Gate por sección (migración 092 + requireSeccion) aplicado a los
// routers reales — no un router de juguete: si alguien quita el
// middleware de capital.js/buscar.js/transporte.js, esto falla.
// Mismo patrón de integración que adminCuentas.test.js.
// ============================================================

// Snapshot CONGELADO del backfill de la migración 092 — NO es
// SECCIONES_ADMIN.length (que sigue creciendo; hoy 24 con 'proveedores'
// de la migración 097, que a propósito NO se backfillea). Si algún día
// agregas una sección que SÍ deba backfillearse a cuentas existentes,
// ese número necesita su propio assert — no toques esta constante para
// "arreglarla", significaría romper el backfill congelado que describe.
const SECCIONES_BACKFILL_092 = 23;

const sufijo = crypto.randomBytes(4).toString('hex');

let server;
let baseUrl;

const tokenConTodo = () => signAccess({
  id: crypto.randomUUID(), rol: 'admin', email: `todo-${sufijo}@ejemplo.cl`,
  panel: 'sicrep', secciones_admin: [...SECCIONES_ADMIN],
});
const tokenSinSecciones = () => signAccess({
  id: crypto.randomUUID(), rol: 'admin', email: `nada-${sufijo}@ejemplo.cl`,
  panel: 'sicrep', secciones_admin: [],
});
const tokenSoloBuscar = () => signAccess({
  id: crypto.randomUUID(), rol: 'operador', email: `buscar-${sufijo}@ejemplo.cl`,
  panel: 'sicrep', secciones_admin: ['buscar'],
});
const tokenSuperadminSinSecciones = () => signAccess({
  id: crypto.randomUUID(), rol: 'admin', email: `super-${sufijo}@ejemplo.cl`,
  panel: 'sicrep', es_superadmin: true, secciones_admin: [],
});

before(async () => {
  if (EN_PRODUCCION) return;
  await runMigrations();
  const app = express();
  app.use(express.json());
  app.use('/api/admin/capital', capitalRouter);
  app.use('/api/admin/buscar', buscarRouter);
  app.use('/api/admin/transporte', transporteRouter);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

const get = (path, token) => fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });

test('capital: cuenta con la sección entra; sin la sección 403; superadmin sin sección entra igual', { skip: SALTO_PROD }, async () => {
  assert.notEqual((await get('/api/admin/capital/cuentas', tokenConTodo())).status, 403);
  const res = await get('/api/admin/capital/cuentas', tokenSinSecciones());
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /sección/);
  assert.notEqual((await get('/api/admin/capital/cuentas', tokenSuperadminSinSecciones())).status, 403);
});

test('buscar: la sección "buscar" abre buscar pero NO transporte (aislamiento entre secciones)', { skip: SALTO_PROD }, async () => {
  assert.notEqual((await get(`/api/admin/buscar?q=${sufijo}`, tokenSoloBuscar())).status, 403);
  assert.equal((await get('/api/admin/transporte/viajes', tokenSoloBuscar())).status, 403);
});

test('backfill 092: una cuenta sicrep preexistente conserva las 23 secciones tras migrar; un alta nueva sin selección queda vacía (fail-closed)', { skip: SALTO_PROD }, async () => {
  // El backfill ya corrió en runMigrations() sobre las cuentas que existían.
  // Se verifica su efecto observable: cualquier fila sicrep anterior a la
  // migración tiene las 23 secciones (acá basta con que el UPDATE haya
  // dejado el default lleno en las cuentas viejas — la de seed existe
  // desde 001). 23 a propósito, NO SECCIONES_ADMIN.length: ese backfill
  // quedó fijo en el vocabulario de 092; secciones agregadas después
  // (ej. 'proveedores' en 097) son deliberadamente SIN backfill — una
  // cuenta vieja no gana de la nada una sección que nadie le asignó.
  const { rows: viejas } = await query(
    `SELECT secciones_admin FROM usuarios WHERE panel = 'sicrep' ORDER BY created_at ASC LIMIT 1`
  );
  if (viejas[0]) {
    assert.equal(viejas[0].secciones_admin.length, SECCIONES_BACKFILL_092);
  }

  // Alta nueva sin especificar secciones → '{}' (el default fail-closed).
  const email = `nuevo-${sufijo}@ejemplo.cl`;
  const { rows } = await query(
    `INSERT INTO usuarios (email, nombre, rol, panel, estado, password_hash)
     VALUES ($1,'Nuevo','operador','sicrep','activo','hash-de-prueba') RETURNING secciones_admin`,
    [email]
  );
  assert.deepEqual(rows[0].secciones_admin, []);
  await query(`DELETE FROM usuarios WHERE email = $1`, [email]);

  // CHECK del vocabulario: un slug inventado no entra ni por SQL directo.
  await assert.rejects(query(
    `INSERT INTO usuarios (email, nombre, rol, panel, estado, password_hash, secciones_admin)
     VALUES ($1,'X','operador','sicrep','activo','h','{inventada}')`,
    [`x-${sufijo}@ejemplo.cl`]
  ));
});
