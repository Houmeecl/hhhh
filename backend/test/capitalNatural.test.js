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

// ============================================================
// El catch-all del motor no inventa consumo físico.
//
// Cuando ninguna palabra clave calza, el motor devuelve 'servicios', que no
// toca cuentas físicas — así que hoy el riesgo está dormido. Pero si un admin
// desactiva 'servicios' desde el panel (lo que ya se hizo con 'transporte' en
// la migración 075), el catch-all pasa a la primera categoría activa por
// orden de código, que depende del catálogo del día. Desde ahí, cada
// documento que el motor no supo
// clasificar registraría consumo que nadie tuvo, en un libro sellado por
// cadena de hash: dato inventado y además inmutable.
//
// La señal es `categoria_origen = 'sin_coincidencia'` (migración 077).
// ============================================================
test('sin coincidencia con categoría de agua: NO carga m3 inventados, pero sí el CO2e real', () => {
  const movs = derivarMovimientos(
    { categoria: 'Agua', categoria_origen: 'sin_coincidencia', total_co2e: 0.344, numero_venta: 'V-CATCH' },
    cuentas()
  );
  assert.deepEqual(movs.map((m) => m.cuenta_codigo), ['CO2E'], 'solo la cuenta de carbono');
  assert.equal(movs[0].cantidad, 0.344, 'el CO2e se calculó de verdad, aunque no se sepa de qué fue el gasto');
});

test('sin coincidencia con categoría de energía o materiales: mismo criterio', () => {
  for (const categoria of ['Energía eléctrica', 'Insumos y materiales']) {
    const movs = derivarMovimientos(
      { categoria, categoria_origen: 'sin_coincidencia', total_co2e: 1, numero_venta: 'V-CATCH' },
      cuentas()
    );
    assert.deepEqual(movs.map((m) => m.cuenta_codigo), ['CO2E'], `${categoria}: solo CO2E`);
  }
});

test('clasificado de verdad ("glosa"): las cuentas físicas se cargan igual que siempre', () => {
  const movs = derivarMovimientos(
    { categoria: 'Agua', categoria_origen: 'glosa', total_co2e: 0.344, numero_venta: 'V-OK' },
    cuentas()
  );
  const agua = movs.find((m) => m.cuenta_codigo === 'AGUA');
  assert.ok(agua, 'una categoría que sí salió de la glosa carga su cuenta física');
  assert.equal(agua.cantidad, 1000);
});

test('documento anterior a la migración 077 (sin procedencia): se comporta como antes', () => {
  // De estos no consta de dónde salió la categoría, y no hay forma de saberlo
  // hacia atrás. Cambiarles el comportamiento reescribiría el histórico.
  const movs = derivarMovimientos({ categoria: 'Agua', total_co2e: 0.344, numero_venta: 'V-VIEJA' }, cuentas());
  assert.ok(movs.some((m) => m.cuenta_codigo === 'AGUA'));
});

// ============================================================
// La glosa sellada no puede nombrar una categoría que este mismo código acaba
// de declarar sin clasificar: queda inmutable en el libro por cuenta.
// ============================================================
test('la glosa del cargo CO2E no nombra la categoría cuando el motor no la dedujo', () => {
  const movs = derivarMovimientos(
    { categoria: 'Agua', categoria_origen: 'sin_coincidencia', total_co2e: 1, numero_venta: 'V-CATCH' },
    cuentas()
  );
  const co2e = movs.find((m) => m.cuenta_codigo === 'CO2E');
  assert.ok(!co2e.glosa.includes('Agua'), 'sellar "Agua" acá sería inmutable y falso');
  assert.match(co2e.glosa, /sin clasificar/);
  assert.match(co2e.glosa, /V-CATCH/, 'sigue trazando al documento');
});

