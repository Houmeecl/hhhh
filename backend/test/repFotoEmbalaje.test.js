import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import crypto from 'crypto';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { signAccess } from '../src/middleware/auth.js';
import repProveedorRoutes from '../src/routes/repProveedor.js';
import { EN_PRODUCCION, SALTO_PROD } from './util/soloDev.js';

// ============================================================
// Foto de embalaje como evidencia del producto (migración 095): hasta
// ahora POST /estimar-embalaje analizaba la foto con IA y la descartaba
// de inmediato. Ahora la persona puede elegir guardarla al crear/editar
// el producto (POST/PUT /productos, multipart con campo `foto`
// opcional) — sin foto, el flujo JSON de siempre sigue igual.
// ============================================================

const sufijo = crypto.randomBytes(4).toString('hex');
const FOTO_JPG = Buffer.from('contenido-jpg-de-prueba-'.repeat(20));
const FOTO_JPG_2 = Buffer.from('otra-foto-distinta-'.repeat(20));

let server;
let baseUrl;
let proveedorAId;
let proveedorBId;
let tokenA;
let tokenB;
let productoIdConFoto;

function tokenParaProveedor(proveedorId) {
  return signAccess({
    id: crypto.randomUUID(), rol: 'proveedor', email: `rep-foto-${sufijo}@ejemplo.cl`,
    panel: 'proveedor', proveedor_id: proveedorId, nivel_acceso: 'operador',
  });
}

const COMPONENTES = [{ material: 'plasticos', peso_gr: 30, cantidad: 1, reciclable: true }];

before(async () => {
  if (EN_PRODUCCION) return;
  await runMigrations();

  const { rows: provs } = await query(
    `INSERT INTO proveedores (nombre_empresa, rut) VALUES ($1,$2),($3,$4) RETURNING id`,
    [`Proveedor Foto A ${sufijo}`, `1${sufijo.slice(0, 7)}-1`, `Proveedor Foto B ${sufijo}`, `2${sufijo.slice(0, 7)}-2`]
  );
  proveedorAId = provs[0].id;
  proveedorBId = provs[1].id;
  tokenA = tokenParaProveedor(proveedorAId);
  tokenB = tokenParaProveedor(proveedorBId);

  const app = express();
  app.use(express.json());
  app.use('/api/panel-proveedor/rep', repProveedorRoutes);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!EN_PRODUCCION) {
    await query(`DELETE FROM productos_proveedor WHERE proveedor_id IN ($1,$2)`, [proveedorAId, proveedorBId]);
    await query(`DELETE FROM proveedores WHERE id IN ($1,$2)`, [proveedorAId, proveedorBId]);
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

function formDataProducto({ nombre, componentes, foto, filename = 'embalaje.jpg', mime = 'image/jpeg' }) {
  const fd = new FormData();
  fd.append('nombre', nombre);
  fd.append('componentes', JSON.stringify(componentes));
  if (foto) fd.append('foto', new Blob([foto], { type: mime }), filename);
  return fd;
}

test('POST /productos sin foto sigue funcionando en JSON plano (sin regresión)', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/panel-proveedor/rep/productos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ nombre: 'Producto sin foto', componentes: COMPONENTES }),
  });
  assert.equal(res.status, 201);
  const { producto } = await res.json();
  assert.equal(producto.tiene_foto_embalaje, false);
});

test('POST /productos con foto (multipart) la persiste y marca tiene_foto_embalaje', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/panel-proveedor/rep/productos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: formDataProducto({ nombre: 'Producto con foto', componentes: COMPONENTES, foto: FOTO_JPG }),
  });
  assert.equal(res.status, 201);
  const { producto } = await res.json();
  assert.equal(producto.tiene_foto_embalaje, true);
  productoIdConFoto = producto.id;
});

test('GET /productos/:id/foto devuelve la foto original tal cual se subió', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/panel-proveedor/rep/productos/${productoIdConFoto}/foto`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.equals(FOTO_JPG), 'la foto descargada debe ser idéntica a la subida (sin compresión)');
});

test('GET /productos/:id/foto de otro proveedor devuelve 404 (scopeado por proveedor_id)', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/panel-proveedor/rep/productos/${productoIdConFoto}/foto`, {
    headers: { Authorization: `Bearer ${tokenB}` },
  });
  assert.equal(res.status, 404);
});

test('GET /productos lista tiene_foto_embalaje correctamente para ambos productos', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/panel-proveedor/rep/productos`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  const { productos } = await res.json();
  const conFoto = productos.find((p) => p.id === productoIdConFoto);
  const sinFoto = productos.find((p) => p.nombre === 'Producto sin foto');
  assert.equal(conFoto.tiene_foto_embalaje, true);
  assert.equal(sinFoto.tiene_foto_embalaje, false);
});

test('PUT /productos/:id editando texto sin mandar foto NO borra la foto existente', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/panel-proveedor/rep/productos/${productoIdConFoto}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ nombre: 'Producto con foto (editado)', componentes: COMPONENTES }),
  });
  assert.equal(res.status, 200);
  const { producto } = await res.json();
  assert.equal(producto.nombre, 'Producto con foto (editado)');
  assert.equal(producto.tiene_foto_embalaje, true, 'la foto debe seguir ahí tras editar solo el texto');

  const fotoRes = await fetch(`${baseUrl}/api/panel-proveedor/rep/productos/${productoIdConFoto}/foto`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  const buf = Buffer.from(await fotoRes.arrayBuffer());
  assert.ok(buf.equals(FOTO_JPG), 'sigue siendo la foto original, no se tocó');
});

test('PUT /productos/:id con una foto nueva la reemplaza', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/panel-proveedor/rep/productos/${productoIdConFoto}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: formDataProducto({ nombre: 'Producto con foto (editado)', componentes: COMPONENTES, foto: FOTO_JPG_2 }),
  });
  assert.equal(res.status, 200);

  const fotoRes = await fetch(`${baseUrl}/api/panel-proveedor/rep/productos/${productoIdConFoto}/foto`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  const buf = Buffer.from(await fotoRes.arrayBuffer());
  assert.ok(buf.equals(FOTO_JPG_2), 'la foto debe haberse reemplazado por la nueva');
});

test('GET /productos/:id/foto sin foto devuelve 404', { skip: SALTO_PROD }, async () => {
  const crear = await fetch(`${baseUrl}/api/panel-proveedor/rep/productos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ nombre: 'Otro sin foto', componentes: COMPONENTES }),
  });
  const { producto } = await crear.json();
  const res = await fetch(`${baseUrl}/api/panel-proveedor/rep/productos/${producto.id}/foto`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  assert.equal(res.status, 404);
});

test('POST /productos rechaza un archivo que no es imagen', { skip: SALTO_PROD }, async () => {
  const fd = new FormData();
  fd.append('nombre', 'Producto con PDF como foto');
  fd.append('componentes', JSON.stringify(COMPONENTES));
  fd.append('foto', new Blob([Buffer.from('%PDF-1.4')], { type: 'application/pdf' }), 'archivo.pdf');
  const res = await fetch(`${baseUrl}/api/panel-proveedor/rep/productos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: fd,
  });
  assert.equal(res.status, 400);
});
