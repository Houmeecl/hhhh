import { test } from 'node:test';
import assert from 'node:assert/strict';
import { derivarMovimientos } from '../src/services/capitalNatural.js';

function cuentas(overrides = {}) {
  const base = {
    AGUA: { activo: true, factores: { agua_kgco2e_m3: 0.344 } },
    ENER: { activo: true, factores: { electricidad_kgco2e_kwh: 0.2421 } },
    CO2E: { activo: true, factores: {} },
    MATR: { activo: true, factores: { materiales_kgco2e_kg: 1.5 } },
    SUEL: { activo: false, factores: {} },
    BIOD: { activo: false, factores: {} },
  };
  return new Map(Object.entries({ ...base, ...overrides }));
}

test('energía eléctrica genera ENER (kWh) + CO2E', () => {
  const movs = derivarMovimientos(
    { categoria: 'Energía eléctrica', total_co2e: 2.421, numero_venta: 'V-1' },
    cuentas()
  );
  const codigos = movs.map((m) => m.cuenta_codigo).sort();
  assert.deepEqual(codigos, ['CO2E', 'ENER']);
  const ener = movs.find((m) => m.cuenta_codigo === 'ENER');
  // 2,421 tCO2e / 0,2421 kgCO2e/kWh = 10.000 kWh
  assert.equal(ener.cantidad, 10000);
  assert.equal(ener.unidad, 'kWh');
  const co2e = movs.find((m) => m.cuenta_codigo === 'CO2E');
  assert.equal(co2e.cantidad, 2.421);
  assert.equal(co2e.unidad, 'tCO2e');
});

test('agua genera AGUA (m3) + CO2E', () => {
  const movs = derivarMovimientos({ categoria: 'Agua', total_co2e: 0.344, numero_venta: 'V-2' }, cuentas());
  const agua = movs.find((m) => m.cuenta_codigo === 'AGUA');
  assert.ok(agua, 'debe cargar AGUA');
  assert.equal(agua.cantidad, 1000); // 0,344 t / 0,344 kg/m3 = 1.000 m3
  assert.equal(agua.unidad, 'm3');
});

test('insumos y materiales genera MATR (t) + CO2E', () => {
  const movs = derivarMovimientos({ categoria: 'Insumos y materiales', total_co2e: 3, numero_venta: 'V-3' }, cuentas());
  const matr = movs.find((m) => m.cuenta_codigo === 'MATR');
  assert.ok(matr, 'debe cargar MATR');
  assert.equal(matr.cantidad, 2); // 3 tCO2e / 1,5 tCO2e/t = 2 t
  assert.equal(matr.unidad, 't');
});

test('combustibles y categorías desconocidas solo cargan CO2E', () => {
  for (const categoria of ['Combustibles', 'Transporte y logística', 'Servicios', 'Otra cosa']) {
    const movs = derivarMovimientos({ categoria, total_co2e: 1.5, numero_venta: 'V-4' }, cuentas());
    assert.equal(movs.length, 1, categoria);
    assert.equal(movs[0].cuenta_codigo, 'CO2E');
  }
});

test('cuentas inactivas no reciben movimientos', () => {
  const movs = derivarMovimientos(
    { categoria: 'Energía eléctrica', total_co2e: 2, numero_venta: 'V-5' },
    cuentas({ ENER: { activo: false, factores: {} }, CO2E: { activo: false, factores: {} } })
  );
  assert.deepEqual(movs, []);
});

test('la glosa referencia el documento de origen', () => {
  const movs = derivarMovimientos({ categoria: 'Servicios', total_co2e: 1, numero_venta: 'V-777' }, cuentas());
  assert.match(movs[0].glosa, /V-777/);
});

test('total cero o entrada inválida no genera movimientos', () => {
  assert.deepEqual(derivarMovimientos({ categoria: 'Agua', total_co2e: 0 }, cuentas()), []);
  assert.deepEqual(derivarMovimientos(null, cuentas()), []);
  assert.deepEqual(derivarMovimientos({ categoria: 'Agua', total_co2e: 1 }, null), []);
});
