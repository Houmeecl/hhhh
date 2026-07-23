import { test } from 'node:test';
import assert from 'node:assert/strict';
import { derivarMovimientos, valorizarActivo, hashMovimientoNatural } from '../src/services/capitalNatural.js';

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

test('valorizarActivo: el valor manual manda sobre el precio automático', () => {
  const r = valorizarActivo({ valor_clp: 5_000_000, extension: 10, precio_clp_unidad: 344 });
  assert.deepEqual(r, { valor_clp_efectivo: 5000000, valor_origen: 'manual' });
});

test('valorizarActivo: sin valor manual, calcula automático con el precio de la cuenta', () => {
  // 1.000 m3 × $344/m3 = $344.000
  const r = valorizarActivo({ valor_clp: null, extension: 1000, precio_clp_unidad: 344 });
  assert.deepEqual(r, { valor_clp_efectivo: 344000, valor_origen: 'automatico' });
});

test('valorizarActivo: sin valor manual ni precio de cuenta, no hay dato (no se inventa)', () => {
  const r = valorizarActivo({ valor_clp: null, extension: 1000, precio_clp_unidad: null });
  assert.deepEqual(r, { valor_clp_efectivo: null, valor_origen: null });
});

test('valorizarActivo: precio cero o negativo se trata como "sin precio"', () => {
  assert.equal(valorizarActivo({ extension: 10, precio_clp_unidad: 0 }).valor_origen, null);
  assert.equal(valorizarActivo({ extension: 10, precio_clp_unidad: -5 }).valor_origen, null);
});

test('valorizarActivo: valor manual igual a 0 sigue siendo manual (no cae al automático)', () => {
  const r = valorizarActivo({ valor_clp: 0, extension: 10, precio_clp_unidad: 344 });
  assert.deepEqual(r, { valor_clp_efectivo: 0, valor_origen: 'manual' });
});

test('valorizarActivo: redondea a entero (CLP no usa decimales)', () => {
  const r = valorizarActivo({ valor_clp: null, extension: 3, precio_clp_unidad: 333.333 });
  assert.equal(Number.isInteger(r.valor_clp_efectivo), true);
});

test('valorizarActivo: unidad del activo distinta a la de la cuenta NO se mezcla (sin dato, no un número incorrecto)', () => {
  // Derecho de agua en l/s (caudal) vs. cuenta AGUA en m3 (volumen) — no son comparables.
  const r = valorizarActivo({ valor_clp: null, extension: 12, unidad: 'l/s', cuenta_unidad: 'm3', precio_clp_unidad: 344 });
  assert.deepEqual(r, { valor_clp_efectivo: null, valor_origen: null });
});

test('valorizarActivo: unidad del activo igual a la de la cuenta sí calcula (case-insensitive)', () => {
  const r = valorizarActivo({ valor_clp: null, extension: 1000, unidad: 'M3', cuenta_unidad: 'm3', precio_clp_unidad: 344 });
  assert.deepEqual(r, { valor_clp_efectivo: 344000, valor_origen: 'automatico' });
});

test('valorizarActivo: sin unidad propia en el activo, se asume compatible con la cuenta', () => {
  const r = valorizarActivo({ valor_clp: null, extension: 1000, unidad: null, cuenta_unidad: 'm3', precio_clp_unidad: 344 });
  assert.deepEqual(r, { valor_clp_efectivo: 344000, valor_origen: 'automatico' });
});

// ---------- hashMovimientoNatural (mini-cadena por cuenta, migración 029) ----------

const MOV_A = {
  cuenta_codigo: 'ENER', fecha: '2026-07-01', glosa: 'Suministro eléctrico', cantidad: 2500,
  unidad: 'kWh', tipo: 'cargo', origen: 'documento', factura_id: 'f-1',
};

test('hashMovimientoNatural es determinista (mismo contenido → mismo hash)', () => {
  assert.equal(hashMovimientoNatural(MOV_A), hashMovimientoNatural({ ...MOV_A }));
});

test('hashMovimientoNatural es sensible a cada campo', () => {
  const base = hashMovimientoNatural(MOV_A);
  assert.notEqual(base, hashMovimientoNatural({ ...MOV_A, cuenta_codigo: 'AGUA' }));
  assert.notEqual(base, hashMovimientoNatural({ ...MOV_A, cantidad: 2501 }));
  assert.notEqual(base, hashMovimientoNatural({ ...MOV_A, tipo: 'abono' }));
  assert.notEqual(base, hashMovimientoNatural({ ...MOV_A, origen: 'manual' }));
  assert.notEqual(base, hashMovimientoNatural({ ...MOV_A, factura_id: 'f-2' }));
  assert.notEqual(base, hashMovimientoNatural({ ...MOV_A, fecha: '2026-07-02' }));
});

test('hashMovimientoNatural no depende de la hora del día, solo de la fecha', () => {
  const a = hashMovimientoNatural({ ...MOV_A, fecha: new Date('2026-07-01T08:00:00Z') });
  const b = hashMovimientoNatural({ ...MOV_A, fecha: new Date('2026-07-01T23:00:00Z') });
  assert.equal(a, b);
});
