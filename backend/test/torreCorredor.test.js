import { test } from 'node:test';
import assert from 'node:assert/strict';

// ============================================================
// Torre de control — funciones puras de frontend/src/lib/corredor.js
// (sin dependencias, se puede importar directo desde el suite del
// backend — mismo patrón que repParidad.test.js).
//
// Alertas de avance (horasSinAvance/estadoAvance/textoDuracion) y
// detección de pasos retrocedidos: son heurísticas INFORMATIVAS — nunca
// bloquean el registro de un paso, solo colorean la torre.
// ============================================================
import {
  PUNTOS_CORREDOR, HORAS_ALERTA_AMBAR, HORAS_ALERTA_ROJA,
  horasSinAvance, estadoAvance, textoDuracion, pasosRetrocedidos,
} from '../../frontend/src/lib/corredor.js';

const AHORA = Date.parse('2026-08-11T12:00:00Z');
const horasAtras = (h) => new Date(AHORA - h * 3_600_000).toISOString();

// ---------- horasSinAvance ----------

test('horasSinAvance: null sin paso, y calcula el delta real contra "ahora" inyectado', () => {
  assert.equal(horasSinAvance(null), null);
  assert.equal(horasSinAvance(undefined), null);
  assert.equal(horasSinAvance(horasAtras(5), AHORA), 5);
  assert.equal(horasSinAvance(horasAtras(0.5), AHORA), 0.5);
});

test('horasSinAvance: un paso "en el futuro" (reloj desincronizado) no da negativo', () => {
  const futuro = new Date(AHORA + 3_600_000).toISOString();
  assert.equal(horasSinAvance(futuro, AHORA), 0);
});

// ---------- estadoAvance ----------

test('estadoAvance: null sin dato, ok/ambar/rojo según los umbrales publicados', () => {
  assert.equal(estadoAvance(null), null);
  assert.equal(estadoAvance(0), 'ok');
  assert.equal(estadoAvance(HORAS_ALERTA_AMBAR - 0.01), 'ok');
  assert.equal(estadoAvance(HORAS_ALERTA_AMBAR), 'ambar');
  assert.equal(estadoAvance(HORAS_ALERTA_ROJA - 0.01), 'ambar');
  assert.equal(estadoAvance(HORAS_ALERTA_ROJA), 'rojo');
  assert.equal(estadoAvance(200), 'rojo');
});

// ---------- textoDuracion ----------

test('textoDuracion: horas bajo 48h, días desde ahí, sin depender del idioma', () => {
  assert.equal(textoDuracion(null), '');
  assert.equal(textoDuracion(3), '3h');
  assert.equal(textoDuracion(47.6), '48h');
  assert.equal(textoDuracion(48), '2d');
  assert.equal(textoDuracion(73), '3d');
});

// ---------- pasosRetrocedidos ----------

// Catálogo real: campo-grande(0) → ponta-pora(1) → loma-plata(2) →
// mariscal-estigarribia(3) → pozo-hondo(4) → tartagal(5) → jujuy(6) →
// susques(7) → paso-de-jama(8) → san-pedro-de-atacama(9) → calama(10) →
// puerto-seco(11) → puerto-antofagasta(12) → puerto-mejillones(13).
const eslabon = (n, punto_id) => ({ eslabon: n, datos: { punto_id } });

test('pasosRetrocedidos: secuencia que avanza no marca nada', () => {
  const pasos = [eslabon(1, 'campo-grande'), eslabon(2, 'loma-plata'), eslabon(3, 'tartagal')];
  assert.deepEqual([...pasosRetrocedidos(pasos)], []);
});

test('pasosRetrocedidos: un paso que vuelve atrás en el catálogo se marca', () => {
  const pasos = [eslabon(1, 'tartagal'), eslabon(2, 'loma-plata'), eslabon(3, 'susques')];
  // loma-plata (2) < tartagal (5) ya alcanzado: eslabón 2 retrocede.
  // susques (7) > 5: no retrocede, sigue el máximo alcanzado.
  assert.deepEqual([...pasosRetrocedidos(pasos)], [2]);
});

test('pasosRetrocedidos: quedarse en el mismo punto dos veces no cuenta como retroceso', () => {
  const pasos = [eslabon(1, 'calama'), eslabon(2, 'calama'), eslabon(3, 'puerto-seco')];
  assert.deepEqual([...pasosRetrocedidos(pasos)], []);
});

test('pasosRetrocedidos: un eslabón sin punto reconocible no rompe la secuencia ni cuenta', () => {
  const pasos = [
    eslabon(1, 'susques'),
    { eslabon: 2, datos: { punto_control: 'Báscula sin nombre' } }, // no calza con el catálogo
    eslabon(3, 'paso-de-jama'), // sigue avanzando respecto a susques, no respecto al ilegible
  ];
  assert.deepEqual([...pasosRetrocedidos(pasos)], []);
});

test('pasosRetrocedidos: catálogo del corredor cubre el tramo Brasil→Chile completo (14 puntos)', () => {
  assert.equal(PUNTOS_CORREDOR.length, 14);
});
