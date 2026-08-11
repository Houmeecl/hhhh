import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularCo2eViaje, resumenTransporte } from '../src/services/transporte.js';

test('calcularCo2eViaje aplica la fórmula km × tramos × pasajeros × factor / 1000', () => {
  // 100 km, 1 tramo, 1 pasajero, factor 0.1 kgCO2e/pkm → 100*1*1*0.1/1000 = 0.01 t
  const r = calcularCo2eViaje({ km: 100, pasajeros: 1, ida_vuelta: false, factor_kgco2e_pkm: 0.1 });
  assert.equal(r, 0.01);
});

test('ida y vuelta duplica el trayecto', () => {
  const soloIda = calcularCo2eViaje({ km: 50, pasajeros: 1, ida_vuelta: false, factor_kgco2e_pkm: 0.2 });
  const idaVuelta = calcularCo2eViaje({ km: 50, pasajeros: 1, ida_vuelta: true, factor_kgco2e_pkm: 0.2 });
  assert.equal(idaVuelta, soloIda * 2);
});

test('más pasajeros aumenta el CO2e proporcionalmente', () => {
  const uno = calcularCo2eViaje({ km: 200, pasajeros: 1, ida_vuelta: false, factor_kgco2e_pkm: 0.08 });
  const cuarenta = calcularCo2eViaje({ km: 200, pasajeros: 40, ida_vuelta: false, factor_kgco2e_pkm: 0.08 });
  assert.equal(Math.round(cuarenta / uno), 40);
});

test('pasajeros vacío, cero o inválido usa mínimo 1 (no divide por 0 ni da NaN)', () => {
  const base = { km: 10, ida_vuelta: false, factor_kgco2e_pkm: 1 };
  assert.equal(calcularCo2eViaje({ ...base, pasajeros: undefined }), calcularCo2eViaje({ ...base, pasajeros: 1 }));
  assert.equal(calcularCo2eViaje({ ...base, pasajeros: 0 }), calcularCo2eViaje({ ...base, pasajeros: 1 }));
  assert.equal(calcularCo2eViaje({ ...base, pasajeros: -5 }), calcularCo2eViaje({ ...base, pasajeros: 1 }));
});

test('redondea a 4 decimales', () => {
  const r = calcularCo2eViaje({ km: 333, pasajeros: 3, ida_vuelta: true, factor_kgco2e_pkm: 0.123 });
  const str = String(r);
  const decimales = str.includes('.') ? str.split('.')[1].length : 0;
  assert.ok(decimales <= 4, `esperaba ≤4 decimales, obtuvo ${r}`);
});

test('caso real: Antofagasta–Calama en bus, 40 pasajeros, ida y vuelta', () => {
  // 215 km, factor referencial bus ~0.03 kgCO2e/pkm
  const r = calcularCo2eViaje({ km: 215, pasajeros: 40, ida_vuelta: true, factor_kgco2e_pkm: 0.03 });
  // 215 * 2 * 40 * 0.03 / 1000 = 0.516
  assert.equal(r, 0.516);
});

// ============================================================
// resumenTransporte — agregación por modo y por período (mismo patrón
// que resumenRep de repProveedor.js).
// ============================================================

const VIAJE = (over = {}) => ({
  fecha: '2026-06-15', modo: 'bus', modo_nombre: 'Bus', km: 100, co2e: 0.5, ...over,
});

test('resumenTransporte: totaliza km y co2e', () => {
  const r = resumenTransporte([VIAJE({ km: 100, co2e: 0.5 }), VIAJE({ km: 50, co2e: 0.2 })]);
  assert.equal(r.total.km, 150);
  assert.equal(r.total.co2e, 0.7);
  assert.equal(r.total.n_viajes, 2);
});

test('resumenTransporte: agrupa por modo, ordenado por co2e descendente', () => {
  const r = resumenTransporte([
    VIAJE({ modo: 'bus', modo_nombre: 'Bus', co2e: 0.2 }),
    VIAJE({ modo: 'avion', modo_nombre: 'Avión', co2e: 0.9 }),
  ]);
  assert.equal(r.por_modo[0].modo, 'avion');
  assert.equal(r.por_modo[0].co2e, 0.9);
  assert.equal(r.por_modo[1].modo, 'bus');
});

test('resumenTransporte: agrupa por período (AAAA-MM), más reciente primero', () => {
  const r = resumenTransporte([
    VIAJE({ fecha: '2026-05-10', co2e: 0.1 }),
    VIAJE({ fecha: '2026-06-01', co2e: 0.2 }),
    VIAJE({ fecha: '2026-06-20', co2e: 0.3 }),
  ]);
  assert.equal(r.por_periodo.length, 2);
  assert.equal(r.por_periodo[0].periodo, '2026-06');
  assert.equal(r.por_periodo[0].co2e, 0.5);
  assert.equal(r.por_periodo[0].n_viajes, 2);
  assert.equal(r.por_periodo[1].periodo, '2026-05');
});

test('resumenTransporte: lista vacía no revienta', () => {
  const r = resumenTransporte([]);
  assert.equal(r.total.km, 0);
  assert.equal(r.total.n_viajes, 0);
  assert.deepEqual(r.por_modo, []);
  assert.deepEqual(r.por_periodo, []);
});
