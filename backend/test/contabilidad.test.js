import test from 'node:test';
import assert from 'node:assert/strict';
import { hashAsiento, validarLineas } from '../src/services/contabilidad.js';

test('validarLineas acepta una partida doble cuadrada', () => {
  const r = validarLineas([
    { cuenta_id: 'a', debito: '1190.50', haber: 0 },
    { cuenta_id: 'b', debito: 0, haber: '1190.50' },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.debito, 1190.5);
  assert.equal(r.haber, 1190.5);
});

test('validarLineas rechaza asiento desbalanceado y línea con dos lados', () => {
  assert.equal(validarLineas([{ cuenta_id: 'a', debito: 100, haber: 0 }, { cuenta_id: 'b', debito: 0, haber: 99 }]).ok, false);
  assert.equal(validarLineas([{ cuenta_id: 'a', debito: 100, haber: 1 }, { cuenta_id: 'b', debito: 0, haber: 101 }]).ok, false);
});

test('hashAsiento es estable y cambia si cambia el contenido', () => {
  const base = { cliente_id: 'c', periodo_id: 'p', numero: 1, fecha: '2026-09-03', glosa: 'Compra', referencia: 'F-1', lineas: [{ cuenta_id: 'a', debito: 100, haber: 0 }, { cuenta_id: 'b', debito: 0, haber: 100 }] };
  assert.equal(hashAsiento(base), hashAsiento({ ...base }));
  assert.notEqual(hashAsiento(base), hashAsiento({ ...base, glosa: 'Compra corregida' }));
});
