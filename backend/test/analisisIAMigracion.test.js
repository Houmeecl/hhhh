import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// Migración 033: auditoría por lectura (patrón de la 019/031/032).
// ============================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRACION = path.join(__dirname, '../migrations/033_analisis_ia.sql');

const sql = fs.readFileSync(MIGRACION, 'utf8');

test('migración 033: agrega propio_ia al CHECK de motor de forma idempotente', () => {
  assert.match(sql, /pg_get_constraintdef\(oid\) LIKE '%propio_ia%'/);
  assert.match(sql, /ALTER TABLE facturas DROP CONSTRAINT IF EXISTS facturas_motor_check/);
  assert.match(sql, /CHECK \(motor IN \('propio', 'propio_texto', 'propio_ocr', 'propio_ia', 'externo',/);
  // Los orígenes previos siguen presentes (no se pisan).
  for (const m of ['propio_texto', 'propio_ocr', 'externo', 'revision', 'propio_revisado']) {
    assert.match(sql, new RegExp(m));
  }
});

test('migración 033: crea analisis_ia_uso sin RUT ni contenido del documento (minimización)', () => {
  const cuerpo = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  assert.match(cuerpo, /CREATE TABLE IF NOT EXISTS analisis_ia_uso/);
  assert.match(cuerpo, /CREATE INDEX IF NOT EXISTS/);
  assert.doesNotMatch(cuerpo, /\brut\b/i);
  assert.doesNotMatch(cuerpo, /BYTEA/i);
  assert.doesNotMatch(cuerpo, /^\s{2}(archivo|binario|contenido|texto|buffer)\s/im);
  // Solo metadatos operativos.
  for (const col of ['modelo', 'exito', 'tokens_entrada', 'tokens_salida', 'costo_estimado_clp', 'latencia_ms']) {
    assert.match(cuerpo, new RegExp(col));
  }
});

test('migración 033: no promete certificaciones', () => {
  assert.doesNotMatch(sql, /certificad|acreditad/i);
});
