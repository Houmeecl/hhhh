import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import crypto from 'crypto';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { signAccess } from '../src/middleware/auth.js';
import { torreRouter, invalidarCacheKpis } from '../src/routes/torre.js';
import { EN_PRODUCCION, SALTO_PROD } from './util/soloDev.js';

// ============================================================
// GET /api/torre/kpis — los agregados salen SOLO de eslabones reales:
//  - tramo = par consecutivo del corredor (orden n → n+1); un salto de
//    varios puntos NO cuenta como tramo (sería un promedio mentiroso);
//  - retroceso = punto con orden menor al máximo histórico del lote;
//  - sin datos → n=0, jamás un número inventado.
// Seed sintético con created_at CONTROLADO para verificar promedios
// exactos. Se insertan eslabones directo por SQL (el hash de la cadena
// no importa para estos KPIs — son SELECT de agregación, no verificación
// de integridad).
// ============================================================

let server;
let baseUrl;
let posToken;
let loteId;
const CODIGO = `LM-KPI-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

async function insertarPaso(eslabon, puntoId, horasAtras) {
  await query(
    `INSERT INTO lote_eslabones
       (lote_id, eslabon, rol, pais, fecha, visibilidad, datos, nonce,
        hash_documento, hash_anterior, hash_cadena, created_at)
     VALUES ($1,$2,'transporte','CL', CURRENT_DATE, 'publico', $3::jsonb, $4,
             $5, $6, $7, now() - ($8 || ' hours')::interval)`,
    [loteId, eslabon, JSON.stringify({ punto_id: puntoId, punto_control: puntoId }),
     crypto.randomBytes(8).toString('hex'), crypto.randomBytes(16).toString('hex'),
     crypto.randomBytes(16).toString('hex'), crypto.randomBytes(16).toString('hex'), String(horasAtras)]
  );
}

before(async () => {
  if (EN_PRODUCCION) return;
  await runMigrations();

  const { rows } = await query(
    `INSERT INTO lotes_minerales (codigo, tipo, material, cantidad, unidad, estado)
     VALUES ($1, 'documental', 'carga_general', 1, 't', 'abierto') RETURNING id`,
    [CODIGO]
  );
  loteId = rows[0].id;

  // Ruta sintética: campo-grande → ponta-pora en 10 h y 14 h (dos lotes
  // no: mismo lote no puede repetir el tramo — se usan pasos separados),
  // más un salto largo (ponta-pora → jujuy, órdenes 1→6: NO es tramo) y
  // un retroceso (jujuy → tartagal, orden 6→5).
  await insertarPaso(1, 'campo-grande', 100);
  await insertarPaso(2, 'ponta-pora', 90);          // tramo 0→1: 10 h
  await insertarPaso(3, 'jujuy', 60);               // salto 1→6: no cuenta
  await insertarPaso(4, 'tartagal', 50);            // retroceso 6→5
  await query(`UPDATE lotes_minerales SET n_eslabones = 4 WHERE id = $1`, [loteId]);

  posToken = signAccess({ id: crypto.randomUUID(), rol: 'pos', email: null });

  const app = express();
  app.use(express.json());
  app.use('/api/torre', torreRouter);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  invalidarCacheKpis();
});

after(async () => {
  if (!EN_PRODUCCION && loteId) {
    await query(`DELETE FROM lotes_minerales WHERE id = $1`, [loteId]); // cascada: eslabones
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('GET /kpis sin token → 401; con rol tarjeta → 403', { skip: SALTO_PROD }, async () => {
  assert.equal((await fetch(`${baseUrl}/api/torre/kpis`)).status, 401);
  const tarjetaToken = signAccess({ id: crypto.randomUUID(), rol: 'tarjeta', email: null });
  const res = await fetch(`${baseUrl}/api/torre/kpis`, { headers: { Authorization: `Bearer ${tarjetaToken}` } });
  assert.equal(res.status, 403);
});

test('tramo consecutivo con promedio exacto; el salto de varios puntos NO cuenta; retroceso contado', { skip: SALTO_PROD }, async () => {
  invalidarCacheKpis();
  const res = await fetch(`${baseUrl}/api/torre/kpis`, { headers: { Authorization: `Bearer ${posToken}` } });
  assert.equal(res.status, 200);
  const kpis = await res.json();

  const tramo = kpis.tramos.find((t) => t.desde === 'campo-grande' && t.hasta === 'ponta-pora');
  assert.ok(tramo, 'el tramo campo-grande→ponta-pora existe');
  assert.ok(tramo.n >= 1);
  // Nuestro paso sintético aporta exactamente 10 h — si es el único del
  // tramo en 90 días, el promedio ES 10.0; si otro test/demo dejó datos,
  // al menos verificamos que nuestro aporte fue considerado (n >= 1).
  if (tramo.n === 1) assert.equal(tramo.horas_promedio, 10);

  // El salto ponta-pora → jujuy (órdenes 1→6) NO aparece como tramo.
  assert.ok(!kpis.tramos.some((t) => t.desde === 'ponta-pora' && t.hasta === 'jujuy'));

  // El retroceso jujuy → tartagal quedó contado.
  assert.ok(kpis.retrocesos_30d.n >= 1);
  assert.ok(kpis.retrocesos_30d.lotes >= 1);
  assert.ok(kpis.generado);
});

test('la respuesta se cachea 60 s (dos GET seguidos devuelven el mismo `generado`)', { skip: SALTO_PROD }, async () => {
  const a = await (await fetch(`${baseUrl}/api/torre/kpis`, { headers: { Authorization: `Bearer ${posToken}` } })).json();
  const b = await (await fetch(`${baseUrl}/api/torre/kpis`, { headers: { Authorization: `Bearer ${posToken}` } })).json();
  assert.equal(a.generado, b.generado);
});

test('ETag: un segundo GET con If-None-Match devuelve 304 sin cuerpo', { skip: SALTO_PROD }, async () => {
  const primera = await fetch(`${baseUrl}/api/torre/kpis`, { headers: { Authorization: `Bearer ${posToken}` } });
  assert.equal(primera.status, 200);
  const etag = primera.headers.get('etag');
  assert.ok(etag, 'la respuesta trae header ETag');

  const segunda = await fetch(`${baseUrl}/api/torre/kpis`, {
    headers: { Authorization: `Bearer ${posToken}`, 'If-None-Match': etag },
  });
  assert.equal(segunda.status, 304);
  const cuerpo = await segunda.text();
  assert.equal(cuerpo, '', 'un 304 no trae cuerpo');
});
