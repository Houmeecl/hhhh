import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// Migración 032: auditoría por lectura (patrón de la 019/031 — no
// requiere BD). El comportamiento en sí (rechazo de NC/ND/guía/
// liquidación) ya está cubierto en lecturaDocumento.test.js.
// ============================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRACION = path.join(__dirname, '../migrations/032_tipo_documento_no_calculable.sql');

const sql = fs.readFileSync(MIGRACION, 'utf8');

test('migración 032: extiende el CHECK de motivo de forma idempotente', () => {
  assert.match(sql, /pg_get_constraintdef\(oid\) LIKE '%tipo_documento_no_calculable%'/);
  assert.match(sql, /ALTER TABLE documentos_rechazados DROP CONSTRAINT IF EXISTS documentos_rechazados_motivo_check/);
  assert.match(sql, /CHECK \(motivo IN \('sin_senal', 'formato_no_permitido', 'monto_fuera_de_rango', 'tipo_documento_no_calculable'\)\)/);
});

test('migración 032: no promete certificaciones ni pisa motivos existentes', () => {
  assert.doesNotMatch(sql, /certificad|acreditad/i);
  // Los 3 motivos previos siguen presentes en el CHECK nuevo.
  for (const m of ['sin_senal', 'formato_no_permitido', 'monto_fuera_de_rango']) {
    assert.match(sql, new RegExp(m));
  }
});
