import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { puntosCorredor, idsCorredor, fronterasCorredor, invalidarCacheCatalogo } from '../src/services/catalogoCorredor.js';
import { PUNTOS_CORREDOR_IDS, PUNTOS_FRONTERA } from '../src/services/pasaporteOrigen.js';
import { SALTO_PROD } from './util/soloDev.js';

// ============================================================
// Catálogo de puntos del corredor en BD (migración 093) — el seed debe
// ser un espejo EXACTO del catálogo estático (que se conserva como
// fallback), y el servicio debe caer al estático si la tabla no aporta.
// ============================================================

after(async () => { await pool.end().catch(() => {}); });

test('migración 093: el seed es espejo exacto del catálogo estático (ids, orden y fronteras)', { skip: SALTO_PROD }, async () => {
  await runMigrations();
  invalidarCacheCatalogo();
  const { rows } = await query(`SELECT id, orden, es_frontera FROM puntos_corredor ORDER BY orden`);
  assert.ok(rows.length >= 14, 'al menos los 14 fundacionales');
  // Los 14 estáticos están todos, con orden = índice del array estático.
  for (let i = 0; i < PUNTOS_CORREDOR_IDS.length; i++) {
    const fila = rows.find((r) => r.id === PUNTOS_CORREDOR_IDS[i]);
    assert.ok(fila, `falta el punto seed '${PUNTOS_CORREDOR_IDS[i]}'`);
    assert.equal(fila.orden, i, `orden de '${fila.id}' no coincide con el índice estático`);
  }
  const fronterasTabla = rows.filter((r) => r.es_frontera).map((r) => r.id).sort();
  assert.deepEqual(fronterasTabla.filter((id) => PUNTOS_FRONTERA.includes(id)).sort(), [...PUNTOS_FRONTERA].sort());
});

test('puntosCorredor/idsCorredor/fronterasCorredor leen la tabla con lat/lng numéricos', { skip: SALTO_PROD }, async () => {
  await runMigrations();
  invalidarCacheCatalogo();
  const puntos = await puntosCorredor();
  assert.ok(puntos.length >= 14);
  const jama = puntos.find((p) => p.id === 'paso-de-jama');
  assert.equal(typeof jama.lat, 'number');
  assert.equal(jama.es_frontera, true);
  const ids = await idsCorredor();
  for (const id of PUNTOS_CORREDOR_IDS) assert.ok(ids.includes(id));
  const fronteras = await fronterasCorredor();
  for (const id of PUNTOS_FRONTERA) assert.ok(fronteras.includes(id));
});

test('un punto desactivado sale del catálogo (pero la fila persiste — sin DELETE)', { skip: SALTO_PROD }, async () => {
  await runMigrations();
  await query(`INSERT INTO puntos_corredor (id, nombre, pais, lat, lng, orden, activo)
               VALUES ('punto-test-desactivado', 'Punto de prueba', 'CL', -23.0, -70.0, 900, false)
               ON CONFLICT (id) DO UPDATE SET activo = false`);
  invalidarCacheCatalogo();
  const ids = await idsCorredor();
  assert.ok(!ids.includes('punto-test-desactivado'));
  const { rows } = await query(`SELECT activo FROM puntos_corredor WHERE id = 'punto-test-desactivado'`);
  assert.equal(rows[0].activo, false); // la fila sigue existiendo
  await query(`DELETE FROM puntos_corredor WHERE id = 'punto-test-desactivado'`); // limpieza del test, no del producto
  invalidarCacheCatalogo();
});
