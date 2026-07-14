import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valorizar } from '../src/services/valorizacion.js';

const ENTRADAS = [
  { descripcion: 'Diésel B5', tipo: 'entrada', cantidad: 100, precio_unitario: 1000, co2e_unitario: 0.002 },
  { descripcion: 'Diésel B5', tipo: 'entrada', cantidad: 100, precio_unitario: 1200, co2e_unitario: 0.002 },
];

test('FIFO consume las capas más antiguas primero', () => {
  const { items } = valorizar([...ENTRADAS, { descripcion: 'Diésel B5', tipo: 'salida', cantidad: 150 }], 'fifo');
  const it = items[0];
  // Salida: 100 × $1000 + 50 × $1200 = $160.000
  assert.equal(it.costo_salidas_clp, 160000);
  // Stock: 50 unidades a $1200 = $60.000
  assert.equal(it.stock, 50);
  assert.equal(it.valor_clp, 60000);
  assert.equal(it.precio_unitario, 1200);
});

test('PMP usa el promedio ponderado', () => {
  const { items } = valorizar([...ENTRADAS, { descripcion: 'Diésel B5', tipo: 'salida', cantidad: 150 }], 'pmp');
  const it = items[0];
  // PMP tras las dos entradas: (100×1000 + 100×1200)/200 = $1100
  assert.equal(it.costo_salidas_clp, 150 * 1100);
  assert.equal(it.stock, 50);
  assert.equal(it.valor_clp, 50 * 1100);
});

test('el CO2e del stock y de las salidas es consistente', () => {
  const { items, totales } = valorizar([...ENTRADAS, { descripcion: 'Diésel B5', tipo: 'salida', cantidad: 150 }], 'fifo');
  const it = items[0];
  // CO2e total entradas = 200 × 0.002 = 0.4; salidas 150 × 0.002 = 0.3; stock 0.1
  assert.equal(it.costo_salidas_co2e, 0.3);
  assert.equal(it.co2e_stock, 0.1);
  assert.equal(totales.co2e_stock, 0.1);
});

test('una salida mayor al stock se informa sin dejar stock negativo', () => {
  const { items } = valorizar([
    { descripcion: 'Cal', tipo: 'entrada', cantidad: 10, precio_unitario: 500, co2e_unitario: 0.001 },
    { descripcion: 'Cal', tipo: 'salida', cantidad: 25 },
  ], 'fifo');
  const it = items[0];
  assert.equal(it.stock, 0);
  assert.equal(it.salidas_sin_stock, 15);
  assert.equal(it.costo_salidas_clp, 5000); // solo lo que había
});

test('varios ítems se valorizan por separado y los totales suman', () => {
  const { items, totales } = valorizar([
    { descripcion: 'A', tipo: 'entrada', cantidad: 1, precio_unitario: 100, co2e_unitario: 0 },
    { descripcion: 'B', tipo: 'entrada', cantidad: 2, precio_unitario: 50, co2e_unitario: 0 },
  ], 'fifo');
  assert.equal(items.length, 2);
  assert.equal(totales.valor_clp, 200);
  assert.equal(totales.n_items, 2);
});

test('entrada sin movimientos no falla', () => {
  const r = valorizar([], 'fifo');
  assert.deepEqual(r.items, []);
  assert.equal(r.totales.valor_clp, 0);
});
