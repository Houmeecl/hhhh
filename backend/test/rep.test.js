import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MATERIALES_REP,
  MAX_COMPONENTES,
  validarComponentes,
  calcularReciclabilidad,
} from '../src/services/rep.js';

// Componente válido de referencia para armar variaciones.
const base = { material: 'papel_carton', peso_gr: 100, cantidad: 1, reciclable: true };

// ---------- MATERIALES_REP ----------

test('MATERIALES_REP tiene los mismos 7 códigos que el frontend', () => {
  assert.deepEqual(
    MATERIALES_REP.map((m) => m.codigo),
    ['papel_carton', 'plasticos', 'vidrio', 'metales', 'madera', 'compuestos', 'otros']
  );
});

// ---------- validarComponentes ----------

test('validarComponentes rechaza array vacío o no-array', () => {
  assert.equal(validarComponentes([]).ok, false);
  assert.equal(validarComponentes(null).ok, false);
  assert.equal(validarComponentes(undefined).ok, false);
  assert.equal(validarComponentes('x').ok, false);
  assert.equal(validarComponentes({}).ok, false);
});

test('validarComponentes rechaza más de 50 componentes', () => {
  const muchos = Array.from({ length: MAX_COMPONENTES + 1 }, () => ({ ...base }));
  assert.equal(validarComponentes(muchos).ok, false);
  const justos = Array.from({ length: MAX_COMPONENTES }, () => ({ ...base }));
  assert.equal(validarComponentes(justos).ok, true);
});

test('validarComponentes rechaza material inválido', () => {
  assert.equal(validarComponentes([{ ...base, material: 'unicornio' }]).ok, false);
  assert.equal(validarComponentes([{ ...base, material: '' }]).ok, false);
  assert.equal(validarComponentes([{ ...base, material: null }]).ok, false);
  assert.equal(validarComponentes([{ ...base, material: 'PAPEL_CARTON' }]).ok, false);
});

test('validarComponentes rechaza peso negativo, cero o no numérico', () => {
  assert.equal(validarComponentes([{ ...base, peso_gr: -1 }]).ok, false);
  assert.equal(validarComponentes([{ ...base, peso_gr: 0 }]).ok, false);
  assert.equal(validarComponentes([{ ...base, peso_gr: 'mucho' }]).ok, false);
  assert.equal(validarComponentes([{ ...base, peso_gr: NaN }]).ok, false);
  assert.equal(validarComponentes([{ ...base, peso_gr: Infinity }]).ok, false);
  assert.equal(validarComponentes([{ ...base, peso_gr: true }]).ok, false);
  assert.equal(validarComponentes([{ ...base, peso_gr: 1e7 + 1 }]).ok, false); // sobre el máximo
  assert.equal(validarComponentes([{ ...base, peso_gr: 0.5 }]).ok, true);      // decimal positivo ok
});

test('validarComponentes rechaza cantidad decimal, cero o inválida', () => {
  assert.equal(validarComponentes([{ ...base, cantidad: 1.5 }]).ok, false);
  assert.equal(validarComponentes([{ ...base, cantidad: 0 }]).ok, false);
  assert.equal(validarComponentes([{ ...base, cantidad: -2 }]).ok, false);
  assert.equal(validarComponentes([{ ...base, cantidad: 'dos' }]).ok, false);
  assert.equal(validarComponentes([{ ...base, cantidad: true }]).ok, false);
  assert.equal(validarComponentes([{ ...base, cantidad: 1e6 + 1 }]).ok, false); // sobre el máximo
});

test('validarComponentes exige reciclable boolean estricto', () => {
  assert.equal(validarComponentes([{ ...base, reciclable: 'si' }]).ok, false);
  assert.equal(validarComponentes([{ ...base, reciclable: 1 }]).ok, false);
  assert.equal(validarComponentes([{ ...base, reciclable: undefined }]).ok, false);
  assert.equal(validarComponentes([{ ...base, reciclable: false }]).ok, true);
});

test('validarComponentes rechaza entradas que no son objetos', () => {
  assert.equal(validarComponentes([null]).ok, false);
  assert.equal(validarComponentes(['papel']).ok, false);
  assert.equal(validarComponentes([[]]).ok, false);
});

test('validarComponentes acepta una declaración válida y no entrega error', () => {
  const r = validarComponentes([
    { material: 'papel_carton', peso_gr: 250, cantidad: 2, reciclable: true },
    { material: 'plasticos', peso_gr: 30.5, cantidad: 10, reciclable: false },
    { material: 'otros', peso_gr: 5, cantidad: 1, reciclable: true },
  ]);
  assert.deepEqual(r, { ok: true });
});

test('validarComponentes entrega mensajes en español con el número del componente', () => {
  const r = validarComponentes([base, { ...base, material: 'chatarra' }]);
  assert.equal(r.ok, false);
  assert.match(r.error, /Componente 2/);
});

