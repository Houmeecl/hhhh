import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITA_CATEGORIAS_ALCANCE3 } from '../src/services/alcanceGhg.js';

// ============================================================
// Verifica el SEED de la migración 036 (fuente de la taxonomía de las
// 15 categorías de Alcance 3) leyendo el archivo SQL — test PURO, sin
// BD ni red. Mismo espíritu que metodologiasAvaladas.test.js.
// ============================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  path.resolve(__dirname, '../migrations/036_fuente_scope3_taxonomia.sql'),
  'utf8'
);

test('036: registra la fuente scope3 de forma idempotente, sin tocar motor_categorias', () => {
  assert.match(SQL, /INSERT INTO fuentes_metodologicas/);
  assert.match(SQL, /'ghg_protocol_scope3_2011'/);
  assert.match(SQL, /^ON CONFLICT \(codigo\) DO NOTHING;$/m);
  // La mención a motor_categorias en el comentario de cabecera es solo
  // documentación (explica por qué NO se toca); lo que se prohíbe es que
  // haya una sentencia SQL ejecutable (ALTER/UPDATE/INSERT) sobre esa tabla.
  assert.ok(!/^\s*(ALTER|UPDATE|INSERT)\s+.*motor_categorias/im.test(SQL), 'esta migración no debe tocar motor_categorias');
  assert.ok(!/DROP TABLE|DELETE FROM/i.test(SQL));
});

test('036 y alcanceGhg.js citan exactamente la misma fuente', () => {
  assert.ok(SQL.includes('Corporate Value Chain (Scope 3) Accounting and Reporting Standard'));
  assert.equal(CITA_CATEGORIAS_ALCANCE3, 'WRI/WBCSD — GHG Protocol — Corporate Value Chain (Scope 3) Accounting and Reporting Standard (2011)');
});
