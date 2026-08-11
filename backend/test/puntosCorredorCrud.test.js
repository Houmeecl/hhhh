import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import crypto from 'crypto';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { signAccess } from '../src/middleware/auth.js';
import corredorRoutes from '../src/routes/corredor.js';
import publicRoutes from '../src/routes/public.js';
import { invalidarCacheCatalogo } from '../src/services/catalogoCorredor.js';
import { SECCIONES_ADMIN } from '../src/constants/seccionesAdmin.js';
import { EN_PRODUCCION, SALTO_PROD } from './util/soloDev.js';

// ============================================================
// CRUD del catálogo de puntos del corredor (tabla puntos_corredor,
// migración 093) — reglas duras: id inmutable, sin DELETE (solo
// activo=false), y un punto desactivado sale del endpoint público pero
// su fila persiste (los eslabones históricos referencian el id).
// ============================================================

const ID_TEST = 'punto-crud-test';
let server;
let baseUrl;
let adminToken;

before(async () => {
  if (EN_PRODUCCION) return;
  await runMigrations();
  await query(`DELETE FROM puntos_corredor WHERE id = $1`, [ID_TEST]);
  invalidarCacheCatalogo();

  adminToken = signAccess({
    id: crypto.randomUUID(), rol: 'admin', email: 'admin-puntos@ejemplo.cl',
    panel: 'sicrep', secciones_admin: SECCIONES_ADMIN,
  });

  const app = express();
  app.use(express.json());
  app.use('/api/admin/corredor', corredorRoutes);
  app.use('/api', publicRoutes);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!EN_PRODUCCION) {
    await query(`DELETE FROM puntos_corredor WHERE id = $1`, [ID_TEST]);
    invalidarCacheCatalogo();
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

const auth = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` });

test('POST /puntos crea un punto y aparece en el endpoint público', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/corredor/puntos`, {
    method: 'POST', headers: auth(),
    body: JSON.stringify({ id: ID_TEST, nombre: 'Báscula de prueba', pais: 'CL', lat: -23.2, lng: -69.5, orden: 990 }),
  });
  assert.equal(res.status, 201);
  const pub = await (await fetch(`${baseUrl}/api/corredor/puntos`)).json();
  assert.ok(pub.puntos.some((p) => p.id === ID_TEST));
});

test('POST /puntos con slug inválido → 400; con id repetido → 409', { skip: SALTO_PROD }, async () => {
  const malo = await fetch(`${baseUrl}/api/admin/corredor/puntos`, {
    method: 'POST', headers: auth(),
    body: JSON.stringify({ id: 'Slug Inválido!', nombre: 'X', pais: 'CL', lat: -23, lng: -69, orden: 991 }),
  });
  assert.equal(malo.status, 400);
  const repetido = await fetch(`${baseUrl}/api/admin/corredor/puntos`, {
    method: 'POST', headers: auth(),
    body: JSON.stringify({ id: ID_TEST, nombre: 'Otro', pais: 'CL', lat: -23, lng: -69, orden: 992 }),
  });
  assert.equal(repetido.status, 409);
});

test('PUT /puntos/:id edita y desactiva: sale del público, la fila persiste', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/corredor/puntos/${ID_TEST}`, {
    method: 'PUT', headers: auth(),
    body: JSON.stringify({ nombre: 'Báscula editada', pais: 'CL', lat: -23.3, lng: -69.6, orden: 990, activo: false }),
  });
  assert.equal(res.status, 200);
  const { punto } = await res.json();
  assert.equal(punto.nombre, 'Báscula editada');
  assert.equal(punto.activo, false);

  const pub = await (await fetch(`${baseUrl}/api/corredor/puntos`)).json();
  assert.ok(!pub.puntos.some((p) => p.id === ID_TEST), 'desactivado no aparece en el público');
  const { rows } = await query(`SELECT activo FROM puntos_corredor WHERE id = $1`, [ID_TEST]);
  assert.equal(rows[0].activo, false); // la fila sigue — no hay DELETE
});

test('PUT a un id inexistente → 404; sin token → 401', { skip: SALTO_PROD }, async () => {
  const noExiste = await fetch(`${baseUrl}/api/admin/corredor/puntos/no-existe`, {
    method: 'PUT', headers: auth(),
    body: JSON.stringify({ nombre: 'X', pais: 'CL', lat: -23, lng: -69, orden: 1 }),
  });
  assert.equal(noExiste.status, 404);
  const sinToken = await fetch(`${baseUrl}/api/admin/corredor/puntos`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'x-y-z', nombre: 'X', pais: 'CL', lat: -23, lng: -69, orden: 1 }),
  });
  assert.equal(sinToken.status, 401);
});