// ---------- calcularReciclabilidad ----------
// Misma fórmula y umbrales que frontend/src/lib/rep.js.

test('100% reciclable → Alto', () => {
  const r = calcularReciclabilidad([
    { material: 'vidrio', peso_gr: 100, cantidad: 3, reciclable: true },
  ]);
  assert.equal(r.peso_total_gr, 300);
  assert.equal(r.peso_reciclable_gr, 300);
  assert.equal(r.porcentaje, 100);
  assert.equal(r.nivel, 'Alto');
});

test('50% reciclable → Medio (umbral exacto de 50)', () => {
  const r = calcularReciclabilidad([
    { material: 'vidrio', peso_gr: 100, cantidad: 1, reciclable: true },
    { material: 'otros', peso_gr: 100, cantidad: 1, reciclable: false },
  ]);
  assert.equal(r.porcentaje, 50);
  assert.equal(r.nivel, 'Medio');
});

test('30% reciclable → Bajo', () => {
  const r = calcularReciclabilidad([
    { material: 'metales', peso_gr: 30, cantidad: 1, reciclable: true },
    { material: 'compuestos', peso_gr: 70, cantidad: 1, reciclable: false },
  ]);
  assert.equal(r.porcentaje, 30);
  assert.equal(r.nivel, 'Bajo');
});

test('umbral exacto 70 → Alto y 69.9 → Medio', () => {
  const exacto = calcularReciclabilidad([
    { material: 'papel_carton', peso_gr: 70, cantidad: 1, reciclable: true },
    { material: 'otros', peso_gr: 30, cantidad: 1, reciclable: false },
  ]);
  assert.equal(exacto.porcentaje, 70);
  assert.equal(exacto.nivel, 'Alto');

  const bajo70 = calcularReciclabilidad([
    { material: 'papel_carton', peso_gr: 699, cantidad: 1, reciclable: true },
    { material: 'otros', peso_gr: 301, cantidad: 1, reciclable: false },
  ]);
  assert.equal(bajo70.porcentaje, 69.9);
  assert.equal(bajo70.nivel, 'Medio');
});

test('umbral 49.9 → Bajo (justo bajo el 50)', () => {
  const r = calcularReciclabilidad([
    { material: 'plasticos', peso_gr: 499, cantidad: 1, reciclable: true },
    { material: 'otros', peso_gr: 501, cantidad: 1, reciclable: false },
  ]);
  assert.equal(r.porcentaje, 49.9);
  assert.equal(r.nivel, 'Bajo');
});

test('redondeo a 1 decimal (1/3 → 33.3, 2/3 → 66.7)', () => {
  const tercio = calcularReciclabilidad([
    { material: 'vidrio', peso_gr: 1, cantidad: 1, reciclable: true },
    { material: 'otros', peso_gr: 2, cantidad: 1, reciclable: false },
  ]);
  assert.equal(tercio.porcentaje, 33.3);

  const dosTercios = calcularReciclabilidad([
    { material: 'vidrio', peso_gr: 2, cantidad: 1, reciclable: true },
    { material: 'otros', peso_gr: 1, cantidad: 1, reciclable: false },
  ]);
  assert.equal(dosTercios.porcentaje, 66.7);
});

test('el peso pondera por cantidad (peso_gr es unitario)', () => {
  const r = calcularReciclabilidad([
    { material: 'papel_carton', peso_gr: 10, cantidad: 9, reciclable: true },
    { material: 'plasticos', peso_gr: 10, cantidad: 1, reciclable: false },
  ]);
  assert.equal(r.peso_total_gr, 100);
  assert.equal(r.peso_reciclable_gr, 90);
  assert.equal(r.porcentaje, 90);
  assert.equal(r.nivel, 'Alto');
});

test('cantidad vacía/ausente se asume 1 (paridad con el frontend)', () => {
  const r = calcularReciclabilidad([
    { material: 'vidrio', peso_gr: 100, reciclable: true },
    { material: 'otros', peso_gr: 100, cantidad: '', reciclable: false },
    { material: 'otros', peso_gr: 100, cantidad: null, reciclable: false },
  ]);
  assert.equal(r.peso_total_gr, 300);
  assert.equal(r.porcentaje, 33.3);
});

test('sin componentes (o peso total 0) → nivel null (paridad con el frontend)', () => {
  assert.deepEqual(calcularReciclabilidad([]), {
    peso_total_gr: 0, peso_reciclable_gr: 0, porcentaje: 0, nivel: null,
  });
  assert.deepEqual(calcularReciclabilidad(null), {
    peso_total_gr: 0, peso_reciclable_gr: 0, porcentaje: 0, nivel: null,
  });
  const r = calcularReciclabilidad([{ material: 'vidrio', peso_gr: 0, cantidad: 5, reciclable: true }]);
  assert.equal(r.nivel, null);
});
