import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import crypto from 'crypto';
import { gzipSync } from 'zlib';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { signAccess } from '../src/middleware/auth.js';
import clienteRoutes from '../src/routes/cliente.js';
import { EN_PRODUCCION, SALTO_PROD } from './util/soloDev.js';

// ============================================================
// Persistencia del archivo original de una factura (migración 094):
// hasta ahora el flujo /cargar solo guardaba el nombre del archivo, el
// binario se descartaba al responder. Ahora se retiene comprimido
// (gzip) en facturas.archivo_binario, y el cliente puede descargarlo vía
// GET /api/mis-facturas/:id/archivo-original — scopeado a SU email, el
// mismo criterio que /api/mis-sesiones.
// ============================================================

const sufijo = crypto.randomBytes(4).toString('hex');
const EMAIL_A = `cliente-a-${sufijo}@ejemplo.cl`;
const EMAIL_B = `cliente-b-${sufijo}@ejemplo.cl`;
const CONTENIDO_PDF = Buffer.from('%PDF-1.4 contenido de prueba de una factura real'.repeat(50));

let server;
let baseUrl;
let tokenA;
let tokenB;
let sesionAId;
let facturaConArchivoId;
let facturaSinArchivoId;

before(async () => {
  if (EN_PRODUCCION) return;
  await runMigrations();

  const { rows: sRows } = await query(
    `INSERT INTO sesiones (rut_cliente, nombre_cliente, email_cliente) VALUES ($1,$2,$3) RETURNING id`,
    ['11.111.111-1', 'Cliente Test', EMAIL_A]
  );
  sesionAId = sRows[0].id;

  const comprimido = gzipSync(CONTENIDO_PDF);
  const sha256 = crypto.createHash('sha256').update(CONTENIDO_PDF).digest('hex');
  const { rows: fRows } = await query(
    `INSERT INTO facturas (sesion_id, numero_venta, archivo_original, total_co2e, status,
                            archivo_binario, extension, tamano_bytes, sha256)
     VALUES ($1,$2,$3,$4,'procesada',$5,$6,$7,$8) RETURNING id`,
    [sesionAId, 'F-TEST-1', 'factura-original.pdf', 1.5, comprimido, 'pdf', CONTENIDO_PDF.length, sha256]
  );
  facturaConArchivoId = fRows[0].id;

  const { rows: fRows2 } = await query(
    `INSERT INTO facturas (sesion_id, numero_venta, archivo_original, total_co2e, status)
     VALUES ($1,$2,$3,$4,'procesada') RETURNING id`,
    [sesionAId, 'F-TEST-2', 'sin-binario.pdf', 0.5]
  );
  facturaSinArchivoId = fRows2[0].id;

  tokenA = signAccess({ id: crypto.randomUUID(), rol: 'cliente', email: EMAIL_A });
  tokenB = signAccess({ id: crypto.randomUUID(), rol: 'cliente', email: EMAIL_B });

  const app = express();
  app.use(express.json());
  app.use('/api', clienteRoutes);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!EN_PRODUCCION) {
    await query(`DELETE FROM facturas WHERE sesion_id = $1`, [sesionAId]);
    await query(`DELETE FROM sesiones WHERE id = $1`, [sesionAId]);
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('GET /mis-sesiones marca tiene_archivo_original solo en la factura que lo tiene', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/mis-sesiones`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  const sesion = data.sesiones.find((s) => s.id === sesionAId);
  const conArchivo = sesion.facturas.find((f) => f.id === facturaConArchivoId);
  const sinArchivo = sesion.facturas.find((f) => f.id === facturaSinArchivoId);
  assert.equal(conArchivo.tiene_archivo_original, true);
  assert.equal(sinArchivo.tiene_archivo_original, false);
});

test('GET /mis-facturas/:id/archivo-original descomprime y devuelve el binario original', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/mis-facturas/${facturaConArchivoId}/archivo-original`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.equals(CONTENIDO_PDF), 'el binario descargado debe ser idéntico al original');
});

test('GET /mis-facturas/:id/archivo-original de otro cliente devuelve 404 (scopeado por email)', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/mis-facturas/${facturaConArchivoId}/archivo-original`, {
    headers: { Authorization: `Bearer ${tokenB}` },
  });
  assert.equal(res.status, 404);
});

test('GET /mis-facturas/:id/archivo-original sin binario persistido devuelve 404', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/mis-facturas/${facturaSinArchivoId}/archivo-original`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  assert.equal(res.status, 404);
});

test('GET /mis-facturas/:id/archivo-original con id no-UUID devuelve 404, no 500', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/mis-facturas/no-es-un-uuid/archivo-original`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  assert.equal(res.status, 404);
});

test('GET /mis-facturas/:id/archivo-original sin token devuelve 401', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/mis-facturas/${facturaConArchivoId}/archivo-original`);
  assert.equal(res.status, 401);
});
