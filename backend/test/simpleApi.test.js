import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReal, mockAnalyzeInvoice } from '../src/services/simpleApi.js';

test('normalizeReal mapea variante snake_case', () => {
  const created = { id: 'inv_1', sale_number: 'V-100', issuer_tax_id: '11.111.111-1', receiver_tax_id: '22.222.222-2' };
  const totals = { total_co2e: 10, main_category: 'Energía eléctrica', line_items: [
    { description: 'Suministro', quantity: 2, co2e: 6, percent: 60 },
    { description: 'Consumo', quantity: 1, co2e: 4, percent: 40 },
  ] };
  const r = normalizeReal(created, totals);
  assert.equal(r.invoice_id_simple, 'inv_1');
  assert.equal(r.numero_venta, 'V-100');
  assert.equal(r.rut_emisor, '11.111.111-1');
  assert.equal(r.categoria, 'Energía eléctrica');
  assert.equal(r.total_co2e, 10);
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].descripcion, 'Suministro');
});

test('normalizeReal mapea variante camelCase / anidada', () => {
  const created = { id: 'x', saleNumber: 'V-9', issuer: { tax_id: '11.111.111-1' }, customer: { tax_id: '22.222.222-2' } };
  const totals = { totalCo2e: 5, category: 'Combustibles', items: [{ name: 'Diésel', qty: 3, co2: 5 }] };
  const r = normalizeReal(created, totals);
  assert.equal(r.numero_venta, 'V-9');
  assert.equal(r.rut_emisor, '11.111.111-1');
  assert.equal(r.rut_receptor, '22.222.222-2');
  assert.equal(r.categoria, 'Combustibles');
  assert.equal(r.items[0].descripcion, 'Diésel');
  assert.equal(r.items[0].co2e, 5);
});

test('normalizeReal calcula total y % si faltan', () => {
  const r = normalizeReal({ id: 'a' }, { line_items: [{ description: 'A', co2e: 3 }, { description: 'B', co2e: 1 }] });
  assert.equal(r.total_co2e, 4);
  assert.equal(r.items[0].porcentaje_total, 75);
  assert.equal(r.items[1].porcentaje_total, 25);
});

test('normalizeReal no lanza con payload vacío', () => {
  const r = normalizeReal(null, null);
  assert.equal(r.total_co2e, 0);
  assert.deepEqual(r.items, []);
  assert.equal(r.categoria, 'Sin categoría');
});

test('mockAnalyzeInvoice es determinista y coherente', () => {
  const a = mockAnalyzeInvoice({ filename: 'f1.pdf', index: 0, rutReceptor: '11.111.111-1' });
  const b = mockAnalyzeInvoice({ filename: 'f1.pdf', index: 0, rutReceptor: '11.111.111-1' });
  assert.deepEqual(a, b, 'misma semilla → mismo resultado');
  assert.ok(a.items.length >= 2 && a.items.length <= 5);
  const suma = a.items.reduce((s, it) => s + it.co2e, 0);
  assert.ok(Math.abs(suma - a.total_co2e) < 0.01, 'ítems suman el total');
  const pct = a.items.reduce((s, it) => s + it.porcentaje_total, 0);
  assert.ok(Math.abs(pct - 100) < 0.5, 'porcentajes ~100');
  assert.equal(a.rut_receptor, '11.111.111-1');
});
