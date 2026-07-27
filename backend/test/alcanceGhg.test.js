import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsearAlcanceGHG, agregarAlcance3, CATEGORIAS_ALCANCE3_GHG_PROTOCOL } from '../src/services/alcanceGhg.js';

test('parsearAlcanceGHG: Alcance 1 sin categoría', () => {
  assert.deepEqual(parsearAlcanceGHG('Alcance 1 — combustión estacionaria (gas natural)'),
    { alcance: 1, categoria: null, descripcion: 'combustión estacionaria (gas natural)' });
});

test('parsearAlcanceGHG: Alcance 2 sin categoría', () => {
  assert.deepEqual(parsearAlcanceGHG('Alcance 2 — electricidad comprada'),
    { alcance: 2, categoria: null, descripcion: 'electricidad comprada' });
});

test('parsearAlcanceGHG: Alcance 3 con categoría', () => {
  assert.deepEqual(parsearAlcanceGHG('Alcance 3 · Cat. 5 — residuos generados en la operación'),
    { alcance: 3, categoria: 5, descripcion: 'residuos generados en la operación' });
  assert.deepEqual(parsearAlcanceGHG('Alcance 3 · Cat. 4 — transporte y distribución (marítimo)'),
    { alcance: 3, categoria: 4, descripcion: 'transporte y distribución (marítimo)' });
});

test('parsearAlcanceGHG: texto sin patrón no revienta', () => {
  assert.deepEqual(parsearAlcanceGHG('texto libre sin formato'),
    { alcance: null, categoria: null, descripcion: 'texto libre sin formato' });
  assert.deepEqual(parsearAlcanceGHG(null), { alcance: null, categoria: null, descripcion: null });
  assert.deepEqual(parsearAlcanceGHG(''), { alcance: null, categoria: null, descripcion: null });
});

test('agregarAlcance3: agrupa por proveedor + categoría, suma tCO2e, cuenta documentos', () => {
  const rows = [
    { rut_proveedor: '761111111', alcance_ghg: 'Alcance 3 · Cat. 5 — residuos generados en la operación', total_co2e: 1.5, organismo: 'DEFRA (Reino Unido)', documento: 'UK Government GHG Conversion Factors', version_anio: '2024' },
    { rut_proveedor: '761111111', alcance_ghg: 'Alcance 3 · Cat. 5 — residuos generados en la operación', total_co2e: 0.5, organismo: 'DEFRA (Reino Unido)', documento: 'UK Government GHG Conversion Factors', version_anio: '2024' },
    { rut_proveedor: '762222222', alcance_ghg: 'Alcance 3 · Cat. 1 — bienes adquiridos (agua potable)', total_co2e: 3.0, organismo: 'DEFRA (Reino Unido)', documento: 'UK Government GHG Conversion Factors', version_anio: '2024' },
  ];
  const filas = agregarAlcance3(rows);
  assert.equal(filas.length, 2);
  const relleno = filas.find((f) => f.rut_proveedor === '761111111');
  assert.equal(relleno.categoria_numero, 5);
  assert.equal(relleno.categoria_nombre, CATEGORIAS_ALCANCE3_GHG_PROTOCOL[5]);
  assert.equal(relleno.n_documentos, 2);
  assert.equal(relleno.total_tco2e, 2.0);
  assert.equal(relleno.fuente_factor, 'DEFRA (Reino Unido) — UK Government GHG Conversion Factors (2024)');
});

test('agregarAlcance3: junta descripciones distintas bajo la misma categoría Scope 3, sin perder ninguna', () => {
  const rows = [
    { rut_proveedor: '761111111', alcance_ghg: 'Alcance 3 · Cat. 1 — bienes adquiridos', total_co2e: 1, organismo: null, documento: null, version_anio: null },
    { rut_proveedor: '761111111', alcance_ghg: 'Alcance 3 · Cat. 1 — bienes adquiridos (agua potable)', total_co2e: 1, organismo: null, documento: null, version_anio: null },
  ];
  const [fila] = agregarAlcance3(rows);
  assert.ok(fila.descripcion_motor.includes('bienes adquiridos'));
  assert.ok(fila.descripcion_motor.includes('bienes adquiridos (agua potable)'));
});

test('agregarAlcance3: descarta filas de Alcance 1/2 aunque lleguen por error', () => {
  const rows = [{ rut_proveedor: '761111111', alcance_ghg: 'Alcance 1 — combustión propia (referencial)', total_co2e: 5 }];
  assert.equal(agregarAlcance3(rows).length, 0);
});

test('agregarAlcance3: filas sin categoría (Cat. ausente) quedan agrupadas aparte, sin nombre', () => {
  const rows = [{ rut_proveedor: '761111111', alcance_ghg: 'Alcance 3 — sin categoría definida', total_co2e: 2 }];
  const [fila] = agregarAlcance3(rows);
  assert.equal(fila.categoria_numero, null);
  assert.equal(fila.categoria_nombre, null);
});

test('agregarAlcance3: ordena por RUT y luego por categoría', () => {
  const rows = [
    { rut_proveedor: '762222222', alcance_ghg: 'Alcance 3 · Cat. 5 — x', total_co2e: 1 },
    { rut_proveedor: '761111111', alcance_ghg: 'Alcance 3 · Cat. 9 — y', total_co2e: 1 },
    { rut_proveedor: '761111111', alcance_ghg: 'Alcance 3 · Cat. 1 — z', total_co2e: 1 },
  ];
  const filas = agregarAlcance3(rows);
  assert.deepEqual(filas.map((f) => [f.rut_proveedor, f.categoria_numero]), [
    ['761111111', 1], ['761111111', 9], ['762222222', 5],
  ]);
});