test('clasificado: la glosa sí nombra la categoría', () => {
  const movs = derivarMovimientos(
    { categoria: 'Agua', categoria_origen: 'glosa', total_co2e: 1, numero_venta: 'V-OK' },
    cuentas()
  );
  assert.match(movs.find((m) => m.cuenta_codigo === 'CO2E').glosa, /^Agua — V-OK$/);
});

// ============================================================
// La cantidad física se deriva del CO2e, así que hay que derivarla SOLO del
// CO2e de esta categoría. La categoría de la factura es la del ítem DOMINANTE
// (motorPropio.calcularFactura), no la de todos sus ítems: en una factura
// mixta, usar el total convierte el CO2e de los otros ítems en kilowatt-hora.
// ============================================================
test('factura mixta: los kWh salen del ítem eléctrico, no del total del documento', () => {
  const movs = derivarMovimientos(
    {
      categoria: 'Energía eléctrica', categoria_codigo: 'electricidad',
      total_co2e: 17.1067, numero_venta: 'V-MIXTA',
      items: [
        { descripcion: 'Suministro eléctrico 50.000 kWh', co2e: 12.105, categoria_codigo: 'electricidad' },
        { descripcion: 'Honorarios estudio jurídico', co2e: 5.0017, categoria_codigo: 'servicios' },
      ],
    },
    cuentas()
  );
  const ener = movs.find((m) => m.cuenta_codigo === 'ENER');
  assert.equal(ener.cantidad, 50000, 'los honorarios no son electricidad');

  const co2e = movs.find((m) => m.cuenta_codigo === 'CO2E');
  assert.equal(co2e.cantidad, 17.1067, 'la cuenta de carbono sí lleva el documento entero');
});

test('sin ítems con categoría (motor externo, histórico): se usa el total, que ahí sí corresponde', () => {
  // El adaptador externo entrega UNA categoría para el documento completo.
  const movs = derivarMovimientos(
    { categoria: 'Energía eléctrica', total_co2e: 2.421, numero_venta: 'V-EXT' },
    cuentas()
  );
  assert.equal(movs.find((m) => m.cuenta_codigo === 'ENER').cantidad, 10000);
});

// ============================================================
// Bug de auditoría: el switch comparaba por NOMBRE (factura.categoria).
// "Agua" pasó a llamarse "Agua potable (red)" (código 'agua_potable',
// migración 031) y desde entonces ningún documento de agua REAL — el que
// trae categoria_codigo, porque se calculó después de la migración 077 —
// cargaba la cuenta AGUA: el case nunca calzaba contra el nombre nuevo.
// ============================================================
test('agua REAL (con categoria_codigo, nombre vigente) carga AGUA — antes del fix caía siempre al default', () => {
  const movs = derivarMovimientos(
    // 0,344 tCO2e / 0,344 kgCO2e/m3 (factor propio de la cuenta en el fixture) = 1.000 m3
    { categoria: 'Agua potable (red)', categoria_codigo: 'agua_potable', total_co2e: 0.344, numero_venta: 'V-REAL' },
    cuentas()
  );
  const agua = movs.find((m) => m.cuenta_codigo === 'AGUA');
  assert.ok(agua, 'un documento de agua con categoria_codigo debe cargar la cuenta física AGUA');
  assert.equal(agua.cantidad, 1000);
});

test('agua sin factor propio en la cuenta usa el default VIGENTE (0,41 DEFRA 2024), no el 0,344 legado y desactivado', () => {
  const movs = derivarMovimientos(
    { categoria: 'Agua potable (red)', categoria_codigo: 'agua_potable', total_co2e: 0.41, numero_venta: 'V-DEFAULT' },
    cuentas({ AGUA: { activo: true, factores: {} } }) // sin factor propio → cae al DEFAULT del módulo
  );
  const agua = movs.find((m) => m.cuenta_codigo === 'AGUA');
  assert.equal(agua.cantidad, 1000); // 0,41 t / 0,41 kg/m3 (default) = 1.000 m3
});
