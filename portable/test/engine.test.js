import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analizar } from '../lib/engine.js';

test('analizar es determinista para la misma semilla', () => {
  const a = analizar({ filename: 'f1.pdf', index: 0, rutReceptor: '11.111.111-1' });
  const b = analizar({ filename: 'f1.pdf', index: 0, rutReceptor: '11.111.111-1' });
  assert.deepEqual(a, b);
});

test('analizar devuelve 2–5 ítems que suman el total', () => {
  const a = analizar({ filename: 'x.pdf', index: 2 });
  assert.ok(a.items.length >= 2 && a.items.length <= 5);
  const suma = a.items.reduce((s, it) => s + it.co2e, 0);
  assert.ok(Math.abs(suma - a.total_co2e) < 0.01);
  const pct = a.items.reduce((s, it) => s + it.porcentaje_total, 0);
  assert.ok(Math.abs(pct - 100) < 0.5);
});

test('analizar respeta el rut_receptor entregado', () => {
  const a = analizar({ filename: 'y.pdf', index: 0, rutReceptor: '22.222.222-2' });
  assert.equal(a.rut_receptor, '22.222.222-2');
  assert.ok(a.numero_venta.startsWith('V-'));
});
