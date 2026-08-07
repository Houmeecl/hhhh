import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// Migración 075 (diligencia de fuentes + higiene combustible/transporte):
// auditoría por lectura, sin BD — mismo patrón que
// higieneMetodologica.test.js (031). Las migraciones se re-ejecutan en
// cada arranque, así que cada UPDATE debe llevar guardia de idempotencia.
// ============================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRACION = path.join(__dirname, '../migrations/075_fuentes_diligencia.sql');

const sql = fs.readFileSync(MIGRACION, 'utf8');

test('075: promueve SOLO las 2 fuentes confirmadas vigentes por la diligencia', () => {
  const promociones = sql.match(/estado = 'validada_oficial'/g) || [];
  assert.equal(promociones.length, 2, 'solo 2 promociones a validada_oficial');
  assert.match(sql, /WHERE codigo = 'ipcc_ar6_gwp'[\s\S]*?estado = 'avalada_referencial'/);
  assert.match(sql, /WHERE codigo = 'ghg_protocol_2004'[\s\S]*?estado = 'avalada_referencial'/);
  // Guardadas por estado actual (no se promueve dos veces).
  for (const bloque of sql.split(/UPDATE fuentes_metodologicas SET/).slice(1)) {
    if (/estado = 'validada_oficial'/.test(bloque)) {
      assert.match(bloque, /estado = 'avalada_referencial'/, 'la promoción debe estar guardada por estado actual');
    }
  }
});

test('075: las 4 fuentes con edición más nueva NO se promueven, solo quedan con nota accionable', () => {
  for (const codigo of ['defra_2024', 'mma_huellachile', 'cen_sen', 'glec_v3']) {
    const re = new RegExp(`WHERE codigo = '${codigo}'[\\s\\S]*?;`);
    const bloque = sql.match(re)?.[0];
    assert.ok(bloque, `falta el UPDATE de ${codigo}`);
    assert.doesNotMatch(bloque, /estado = 'validada_oficial'/, `${codigo} no debe promoverse`);
  }
  // Cada una lleva su nota de diligencia y guardia anti-duplicado.
  const bloques = sql.split(/UPDATE fuentes_metodologicas SET/).slice(1);
  const conDiligencia = bloques.filter((b) => /Diligencia 2026-08/.test(b));
  assert.ok(conDiligencia.length >= 5, 'al menos 5 fuentes documentadas con la diligencia (incl. ipcc_2006_v2)');
  for (const b of conDiligencia) {
    assert.match(b, /notas NOT LIKE '%Diligencia 2026-08%'/, 'guardia anti-duplicado de la nota de diligencia');
  }
});

test('075: ipcc_2006_v2 se documenta (Refinamiento 2019) pero no se promueve', () => {
  const re = /WHERE codigo = 'ipcc_2006_v2'[\s\S]*?;/;
  const bloque = sql.match(re)?.[0];
  assert.ok(bloque);
  assert.doesNotMatch(bloque, /estado = 'validada_oficial'/);
  assert.match(sql, /2019 Refinement/);
});

test('075: combustible cita IPCC 2006 explícito, guardia tolerante al sufijo de proxy de la 031', () => {
  const bloque = sql.match(/UPDATE motor_categorias SET[\s\S]*?WHERE codigo = 'combustible'[\s\S]*?;/)?.[0];
  assert.ok(bloque);
  assert.match(bloque, /IPCC 2006 Guidelines Vol\. 2/);
  assert.match(bloque, /2,68 kgCO2\/L/);
  // El número no cambia — sigue siendo el factor del seed 010, solo se hace explícita la cita.
  assert.match(bloque, /fuente LIKE 'Factor representativo diésel — ajustable por tipo de combustible%'/);
  // Se preserva la honestidad sobre el factor por GASTO (sigue siendo proxy interno).
  assert.match(bloque, /Factor por gasto: proxy interno referencial, sin cita externa/);
});

test('075: transporte legacy queda inactivo, reemplazado por transporte_modos (Cat. 7)', () => {
  const bloque = sql.match(/UPDATE motor_categorias SET[\s\S]*?WHERE codigo = 'transporte'[\s\S]*?;/)?.[0];
  assert.ok(bloque);
  assert.match(bloque, /activo = false/);
  assert.match(bloque, /transporte_modos/);
  assert.match(bloque, /DEFRA/);
  assert.match(bloque, /AND activo = true/, 'solo actúa si sigue activa (idempotencia)');
  assert.match(bloque, /fuente LIKE 'Factor referencial transporte de carga — validar por modo%'/);
});

test('075: congela una versión del motor con los cambios, guardada por nota (corre una sola vez)', () => {
  assert.match(sql, /INSERT INTO motor_versiones \(nota, origen\)/);
  assert.match(sql, /INSERT INTO motor_categorias_version/);
  assert.match(sql, /WHERE nota LIKE 'Migración 075%'/);
  assert.match(sql, /IF EXISTS \(SELECT 1 FROM motor_versiones WHERE nota LIKE 'Migración 075%'\) THEN\s*RETURN;/);
});

test('075: no promete certificaciones, no borra datos', () => {
  assert.doesNotMatch(sql, /certificad|acreditad/i);
  assert.doesNotMatch(sql, /DROP TABLE/i);
  assert.doesNotMatch(sql, /DELETE FROM/i);
});
