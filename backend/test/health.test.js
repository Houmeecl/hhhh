import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estaSano } from '../src/lib/health.js';
import { SALTO_PROD } from './util/soloDev.js';

// GET /api/health respondía ok:true sin tocar la BD; si Postgres caía
// después del arranque, el auto-deploy no detectaba el problema y el
// monitoreo externo veía el servicio sano con las peticiones reales en 500.

test('estaSano() no lanza cuando la BD real responde', { skip: SALTO_PROD }, async () => {
  await assert.doesNotReject(() => estaSano());
});

test('estaSano() lanza cuando la consulta falla', async () => {
  await assert.rejects(() => estaSano(2000, () => Promise.reject(new Error('BD caída'))));
});

test('estaSano() lanza por plazo agotado si la consulta nunca resuelve', async () => {
  await assert.rejects(() => estaSano(10, () => new Promise(() => {})));
});
