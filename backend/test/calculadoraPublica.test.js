import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { categoriasSeed } from './helpers/categoriasSeed.js';

// ============================================================
// La calculadora pública de la portada (GET /publico/calculadora) resuelve
// cada fila buscando su categoría por código en motor_categorias, y OMITE
// la fila cuando no la encuentra — para no inventar un factor. Es el
// comportamiento correcto en producción, pero convierte un error de tipeo
// en una entrada que desaparece de la pantalla sin avisar: eso fue
// exactamente lo que pasó con 'combustibles' (plural) contra la categoría
// real 'combustible', y la portada estuvo estimando ~la mitad para
// cualquiera que quemara combustible.
//
// Este test lee la lista ENTRADAS del propio componente y la contrasta
// contra el seed. No hay BD de por medio: mismo enfoque que
// motorSeedParidad.test.js.
// ============================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPONENTE = path.join(
  __dirname, '../../frontend/src/components/CalculadoraCompensacion.jsx'
);

// { codigo: 'x', tipo: 'fisico', ... } → [{ codigo, tipo }]
function entradasDelComponente() {
  const src = fs.readFileSync(COMPONENTE, 'utf8');
  const bloque = src.match(/const ENTRADAS = \[([\s\S]*?)\n\];/);
  assert.ok(bloque, 'no se encontró el arreglo ENTRADAS en el componente');
  const filas = [...bloque[1].matchAll(
    /\{\s*codigo:\s*'([a-z0-9_]+)',\s*tipo:\s*'(fisico|gasto)'/g
  )].map((m) => ({ codigo: m[1], tipo: m[2] }));
  return filas;
}

test('la calculadora pública encontró sus entradas (autocontrol del parser)', () => {
  const entradas = entradasDelComponente();
  assert.ok(entradas.length >= 4,
    `se esperaban al menos 4 entradas, se parsearon ${entradas.length} — ` +
    'si cambió el formato de ENTRADAS hay que ajustar el regex, no borrar el test');
});

test('cada entrada de la calculadora existe como categoría activa del motor', () => {
  const seed = categoriasSeed();
  for (const { codigo } of entradasDelComponente()) {
    const cat = seed.get(codigo);
    assert.ok(cat,
      `la calculadora pide la categoría '${codigo}', que el motor no siembra. ` +
      'La fila se omitiría en silencio y la portada estimaría de menos. ' +
      'Corregir el código en CalculadoraCompensacion.jsx (no renombrar la ' +
      'categoría: es llave de motor_categorias y de los snapshots de versión).');
    assert.equal(cat.activo, true,
      `la categoría '${codigo}' está desactivada: su fila desaparecería de la portada`);
  }
});

test('cada entrada trae el factor del tipo que la calculadora le pide', () => {
  const seed = categoriasSeed();
  for (const { codigo, tipo } of entradasDelComponente()) {
    const cat = seed.get(codigo);
    const factor = tipo === 'fisico'
      ? cat.factor_fisico_kgco2e
      : cat.factor_gasto_kgco2e_clp1000;
    assert.ok(Number(factor) > 0,
      `'${codigo}' se usa como '${tipo}' pero su factor correspondiente es ${factor}: ` +
      'la fila se omitiría igual que si faltara la categoría');
  }
});

test('los valores por defecto de la portada dan el total que promete la pantalla', () => {
  const seed = categoriasSeed();
  // Mismos valores iniciales que ENTRADAS y misma aritmética que el
  // componente: físico → cantidad × factor / 1000; gasto → (clp/1000) × factor / 1000.
  const POR_DEFECTO = {
    electricidad: 2500, combustible: 300, transporte: 1000, servicios: 500000,
  };
  const total = entradasDelComponente().reduce((acc, { codigo, tipo }) => {
    const v = POR_DEFECTO[codigo];
    assert.ok(v != null, `falta el valor por defecto de '${codigo}' en este test`);
    const cat = seed.get(codigo);
    return acc + (tipo === 'fisico'
      ? (v * cat.factor_fisico_kgco2e) / 1000
      : ((v / 1000) * cat.factor_gasto_kgco2e_clp1000) / 1000);
  }, 0);

  // 2.500 kWh × 0,2421 = 0,605250 | 300 L × 2,68 = 0,804000
  // 1.000 km × 0,12   = 0,120000 | $500.000 × 0,25/1.000 = 0,125000
  assert.ok(Math.abs(total - 1.65425) < 1e-9, `total esperado 1,65425 t, fue ${total}`);
  // Tarifa por defecto de config_pos (public.js usa 5000 si no hay fila).
  assert.equal(Math.round(total * 5000), 8271);
});
