import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import crypto from 'crypto';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { signAccess } from '../src/middleware/auth.js';
import accesosRouter from '../src/routes/accesos.js';
import { EN_PRODUCCION, SALTO_PROD } from './util/soloDev.js';

// ============================================================
// Enrolamiento de una empresa en un solo paso (admin/Enrolar.jsx): el
// formulario pide RUT y correo, NO el nombre de la persona de contacto —
// esa persona todavía no se conoce, la empresa la completa después en su
// onboarding. Contra eso se prueban las dos rutas que sostienen el flujo:
//
//  1. POST /proveedores/:id/crear-cuenta con solo { email } tiene que
//     funcionar (usa la razón social como nombre). Antes respondía
//     "Email y nombre son obligatorios": la empresa quedaba creada pero
//     sin invitación, y el admin no se enteraba.
//  2. POST /proveedores/:id/reenviar-invitacion, la salida al 409 de
//     arriba — el caso real de "el correo se perdió". Manda SIEMPRE al
//     correo registrado, nunca a uno que venga en el request.
// ============================================================

const sufijo = crypto.randomBytes(4).toString('hex');

let server;
let baseUrl;
let proveedorId;
let proveedorSinCuentaId;
let tokenAdmin;

const email = `contacto-${sufijo}@ejemplo.cl`;
const RAZON_SOCIAL = `Áridos de Prueba ${sufijo} SpA`;

before(async () => {
  if (EN_PRODUCCION) return;
  await runMigrations();

  const { rows } = await query(
    `INSERT INTO proveedores (nombre_empresa, rut) VALUES ($1,$2) RETURNING id`,
    [RAZON_SOCIAL, `7${crypto.randomInt(1000000, 9999999)}${sufijo.slice(0, 1).toUpperCase()}`]
  );
  proveedorId = rows[0].id;

  const { rows: otro } = await query(
    `INSERT INTO proveedores (nombre_empresa, rut) VALUES ($1,$2) RETURNING id`,
    [`Sin Cuenta ${sufijo} Ltda`, `7${crypto.randomInt(1000000, 9999999)}${sufijo.slice(1, 2).toUpperCase()}`]
  );
  proveedorSinCuentaId = otro[0].id;

  tokenAdmin = signAccess({
    id: crypto.randomUUID(), rol: 'admin', email: `admin-${sufijo}@ejemplo.cl`, panel: 'sicrep',
  });

  const app = express();
  app.use(express.json());
  app.use('/api/admin/accesos', accesosRouter);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!EN_PRODUCCION) {
    for (const id of [proveedorId, proveedorSinCuentaId].filter(Boolean)) {
      await query(
        `DELETE FROM tokens_password WHERE usuario_id IN (SELECT id FROM usuarios WHERE proveedor_id = $1)`, [id]
      );
      await query(`DELETE FROM usuarios WHERE proveedor_id = $1`, [id]);
      await query(`DELETE FROM proveedores WHERE id = $1`, [id]);
    }
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

const pedir = (ruta, body) => fetch(`${baseUrl}${ruta}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdmin}` },
  body: JSON.stringify(body || {}),
});

test('crear-cuenta con solo el correo usa la razón social como nombre', { skip: SALTO_PROD }, async () => {
  const res = await pedir(`/api/admin/accesos/proveedores/${proveedorId}/crear-cuenta`, { email });
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.email, email);

  const { rows } = await query(`SELECT nombre, panel FROM usuarios WHERE id = $1`, [data.usuario_id]);
  assert.equal(rows[0].nombre, RAZON_SOCIAL);
  assert.equal(rows[0].panel, 'proveedor');
});

test('crear-cuenta sobre una empresa que ya tiene acceso responde 409', { skip: SALTO_PROD }, async () => {
  const res = await pedir(`/api/admin/accesos/proveedores/${proveedorId}/crear-cuenta`, {
    email: `otro-${sufijo}@ejemplo.cl`,
  });
  assert.equal(res.status, 409);
});

test('reenviar-invitacion emite un token nuevo al correo registrado', { skip: SALTO_PROD }, async () => {
  const { rows: antes } = await query(
    `SELECT count(*)::int AS n FROM tokens_password
     WHERE usuario_id IN (SELECT id FROM usuarios WHERE proveedor_id = $1) AND tipo = 'activacion'`,
    [proveedorId]
  );

  // Se manda deliberadamente OTRO correo en el cuerpo: la ruta debe ignorarlo.
  const res = await pedir(`/api/admin/accesos/proveedores/${proveedorId}/reenviar-invitacion`, {
    email: `intruso-${sufijo}@ejemplo.cl`,
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.email, email, 'la invitación va al correo registrado, no al del request');

  const { rows: despues } = await query(
    `SELECT count(*)::int AS n FROM tokens_password
     WHERE usuario_id IN (SELECT id FROM usuarios WHERE proveedor_id = $1) AND tipo = 'activacion'`,
    [proveedorId]
  );
  assert.equal(despues[0].n, antes[0].n + 1);
});

test('reenviar-invitacion sobre una empresa sin acceso web responde 404', { skip: SALTO_PROD }, async () => {
  const res = await pedir(`/api/admin/accesos/proveedores/${proveedorSinCuentaId}/reenviar-invitacion`);
  assert.equal(res.status, 404);
});

test('los dos 409 de crear-cuenta se distinguen por `codigo`', { skip: SALTO_PROD }, async () => {
  // La empresa ya tiene acceso → 'entidad_con_cuenta' (se resuelve reenviando).
  const yaTiene = await pedir(`/api/admin/accesos/proveedores/${proveedorId}/crear-cuenta`, {
    email: `nuevo-${sufijo}@ejemplo.cl`,
  });
  assert.equal((await yaTiene.json()).codigo, 'entidad_con_cuenta');

  // Otra empresa, pero con un correo que ya pertenece a la cuenta anterior →
  // 'email_en_uso': reenviar no arreglaría nada, es un conflicto distinto.
  const correoTomado = await pedir(`/api/admin/accesos/proveedores/${proveedorSinCuentaId}/crear-cuenta`, { email });
  assert.equal(correoTomado.status, 409);
  assert.equal((await correoTomado.json()).codigo, 'email_en_uso');
});
