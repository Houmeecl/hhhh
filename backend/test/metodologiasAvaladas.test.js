import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// Verifica el SEED de la migración 018 (metodologías avaladas) leyendo
// el archivo SQL — test PURO, sin BD ni red. Reglas de honestidad:
// cada categoría nueva debe citar su organismo y quedar marcada
// "referencial — validar"; los organismos avalan la METODOLOGÍA, no a
// sicr3p, así que aquí no puede aparecer un "certificado".
// ============================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  path.resolve(__dirname, '../migrations/018_metodologias_avaladas.sql'),
  'utf8'
);

// Categorías nuevas del seed y el organismo que debe citar cada una.
const CATEGORIAS_NUEVAS = {
  gas_natural: /IPCC/,
  glp: /IPCC/,
  kerosene_jet: /DEFRA/,
  refrigerante_r134a: /IPCC AR6/,
  refrigerante_r410a: /IPCC AR6/,
  residuos_relleno: /DEFRA/,
  agua_potable: /DEFRA/,
  vuelo_corto: /DEFRA/,
  vuelo_largo: /DEFRA/,
  maritimo_contenedor: /GLEC/,
};

// Bloques por sentencia INSERT (cada categoría nueva va en su propio INSERT).
const bloquesInsert = SQL.split(/INSERT INTO/).slice(1);

function bloqueDe(codigo) {
  const b = bloquesInsert.find((x) => x.includes(`'${codigo}'`));
  assert.ok(b, `falta el INSERT de la categoría ${codigo}`);
  return b;
}

test('018: crea fuentes_metodologicas idempotente, con los dos estados permitidos', () => {
  assert.match(SQL, /CREATE TABLE IF NOT EXISTS fuentes_metodologicas/);
  assert.match(SQL, /'avalada_referencial'/);
  assert.match(SQL, /'validada_oficial'/);
  assert.match(SQL, /DEFAULT 'avalada_referencial'/);
});

test('018: agrega la FK a motor_categorias y el tipo de cambio nullable en config_pos', () => {
  assert.match(SQL, /ADD COLUMN IF NOT EXISTS fuente_metodologica_id INT REFERENCES fuentes_metodologicas\(id\)/);
  assert.match(SQL, /ALTER TABLE config_pos ADD COLUMN IF NOT EXISTS tipo_cambio_usd_clp NUMERIC NULL/);
});

test('018: el seed de fuentes cita a los siete organismos comprometidos', () => {
  for (const organismo of [
    "'IPCC'",
    'WRI/WBCSD — GHG Protocol',
    'DEFRA (Reino Unido)',
    'MMA Chile — HuellaChile',
    'Coordinador Eléctrico Nacional',
    'Smart Freight Centre — GLEC',
  ]) {
    assert.ok(SQL.includes(organismo), `falta el organismo ${organismo}`);
  }
  // Los siete documentos del seed de fuentes.
  for (const codigo of ['ipcc_2006_v2', 'ipcc_ar6_gwp', 'ghg_protocol_2004', 'defra_2024', 'mma_huellachile', 'cen_sen', 'glec_v3']) {
    assert.ok(SQL.includes(`'${codigo}'`), `falta la fuente ${codigo}`);
  }
});

test('018: cada categoría nueva cita organismo y queda marcada referencial — validar', () => {
  for (const [codigo, organismoRe] of Object.entries(CATEGORIAS_NUEVAS)) {
    const b = bloqueDe(codigo);
    assert.match(b, organismoRe, `${codigo} debe citar a su organismo`);
    assert.match(b, /[Rr]eferencial/, `${codigo} debe ir marcada como referencial`);
    assert.match(b, /validar/, `${codigo} debe pedir validación contra la fuente vigente`);
    assert.match(b, /Alcance/, `${codigo} debe declarar su alcance GHG`);
    assert.match(b, /fuente_metodologica_id/, `${codigo} debe vincular su fuente`);
  }
});

test('018: alcances correctos por familia (1 = combustión/fugas, 3 = cadena de valor)', () => {
  for (const codigo of ['gas_natural', 'glp', 'kerosene_jet', 'refrigerante_r134a', 'refrigerante_r410a']) {
    assert.match(bloqueDe(codigo), /Alcance 1/, `${codigo} es Alcance 1`);
  }
  for (const codigo of ['residuos_relleno', 'agua_potable', 'vuelo_corto', 'vuelo_largo', 'maritimo_contenedor']) {
    assert.match(bloqueDe(codigo), /Alcance 3/, `${codigo} es Alcance 3`);
  }
});

test('018: es idempotente — todo INSERT lleva ON CONFLICT y todo UPDATE lleva guardia', () => {
  // Anclado a inicio de línea: el encabezado comenta el patrón y no cuenta.
  const inserts = (SQL.match(/^INSERT INTO/gm) || []).length;
  const onConflict = (SQL.match(/^ON CONFLICT/gm) || []).length;
  assert.ok(inserts > 0, 'la migración debe sembrar datos');
  assert.equal(inserts, onConflict, 'cada INSERT debe llevar su ON CONFLICT');

  // Los UPDATE de vinculación no pisan ediciones del admin (IS NULL) y el
  // traslado de palabras clave solo corre si las palabras siguen ahí (&&).
  const updates = SQL.split(/UPDATE motor_categorias/).slice(1);
  assert.ok(updates.length >= 7, 'vincula las 6 categorías existentes + traslado de palabras clave');
  for (const u of updates) {
    assert.ok(
      /fuente_metodologica_id IS NULL/.test(u) || /&& ARRAY\['glp','gas licuado'\]/.test(u),
      'todo UPDATE debe llevar guardia de idempotencia'
    );
  }
});

test('018: los datos sembrados jamás prometen certificación; nada se destruye', () => {
  // Los comentarios pueden citar la palabra para PROHIBIRLA (estilo del
  // repo); lo que va a la BD — los INSERT — no puede prometerla nunca.
  const sembrado = bloquesInsert.join('\n');
  assert.ok(!/certificad/i.test(sembrado), 'prohibido "certificado" en el seed');
  assert.ok(!/acreditad/i.test(sembrado), 'prohibido "acreditado" en el seed');
  assert.ok(!/DROP TABLE/i.test(SQL));
  assert.ok(!/DELETE FROM/i.test(SQL));
});

test('018: los factores comprometidos van con su valor citado', () => {
  assert.match(bloqueDe('gas_natural'), /2\.02/);
  assert.match(bloqueDe('glp'), /1\.61/);
  assert.match(bloqueDe('kerosene_jet'), /2\.54/);
  assert.match(bloqueDe('refrigerante_r134a'), /1530/);
  assert.match(bloqueDe('refrigerante_r410a'), /2256/);
  assert.match(bloqueDe('residuos_relleno'), /0\.45/);
  assert.match(bloqueDe('agua_potable'), /0\.41/);
  assert.match(bloqueDe('vuelo_corto'), /0\.15/);
  assert.match(bloqueDe('vuelo_largo'), /0\.19/);
  assert.match(bloqueDe('maritimo_contenedor'), /0\.012/);
});
