import test from 'node:test';
import assert from 'node:assert/strict';
import { hashAsiento, perfilFinanciero, validarLineas } from '../src/services/contabilidad.js';

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

test('perfil financiero informa ratios y no los presenta como decisión de crédito', () => {
  const r = perfilFinanciero({
    cuentas: [
      { rol_bancario: 'caja', saldo_deudor: 100, saldo_acreedor: 0 },
      { rol_bancario: 'pasivo_corriente', saldo_deudor: 0, saldo_acreedor: 200 },
      { rol_bancario: 'patrimonio', saldo_deudor: 0, saldo_acreedor: 50 },
    ], nAsientos: 3, coberturaRespaldo: 1, ultimoAsiento: '2026-09-03', hoy: new Date('2026-09-04T00:00:00Z'),
  });
  assert.equal(r.metricas.razon_liquidez, 0.5);
  assert.equal(r.estado, 'requiere_revision');
  assert.ok(r.alertas.some((a) => a.codigo === 'LIQUIDEZ_BAJA'));
});
