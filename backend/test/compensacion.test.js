import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validarCompensacion,
  validarTarifa,
  validarTipoCambio,
  calcularMonto,
  montoUsdDesdeClp,
  ESTADOS_PUBLICOS,
  MAX_METODO,
  TARIFA_MAX_CLP,
  TIPO_CAMBIO_MAX_CLP,
} from '../src/services/compensacion.js';

// ---------- validarCompensacion ----------

test('validarCompensacion acepta simulado y omitido (los únicos públicos)', () => {
  assert.deepEqual(ESTADOS_PUBLICOS, ['simulado', 'omitido']);
  assert.equal(validarCompensacion({ estado: 'simulado' }).ok, true);
  assert.equal(validarCompensacion({ estado: 'omitido' }).ok, true);
});

test('validarCompensacion rechaza estados reservados o basura', () => {
  // 'pendiente' y 'pagado' existen en el esquema pero son de la pasarela real.
  for (const estado of ['pendiente', 'pagado', 'PAGADO', '', null, undefined, 42, ['simulado']]) {
    const r = validarCompensacion({ estado });
    assert.equal(r.ok, false, `estado ${JSON.stringify(estado)} debió rechazarse`);
    assert.match(r.error, /estado/);
  }
  // Body ausente tampoco revienta.
  assert.equal(validarCompensacion().ok, false);
});

test('validarCompensacion sanea el método (opcional, recortado, con tope)', () => {
  assert.equal(validarCompensacion({ estado: 'simulado' }).metodo, null);
  assert.equal(validarCompensacion({ estado: 'simulado', metodo: null }).metodo, null);
  assert.equal(validarCompensacion({ estado: 'simulado', metodo: '' }).metodo, null);
  assert.equal(validarCompensacion({ estado: 'simulado', metodo: '  tarjeta  ' }).metodo, 'tarjeta');

  assert.equal(validarCompensacion({ estado: 'simulado', metodo: 42 }).ok, false);
  assert.equal(validarCompensacion({ estado: 'simulado', metodo: '   ' }).ok, false);
  assert.equal(validarCompensacion({ estado: 'simulado', metodo: 'x'.repeat(MAX_METODO + 1) }).ok, false);
  assert.equal(validarCompensacion({ estado: 'simulado', metodo: 'x'.repeat(MAX_METODO) }).ok, true);
});

// ---------- validarTarifa ----------

test('validarTarifa exige número > 0 y <= $1.000.000', () => {
  assert.deepEqual(validarTarifa(5000), { ok: true, tarifa: 5000 });
  assert.deepEqual(validarTarifa('7500.5'), { ok: true, tarifa: 7500.5 }); // string numérico del form
  assert.equal(validarTarifa(TARIFA_MAX_CLP).ok, true);

  for (const v of [0, -1, TARIFA_MAX_CLP + 1, 'abc', '', null, undefined, NaN, Infinity, true]) {
    assert.equal(validarTarifa(v).ok, false, `tarifa ${JSON.stringify(v)} debió rechazarse`);
  }
});

// ---------- validarTipoCambio ----------

test('validarTipoCambio: null/vacío/undefined LIMPIAN el valor (frontend sin USD)', () => {
  assert.deepEqual(validarTipoCambio(null), { ok: true, tipo_cambio: null });
  assert.deepEqual(validarTipoCambio(undefined), { ok: true, tipo_cambio: null });
  assert.deepEqual(validarTipoCambio(''), { ok: true, tipo_cambio: null });
});

test('validarTipoCambio acepta números > 0 hasta el tope', () => {
  assert.deepEqual(validarTipoCambio(950), { ok: true, tipo_cambio: 950 });
  assert.deepEqual(validarTipoCambio('987.45'), { ok: true, tipo_cambio: 987.45 }); // string del form
  assert.equal(validarTipoCambio(TIPO_CAMBIO_MAX_CLP).ok, true);
});

test('validarTipoCambio rechaza basura, negativos y sobre el tope', () => {
  for (const v of [0, -1, TIPO_CAMBIO_MAX_CLP + 1, 'abc', NaN, Infinity, true, false]) {
    assert.equal(validarTipoCambio(v).ok, false, `tipo de cambio ${JSON.stringify(v)} debió rechazarse`);
  }
});

// ---------- calcularMonto ----------

test('calcularMonto redondea a pesos enteros (t CO2e × tarifa)', () => {
  assert.equal(calcularMonto(0.582, 5000, 'simulado'), 2910);
  assert.equal(calcularMonto('0.582', '5000', 'simulado'), 2910); // NUMERIC de pg llega como string
  assert.equal(calcularMonto(0.5555, 5000, 'simulado'), 2778);    // 2777.5 → 2778
  assert.equal(calcularMonto(1.00004, 5000, 'simulado'), 5000);   // 5000.2 → 5000
});

test('calcularMonto es $0 para omitido y para entradas inválidas', () => {
  assert.equal(calcularMonto(0.582, 5000, 'omitido'), 0); // se registra la decisión sin cobro
  assert.equal(calcularMonto(0, 5000, 'simulado'), 0);
  assert.equal(calcularMonto(-1, 5000, 'simulado'), 0);   // jamás un cobro negativo
  assert.equal(calcularMonto(1, 0, 'simulado'), 0);
  assert.equal(calcularMonto('abc', 5000, 'simulado'), 0);
  assert.equal(calcularMonto(1, NaN, 'simulado'), 0);
});

// ---------- montoUsdDesdeClp ----------

test('montoUsdDesdeClp convierte y redondea a 2 decimales', () => {
  assert.equal(montoUsdDesdeClp(10000, 943.5), 10.6); // 10.5989… → 10.6
  assert.equal(montoUsdDesdeClp(5000, 1000), 5);
  assert.equal(montoUsdDesdeClp('5000', '1000'), 5); // strings numéricos de la BD
});

test('montoUsdDesdeClp devuelve null sin tipo de cambio o con valores inválidos', () => {
  for (const [monto, tc] of [
    [5000, null], [5000, undefined], [5000, 0], [5000, -10], [5000, 'abc'],
    [null, 900], [0, 900], [-1, 900], ['abc', 900], [NaN, 900], [Infinity, 900],
  ]) {
    assert.equal(montoUsdDesdeClp(monto, tc), null, `(${monto}, ${tc}) debió ser null`);
  }
});
