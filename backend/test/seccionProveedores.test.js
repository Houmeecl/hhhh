import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import crypto from 'crypto';
import { pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { signAccess } from '../src/middleware/auth.js';
import { SECCIONES_ADMIN, seccionesValidas } from '../src/constants/seccionesAdmin.js';
import accesosRouter from '../src/routes/accesos.js';
import adminRouter from '../src/routes/admin.js';
import { EN_PRODUCCION, SALTO_PROD } from './util/soloDev.js';

// ============================================================
// Migración 097: 'proveedores' es un alias MÁS ANGOSTO de
// 'accesos_externos' (routes/accesos.js) y 'sii' (routes/admin.js) —
// solo para los endpoints que gestionan empresas proveedoras, nunca
// mandantes/puertos/agencias/trazadores. Puramente aditivo: nada que
// 'accesos_externos'/'sii' ya otorgaban se retira (regresión cubierta
// abajo, mismo criterio que RBAC7 en requireSeccionRutas.test.js).
// ============================================================

const sufijo = crypto.randomBytes(4).toString('hex');

let server;
let baseUrl;

const tokenSoloProveedores = () => signAccess({
  id: crypto.randomUUID(), rol: 'admin', email: `prov-${sufijo}@ejemplo.cl`,
  panel: 'sicrep', secciones_admin: ['proveedores'],
});
const tokenSoloAccesosExternos = () => signAccess({
  id: crypto.randomUUID(), rol: 'admin', email: `acc-${sufijo}@ejemplo.cl`,
  panel: 'sicrep', secciones_admin: ['accesos_externos'],
});
const tokenSoloSii = () => signAccess({
  id: crypto.randomUUID(), rol: 'admin', email: `sii-${sufijo}@ejemplo.cl`,
  panel: 'sicrep', secciones_admin: ['sii'],
});

before(async () => {
  if (EN_PRODUCCION) return;
  await runMigrations();
  const app = express();
  app.use(express.json());
  app.use('/api/admin/accesos', accesosRouter);
  app.use('/api/admin', adminRouter);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

const get = (path, token) => fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });

test('proveedores: vocabulario acepta el slug nuevo', () => {
  assert.ok(SECCIONES_ADMIN.includes('proveedores'));
  assert.equal(seccionesValidas(['proveedores']), true);
});

test('una cuenta con SOLO "proveedores" entra a /admin/accesos/proveedores y a /admin/sii/empresas', { skip: SALTO_PROD }, async () => {
  const token = tokenSoloProveedores();
  assert.notEqual((await get('/api/admin/accesos/proveedores', token)).status, 403);
  assert.notEqual((await get('/api/admin/sii/empresas', token)).status, 403);
});

test('una cuenta con SOLO "proveedores" NO entra a otras entidades de accesos_externos', { skip: SALTO_PROD }, async () => {
  const token = tokenSoloProveedores();
  const res = await get('/api/admin/accesos/mandantes', token);
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /sección/);
});

test('regresión: "accesos_externos" solo (sin "proveedores") sigue entrando a /proveedores igual que siempre', { skip: SALTO_PROD }, async () => {
  const token = tokenSoloAccesosExternos();
  assert.notEqual((await get('/api/admin/accesos/proveedores', token)).status, 403);
  assert.notEqual((await get('/api/admin/accesos/mandantes', token)).status, 403);
});

test('regresión: "sii" solo (sin "proveedores") sigue entrando a /sii/empresas igual que siempre', { skip: SALTO_PROD }, async () => {
  const token = tokenSoloSii();
  assert.notEqual((await get('/api/admin/sii/empresas', token)).status, 403);
});

test('una cuenta sin ninguna de las dos secciones sigue sin poder entrar (nada se abrió de más)', { skip: SALTO_PROD }, async () => {
  const token = signAccess({ id: crypto.randomUUID(), rol: 'admin', email: `nada-${sufijo}@ejemplo.cl`, panel: 'sicrep', secciones_admin: [] });
  assert.equal((await get('/api/admin/accesos/proveedores', token)).status, 403);
  assert.equal((await get('/api/admin/sii/empresas', token)).status, 403);
});
