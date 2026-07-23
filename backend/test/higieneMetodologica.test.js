import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// Migración 031 (higiene metodológica): auditoría por lectura.
// Las migraciones se re-ejecutan en cada arranque, así que cada
// UPDATE debe llevar una guardia que respete ediciones del admin
// — aquí se verifica que las guardias existan en el SQL, sin BD.
// ============================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRACION = path.join(__dirname, '../migrations/031_higiene_metodologica.sql');

const sql = fs.readFileSync(MIGRACION, 'utf8');

test('migración 031: desactiva la categoría agua legada solo si sigue siendo la del seed', () => {
  // Desactivación presente…
  assert.match(sql, /SET activo = false[\s\S]*?WHERE codigo = 'agua'/);
  // …con guardia por firma textual del seed (si el admin la editó, no se pisa).
  assert.match(sql, /fuente LIKE 'Factor referencial agua potable — mismo default%'/);
  // Solo actúa sobre filas aún activas (idempotencia).
  assert.match(sql, /AND activo = true/);
});

test('migración 031: traspasa keywords a agua_potable con dedupe y guardia', () => {
  assert.match(sql, /WHERE codigo = 'agua_potable'/);
  // Dedupe (patrón de la 026): array_agg(DISTINCT …).
  assert.match(sql, /array_agg\(DISTINCT x\)/);
  // Guardia de idempotencia: no re-aplica si el traspaso ya ocurrió.
  assert.match(sql, /NOT \(palabras_clave @> ARRAY\['hidrico'\]\)/);
});

test('migración 031: materiales queda como proxy interno, sin cita inventada', () => {
  // La fuente nueva declara el factor físico como proxy interno sin fuente externa.
  assert.match(sql, /proxy interno sicr3p, sin fuente externa/);
  // La FK a ghg_protocol_2004 se anula…
  assert.match(sql, /fuente_metodologica_id = NULL/);
  // …y hay una guardia que solo actúa mientras siga apuntando al estándar spend-based.
  assert.match(sql, /fuente_metodologica_id = \(SELECT id FROM fuentes_metodologicas WHERE codigo = 'ghg_protocol_2004'\)/);
  // El texto reconoce lo que SÍ avala el estándar (método por gasto), sin atribuirle el factor físico.
  assert.match(sql, /Método por gasto avalado por GHG Protocol \(spend-based\)/);
});

test('migración 031: la anulación de la FK de materiales es re-ejecutable (la 018 la re-vincula en cada arranque)', () => {
  // La 018 corre ANTES en cada arranque y vuelve a poner ghg_protocol_2004
  // cuando ve la FK en NULL; este statement separado la anula de nuevo,
  // guardado por el texto proxy (si el admin reescribe la fuente, se respeta).
  const anulaciones = sql.match(/fuente_metodologica_id = NULL/g) || [];
  assert.equal(anulaciones.length, 1, 'una única anulación de FK, en statement propio');
  assert.match(sql, /fuente LIKE 'Factor físico: proxy interno sicr3p, sin fuente externa%'/);
});

test('migración 031: electricidad documenta CEN—SEN solo si la fuente sigue siendo la del seed', () => {
  assert.match(sql, /CEN — factor de emisión SEN 2023/);
  assert.match(sql, /difundido por HuellaChile \(MMA\)/);
  // Guardia por igualdad exacta con el texto del seed.
  assert.match(sql, /AND fuente = 'HuellaChile \(MMA\) — SEN 2023: 0,2421 kgCO2e\/kWh'/);
});

test('migración 031: todos los factores por gasto quedan marcados como proxy interno, con guardia', () => {
  assert.match(sql, /factor_gasto_kgco2e_clp1000 IS NOT NULL/);
  assert.match(sql, /Factor por gasto: proxy interno referencial, sin cita externa\./);
  // Guardia anti-duplicado: no re-anexa la nota si ya está.
  const guardias = sql.match(/fuente NOT LIKE '%proxy interno%'/g) || [];
  assert.ok(guardias.length >= 2, 'guardia NOT LIKE proxy interno en materiales y en la nota global');
});

test('migración 031: no promete certificaciones ni inventa citas', () => {
  assert.doesNotMatch(sql, /certificad|acreditad/i);
  // Ningún UPDATE sin WHERE (cada statement lleva su condición).
  for (const stmt of sql.split(';')) {
    if (/UPDATE\s+motor_categorias/i.test(stmt)) {
      assert.match(stmt, /WHERE/i, 'todo UPDATE de la 031 debe llevar WHERE con guardia');
    }
  }
});
