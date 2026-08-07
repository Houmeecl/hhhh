import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import crypto from 'crypto';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { signAccess } from '../src/middleware/auth.js';
import { hashApiKey } from '../src/services/mandante.js';
import agenciaRouter from '../src/routes/agencia.js';
import { EN_PRODUCCION, SALTO_PROD } from './util/soloDev.js';

// ============================================================
// Cubre el guard de nivel_acceso='lectura' (migración 070) sobre la única
// mutación real del panel agencia: subir un documento del expediente. El
// resto del panel (GET /expedientes) es de solo lectura y no necesita el
// guard — mismo criterio documentado en el plan de superadmin/roles.
// ============================================================

const sufijo = crypto.randomBytes(4).toString('hex');

let server;
let baseUrl;
let agenciaId;
let loteId;
let tokenOperador;
let tokenLectura;

before(async () => {
  if (EN_PRODUCCION) return;

  await runMigrations();

  const { rows: agencias } = await query(
    `INSERT INTO agencias_aduana (nombre, token_hash, activo) VALUES ($1,$2,true) RETURNING id`,
    [`Agencia Test ${sufijo}`, hashApiKey(`agn_test_${sufijo}`)]
  );
  agenciaId = agencias[0].id;

  const { rows: lotes } = await query(
    `INSERT INTO lotes_minerales (codigo, tipo, material, cantidad, unidad, pais_origen, estado, agencia_id)
     VALUES ($1,'documental','carga_general',10,'t','CL','abierto',$2) RETURNING id`,
    [`LM-AGN-TEST-${sufijo}`, agenciaId]
  );
  loteId = lotes[0].id;

  tokenOperador = signAccess({
    id: crypto.randomUUID(), rol: 'operador', email: `agn-op-${sufijo}@ejemplo.cl`,
    panel: 'agencia', agencia_id: agenciaId, nivel_acceso: 'operador',
  });
  tokenLectura = signAccess({
    id: crypto.randomUUID(), rol: 'operador', email: `agn-lec-${sufijo}@ejemplo.cl`,
    panel: 'agencia', agencia_id: agenciaId, nivel_acceso: 'lectura',
  });

  const app = express();
  app.use(express.json());
  app.use('/api/agencia', agenciaRouter);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!EN_PRODUCCION) {
    if (loteId) await query(`DELETE FROM lotes_minerales WHERE id = $1`, [loteId]);
    if (agenciaId) await query(`DELETE FROM agencias_aduana WHERE id = $1`, [agenciaId]);
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('GET /agencia/expedientes con nivel_acceso="lectura" funciona (endpoint de solo lectura)', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/agencia/expedientes`, {
    headers: { Authorization: `Bearer ${tokenLectura}` },
  });
  assert.equal(res.status, 200);
});

test('POST /agencia/expedientes/:codigo/documentos con nivel_acceso="lectura" responde 403 antes de tocar el expediente', { skip: SALTO_PROD }, async () => {
  const { rows } = await query(`SELECT codigo FROM lotes_minerales WHERE id = $1`, [loteId]);
  const res = await fetch(`${baseUrl}/api/agencia/expedientes/${rows[0].codigo}/documentos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenLectura}` },
  });
  assert.equal(res.status, 403);
});

test('POST /agencia/expedientes/:codigo/documentos con nivel_acceso="operador" pasa el guard (llega a la lógica de negocio)', { skip: SALTO_PROD }, async () => {
  const { rows } = await query(`SELECT codigo FROM lotes_minerales WHERE id = $1`, [loteId]);
  const res = await fetch(`${baseUrl}/api/agencia/expedientes/${rows[0].codigo}/documentos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenOperador}` },
  });
  // Sin archivo adjunto la ruta real falla más adelante (400/500 de
  // negocio, nunca 403): lo que importa acá es que NO sea el guard el que
  // corta la solicitud.
  assert.notEqual(res.status, 403);
});
