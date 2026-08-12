import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import crypto from 'crypto';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { signAccess } from '../src/middleware/auth.js';
import transporteProveedorRoutes from '../src/routes/transporteProveedor.js';
import { EN_PRODUCCION, SALTO_PROD } from './util/soloDev.js';

// ============================================================
// Guía de despacho (DTE 52) → precarga de un viaje de Transporte: la
// persona sube el XML, sicr3p propone patente/origen/destino (sin
// guardar nada), y confirma el viaje con el flujo normal de siempre.
// La patente es informativa — nunca entra al cálculo de CO2e (sigue
// siendo km × pasajeros × factor del modo).
// ============================================================

const sufijo = crypto.randomBytes(4).toString('hex');
let server;
let baseUrl;
let proveedorId;
let token;

const GUIA_XML = `<?xml version="1.0" encoding="ISO-8859-1"?>
<DTE version="1.0">
  <Documento ID="G1T52">
    <Encabezado>
      <IdDoc><TipoDTE>52</TipoDTE><Folio>900</Folio><FchEmis>2026-06-15</FchEmis></IdDoc>
      <Emisor><RUTEmisor>76123456-0</RUTEmisor><RznSoc>Minera Test</RznSoc><DirEmisor>Camino Industrial 500</DirEmisor></Emisor>
      <Receptor><RUTRecep>11111111-1</RUTRecep><RznSocRecep>Cliente Test</RznSocRecep><DirRecep>Bodega 10</DirRecep></Receptor>
      <Transporte>
        <Patente>XYWK77</Patente>
        <DirDest>Faena Sur km 8</DirDest>
        <CmnaDest>Calama</CmnaDest>
      </Transporte>
      <Totales><MntTotal>0</MntTotal></Totales>
    </Encabezado>
    <Detalle><NmbItem>Concentrado</NmbItem><QtyItem>10</QtyItem><UnmdItem>ton</UnmdItem></Detalle>
  </Documento>
</DTE>`;

const FACTURA_XML = `<?xml version="1.0" encoding="ISO-8859-1"?>
<DTE version="1.0">
  <Documento ID="F1T33">
    <Encabezado>
      <IdDoc><TipoDTE>33</TipoDTE><Folio>1</Folio><FchEmis>2026-06-15</FchEmis></IdDoc>
      <Emisor><RUTEmisor>76123456-0</RUTEmisor><RznSoc>Minera Test</RznSoc></Emisor>
      <Receptor><RUTRecep>11111111-1</RUTRecep><RznSocRecep>Cliente Test</RznSocRecep></Receptor>
      <Totales><MntNeto>1000</MntNeto><IVA>190</IVA><MntTotal>1190</MntTotal></Totales>
    </Encabezado>
  </Documento>
</DTE>`;

before(async () => {
  if (EN_PRODUCCION) return;
  await runMigrations();
  await query(
    `INSERT INTO transporte_modos (codigo, nombre, factor_kgco2e_pkm, fuente) VALUES ('camioneta','Camioneta',0.15,'test')
     ON CONFLICT (codigo) DO NOTHING`
  );
  const { rows } = await query(
    `INSERT INTO proveedores (nombre_empresa, rut) VALUES ($1,$2) RETURNING id`,
    [`Proveedor Guía Test ${sufijo}`, `3${sufijo.slice(0, 7)}-3`]
  );
  proveedorId = rows[0].id;
  token = signAccess({
    id: crypto.randomUUID(), rol: 'proveedor', email: `guia-${sufijo}@ejemplo.cl`,
    panel: 'proveedor', proveedor_id: proveedorId, nivel_acceso: 'operador',
  });

  const app = express();
  app.use(express.json());
  app.use('/api/panel-proveedor/transporte', transporteProveedorRoutes);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!EN_PRODUCCION) {
    await query(`DELETE FROM transporte_viajes WHERE proveedor_id = $1`, [proveedorId]);
    await query(`DELETE FROM proveedores WHERE id = $1`, [proveedorId]);
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

function formDataXml(xml, filename = 'guia.xml') {
  const fd = new FormData();
  fd.append('archivo', new Blob([xml], { type: 'application/xml' }), filename);
  return fd;
}

test('POST /leer-guia extrae patente/origen/destino de una guía y NO persiste nada', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/panel-proveedor/transporte/leer-guia`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formDataXml(GUIA_XML),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.patente, 'XYWK77');
  assert.equal(data.origen, 'Camino Industrial 500');
  assert.equal(data.destino, 'Faena Sur km 8, Calama');
  assert.equal(data.folio, '900');

  const { rows } = await query(`SELECT count(*)::int AS n FROM transporte_viajes WHERE proveedor_id = $1`, [proveedorId]);
  assert.equal(rows[0].n, 0, '/leer-guia solo propone, no debe insertar ningún viaje');
});

test('POST /leer-guia rechaza un DTE que no es guía de despacho (ej. factura)', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/panel-proveedor/transporte/leer-guia`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formDataXml(FACTURA_XML, 'factura.xml'),
  });
  assert.equal(res.status, 422);
  const data = await res.json();
  assert.match(data.error, /no una guía de despacho/);
});

test('POST /leer-guia rechaza un XML que no es un DTE válido', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/panel-proveedor/transporte/leer-guia`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formDataXml('<html>no es un dte</html>', 'raro.xml'),
  });
  assert.equal(res.status, 422);
});

test('POST /leer-guia rechaza un archivo que no es .xml', { skip: SALTO_PROD }, async () => {
  const fd = new FormData();
  fd.append('archivo', new Blob(['hola'], { type: 'text/plain' }), 'no-es-xml.txt');
  const res = await fetch(`${baseUrl}/api/panel-proveedor/transporte/leer-guia`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
  });
  assert.equal(res.status, 400);
});

test('POST /viajes acepta y persiste la patente propuesta por la guía', { skip: SALTO_PROD }, async () => {
  const fd = new FormData();
  fd.append('modo', 'camioneta');
  fd.append('origen', 'Camino Industrial 500');
  fd.append('destino', 'Faena Sur km 8, Calama');
  fd.append('km', '45');
  fd.append('pasajeros', '1');
  fd.append('patente', 'xywk77'); // minúscula a propósito: se normaliza server-side

  const res = await fetch(`${baseUrl}/api/panel-proveedor/transporte/viajes`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
  });
  assert.equal(res.status, 201);
  const { viaje } = await res.json();
  assert.equal(viaje.patente, 'XYWK77');

  const lista = await fetch(`${baseUrl}/api/panel-proveedor/transporte/viajes`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { viajes } = await lista.json();
  assert.ok(viajes.find((v) => v.id === viaje.id && v.patente === 'XYWK77'));
});

test('POST /viajes sin patente sigue funcionando (campo opcional, sin regresión)', { skip: SALTO_PROD }, async () => {
  const fd = new FormData();
  fd.append('modo', 'camioneta');
  fd.append('origen', 'A');
  fd.append('destino', 'B');
  fd.append('km', '10');
  fd.append('pasajeros', '1');

  const res = await fetch(`${baseUrl}/api/panel-proveedor/transporte/viajes`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
  });
  assert.equal(res.status, 201);
  const { viaje } = await res.json();
  assert.equal(viaje.patente, null);
});
