import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { categoriasSeed } from './helpers/categoriasSeed.js';
import { clasificar, calcularItem } from '../src/services/motorPropio.js';

// ============================================================
// Paridad seed ↔ tests, sin BD: se re-deriva el estado final de
// motor_categorias LEYENDO el SQL de las migraciones (010 inserta la
// base, 018 agrega categorías y traslada glp, 026/031 agregan
// sinónimos, 031 desactiva la categoría agua legada) y se compara
// campo a campo contra la definición en memoria del helper. Si el
// seed cambia sin actualizar el helper —o al revés—, esto truena en
// `node --test` sin necesidad de Postgres.
// ============================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIG = (n) => {
  const dir = path.join(__dirname, '../migrations');
  const f = fs.readdirSync(dir).find((x) => x.startsWith(n));
  assert.ok(f, `migración ${n} no encontrada`);
  return fs.readFileSync(path.join(dir, f), 'utf8');
};

// "'a','b','c'" → ['a','b','c'] (los seeds no usan comillas escapadas).
function parseArraySql(s) {
  return [...s.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
}

// Filas de INSERT INTO motor_categorias: los primeros 6 campos son
// (codigo, nombre, unidad, factor_fisico, factor_gasto, ARRAY[keywords]).
const FILA_RE = /\(\s*'([a-z0-9_]+)',\s*'((?:[^']|'')*)',\s*(NULL|'[^']*'),\s*(NULL|[\d.]+),\s*([\d.]+),\s*ARRAY\[([^\]]*)\]/g;

function filasInsert(sql) {
  const filas = [];
  for (const m of sql.matchAll(FILA_RE)) {
    filas.push({
      codigo: m[1],
      nombre: m[2].replace(/''/g, "'"),
      unidad_fisica: m[3] === 'NULL' ? null : m[3].slice(1, -1),
      factor_fisico_kgco2e: m[4] === 'NULL' ? null : Number(m[4]),
      factor_gasto_kgco2e_clp1000: Number(m[5]),
      palabras_clave: parseArraySql(m[6]),
      activo: true,
    });
  }
  return filas;
}

// UPDATEs "palabras_clave || ARRAY[...] ... WHERE codigo = 'x'" (026/031).
function sinonimosUpdate(sql) {
  const out = [];
  for (const m of sql.matchAll(/palabras_clave \|\| ARRAY\[([^\]]*)\][\s\S]*?WHERE codigo = '([a-z_]+)'/g)) {
    out.push({ codigo: m[2], palabras: parseArraySql(m[1]) });
  }
  return out;
}

// Reconstruye el estado final aplicando las migraciones en orden.
function seedDesdeSql() {
  const cats = new Map();
  for (const fila of filasInsert(MIG('010'))) cats.set(fila.codigo, fila);
  for (const fila of filasInsert(MIG('018'))) {
    if (!cats.has(fila.codigo)) cats.set(fila.codigo, fila); // ON CONFLICT DO NOTHING
  }
  // 018: traslado de glp/gas licuado fuera de combustible.
  const sql018 = MIG('018');
  assert.match(sql018, /array_remove\(array_remove\(palabras_clave, 'glp'\), 'gas licuado'\)[\s\S]*?WHERE codigo = 'combustible'/,
    'la 018 debe seguir trasladando glp/gas licuado fuera de combustible');
  cats.get('combustible').palabras_clave = cats.get('combustible').palabras_clave
    .filter((k) => k !== 'glp' && k !== 'gas licuado');
  // 026 y 031: sinónimos con dedupe (array_agg DISTINCT).
  for (const sql of [MIG('026'), MIG('031')]) {
    for (const { codigo, palabras } of sinonimosUpdate(sql)) {
      const cat = cats.get(codigo);
      assert.ok(cat, `UPDATE de sinónimos sobre categoría inexistente: ${codigo}`);
      cat.palabras_clave = [...new Set([...cat.palabras_clave, ...palabras])];
    }
  }
  // 031: desactiva la categoría agua legada.
  assert.match(MIG('031'), /SET activo = false[\s\S]*?WHERE codigo = 'agua'/,
    'la 031 debe seguir desactivando la categoría agua legada');
  cats.get('agua').activo = false;
  return cats;
}

test('paridad seed ↔ helper: mismas categorías, factores, unidades y keywords', () => {
  const deSql = seedDesdeSql();
  const helper = categoriasSeed();

  assert.deepEqual([...deSql.keys()].sort(), [...helper.keys()].sort(),
    'el helper y el seed deben definir exactamente las mismas categorías');

  for (const [codigo, esperada] of helper) {
    const real = deSql.get(codigo);
    assert.equal(real.nombre, esperada.nombre, `${codigo}: nombre`);
    assert.equal(real.unidad_fisica, esperada.unidad_fisica, `${codigo}: unidad_fisica`);
    assert.equal(real.factor_fisico_kgco2e, esperada.factor_fisico_kgco2e, `${codigo}: factor físico`);
    assert.equal(real.factor_gasto_kgco2e_clp1000, esperada.factor_gasto_kgco2e_clp1000, `${codigo}: factor por gasto`);
    assert.equal(real.activo, esperada.activo, `${codigo}: activo`);
    assert.deepEqual([...real.palabras_clave].sort(), [...esperada.palabras_clave].sort(),
      `${codigo}: palabras_clave`);
  }
});

test('el parser de migraciones encontró un seed no trivial (autocontrol del regex)', () => {
  const deSql = seedDesdeSql();
  // 6 categorías de la 010 + 10 de la 018: si el regex deja de calzar por
  // un cambio de formato, esto avisa antes de dar una paridad vacía.
  assert.equal(deSql.size, 16, 'el seed reconstruido debe tener 16 categorías');
  const conSinonimos = deSql.get('electricidad').palabras_clave;
  assert.ok(conSinonimos.includes('enel'), 'los sinónimos de la 026 deben estar aplicados');
  assert.ok(deSql.get('agua_potable').palabras_clave.includes('hidrico'),
    'el traspaso de keywords de la 031 debe estar aplicado');
});

test('el seed real clasifica como prometen la guía y los tests de comportamiento', () => {
  const cats = categoriasSeed();
  // Con la categoría agua legada desactivada, lo hídrico cae en agua_potable.
  assert.equal(clasificar('Consumo de agua planta', cats), 'agua_potable');
  const item = { nombre: 'Consumo de agua planta', descripcion: null, cantidad: 120, unidad: 'm3', monto: 480000 };
  const r = calcularItem(item, cats, 'xml');
  assert.equal(r.categoria_codigo, 'agua_potable');
  assert.equal(r.metodo, 'fisico');
  // 120 m³ × 0,41 kgCO2e/m³ = 49,2 kg = 0,0492 t.
  assert.ok(Math.abs(r.co2e - 0.0492) < 1e-9, `co2e esperado 0.0492, fue ${r.co2e}`);
});
