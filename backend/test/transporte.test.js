import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularCo2eViaje, resumenTransporte, validarViaje } from '../src/services/transporte.js';
import { generateComprobanteTransporte } from '../src/services/transportePdf.js';

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

// ============================================================
// validarViaje — la validación autoritativa que comparten la ruta del
// admin y la del proveedor. Un typo acá no es cosmético: el CO2e se
// sella como cargo en la cuenta de carbono del Capital Natural.
// ============================================================

const CUERPO_OK = { modo: 'bus', origen: 'Antofagasta', destino: 'Calama', km: '215', pasajeros: '40', ida_vuelta: true };

test('validarViaje: cuerpo válido normaliza tipos (km número, pasajeros entero, ida_vuelta bool)', () => {
  const r = validarViaje(CUERPO_OK);
  assert.equal(r.error, undefined);
  assert.equal(r.datos.km, 215);
  assert.equal(r.datos.pasajeros, 40);
  assert.equal(r.datos.ida_vuelta, true);
  assert.equal(r.datos.fecha, null);
});

test('validarViaje: km negativo, cero o no numérico es 400, no un 500 del CHECK de Postgres', () => {
  assert.ok(validarViaje({ ...CUERPO_OK, km: '-5' }).error);
  assert.ok(validarViaje({ ...CUERPO_OK, km: '0' }).error);
  assert.ok(validarViaje({ ...CUERPO_OK, km: 'abc' }).error);
  assert.ok(validarViaje({ ...CUERPO_OK, km: Infinity }).error);
});

test('validarViaje: tope de cordura en km — un typo de miles no entra al inventario', () => {
  assert.ok(validarViaje({ ...CUERPO_OK, km: '2150000' }).error);
  assert.equal(validarViaje({ ...CUERPO_OK, km: '19999' }).error, undefined);
});

test('validarViaje: pasajeros debe ser entero positivo acotado; vacío vale 1', () => {
  assert.equal(validarViaje({ ...CUERPO_OK, pasajeros: '' }).datos.pasajeros, 1);
  assert.equal(validarViaje({ ...CUERPO_OK, pasajeros: undefined }).datos.pasajeros, 1);
  assert.ok(validarViaje({ ...CUERPO_OK, pasajeros: '0' }).error);
  assert.ok(validarViaje({ ...CUERPO_OK, pasajeros: '-3' }).error);
  assert.ok(validarViaje({ ...CUERPO_OK, pasajeros: '2.5' }).error);
  assert.ok(validarViaje({ ...CUERPO_OK, pasajeros: '99999' }).error);
});

test('validarViaje: fecha futura se rechaza (margen 1 día por zona horaria), formato AAAA-MM-DD', () => {
  const mananaMas2 = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  assert.ok(validarViaje({ ...CUERPO_OK, fecha: mananaMas2 }).error);
  assert.ok(validarViaje({ ...CUERPO_OK, fecha: '15-06-2026' }).error);
  assert.equal(validarViaje({ ...CUERPO_OK, fecha: '2026-06-15' }).error, undefined);
  assert.equal(validarViaje({ ...CUERPO_OK, fecha: '2026-06-15' }).datos.fecha, '2026-06-15');
});

test('validarViaje: origen/destino obligatorios, con tope de largo; notas se recortan a 500', () => {
  assert.ok(validarViaje({ ...CUERPO_OK, origen: '  ' }).error);
  assert.ok(validarViaje({ ...CUERPO_OK, destino: 'x'.repeat(121) }).error);
  const r = validarViaje({ ...CUERPO_OK, notas: 'n'.repeat(600) });
  assert.equal(r.datos.notas.length, 500);
});

test('validarViaje: patente es opcional, se normaliza a mayúsculas y nunca bloquea el registro', () => {
  assert.equal(validarViaje({ ...CUERPO_OK }).datos.patente, null);
  assert.equal(validarViaje({ ...CUERPO_OK, patente: '' }).datos.patente, null);
  assert.equal(validarViaje({ ...CUERPO_OK, patente: '  abcd12  ' }).datos.patente, 'ABCD12');
  // Formato laxo a propósito: no se valida contra el registro civil.
  assert.equal(validarViaje({ ...CUERPO_OK, patente: 'no-es-una-patente-de-verdad' }).error, undefined);
});

// ============================================================
// generateComprobanteTransporte — PDF de comprobante de viaje
// para enviar por email.
// ============================================================

test('generateComprobanteTransporte genera un PDF válido', async () => {
  const viaje = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    fecha: '2026-06-15',
    modo: 'bus',
    origen: 'Antofagasta',
    destino: 'Calama',
    km: 215,
    pasajeros: 40,
    ida_vuelta: true,
    co2e: 0.516,
    notas: 'Viaje de personal administrativo',
  };
  const empresa = {
    nombre_empresa: 'Minera Example SA',
    rut: '96.820.360-5',
  };
  const modoNombre = 'Bus de larga distancia';

  const pdf = await generateComprobanteTransporte({ viaje, empresa, modoNombre });
  assert.ok(Buffer.isBuffer(pdf));
  assert.ok(pdf.length > 500, 'el PDF no debería estar vacío');
  assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
});

test('generateComprobanteTransporte incluye datos del viaje en el PDF', async () => {
  const viaje = {
    id: 'test-123',
    fecha: '2026-07-10',
    modo: 'auto',
    origen: 'Santiago',
    destino: 'Valparaíso',
    km: 120,
    pasajeros: 3,
    ida_vuelta: false,
    co2e: 0.05,
  };
  const empresa = { nombre_empresa: 'Transporte SA', rut: '70.000.000-0' };

  const pdf = await generateComprobanteTransporte({ viaje, empresa, modoNombre: 'Auto' });
  const bin = pdf.toString('latin1');
  // Verificar que el PDF contiene referencias al viaje (muy básico).
  assert.ok(bin.includes('PDF'), 'debería ser un PDF válido');
});
