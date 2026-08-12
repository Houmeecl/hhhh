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
  horasSinAvance, estadoAvance, textoDuracion, pasosRetrocedidos, resumenFlota,
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

// ---------- resumenFlota ----------
// `flota` tiene la forma de la respuesta de GET /api/torre/flota: cada
// camión trae (o no) `ultimo_paso: { punto_id, creado }` (torre.js:157-160).
const camion = (codigo, punto_id, horas) => ({
  codigo, ultimo_paso: punto_id ? { punto_id, creado: horasAtras(horas) } : null,
});

test('resumenFlota: array vacío da todo en 0', () => {
  assert.deepEqual(resumenFlota([], AHORA), { total: 0, en_ruta: 0, ambar: 0, rojo: 0, sin_posicion: 0 });
});

test('resumenFlota: sin ultimo_paso o con punto no reconocible cuenta como sin_posicion, sin romper el resto', () => {
  const flota = [
    camion('LM-A', null, 0),
    { codigo: 'LM-B', ultimo_paso: { punto_control: 'Báscula sin nombre', creado: horasAtras(0) } },
    camion('LM-C', 'campo-grande', 0),
  ];
  const r = resumenFlota(flota, AHORA);
  assert.equal(r.total, 3);
  assert.equal(r.sin_posicion, 2);
  assert.equal(r.en_ruta, 1);
});

test('resumenFlota: reparte en_ruta/ambar/rojo con los mismos umbrales que estadoAvance', () => {
  const flota = [
    camion('LM-OK', 'campo-grande', 0),                        // recién visto → en_ruta
    camion('LM-AMBAR', 'ponta-pora', HORAS_ALERTA_AMBAR + 1),   // > 12h → ambar
    camion('LM-ROJO', 'jujuy', HORAS_ALERTA_ROJA + 1),          // > 24h → rojo
  ];
  const r = resumenFlota(flota, AHORA);
  assert.equal(r.total, 3);
  assert.equal(r.en_ruta, 1);
  assert.equal(r.ambar, 1);
  assert.equal(r.rojo, 1);
  assert.equal(r.sin_posicion, 0);
  // total siempre es la suma de los 4 baldes.
  assert.equal(r.total, r.en_ruta + r.ambar + r.rojo + r.sin_posicion);
});

// ---------- Catálogo dinámico (setCatalogo, migración 093) ----------

test('setCatalogo: un punto agregado en runtime es reconocido por puntoDe/pasosRetrocedidos y se puede restaurar', async () => {
  const { setCatalogo, PUNTOS_CORREDOR, PUNTOS_FRONTERA, puntoDe, pasosRetrocedidos } =
    await import('../../frontend/src/lib/corredor.js');
  const respaldo = PUNTOS_CORREDOR.map((p) => ({ ...p }));
  const fronterasRespaldo = [...PUNTOS_FRONTERA];

  const conExtra = [
    ...respaldo.map((p, i) => ({ ...p, orden: i, es_frontera: fronterasRespaldo.includes(p.id) })),
    { id: 'punto-nuevo-test', nombre: 'Punto Nuevo', pais: 'CL', lat: -23.2, lng: -69.5, orden: respaldo.length, es_frontera: false },
  ];
  assert.equal(setCatalogo(conExtra), true);
  assert.equal(PUNTOS_CORREDOR.length, respaldo.length + 1);
  assert.equal(puntoDe({ datos: { punto_id: 'punto-nuevo-test' } })?.nombre, 'Punto Nuevo');
  // El punto nuevo (último del corredor) participa de la detección de retrocesos.
  const retro = pasosRetrocedidos([
    { eslabon: 1, datos: { punto_id: 'punto-nuevo-test' } },
    { eslabon: 2, datos: { punto_id: 'campo-grande' } },
  ]);
  assert.ok(retro.has(2));

  // Restaurar el estático para no contaminar otros tests.
  assert.equal(setCatalogo(respaldo.map((p, i) => ({ ...p, orden: i, es_frontera: fronterasRespaldo.includes(p.id) }))), true);
  assert.equal(PUNTOS_CORREDOR.length, respaldo.length);
  assert.deepEqual([...PUNTOS_FRONTERA].sort(), [...fronterasRespaldo].sort());
});

test('setCatalogo: entrada inválida se ignora (queda el catálogo vigente)', async () => {
  const { setCatalogo, PUNTOS_CORREDOR } = await import('../../frontend/src/lib/corredor.js');
  const n = PUNTOS_CORREDOR.length;
  assert.equal(setCatalogo([]), false);
  assert.equal(setCatalogo(null), false);
  assert.equal(setCatalogo([{ id: '', nombre: 'x', lat: 1, lng: 1 }]), false);
  assert.equal(setCatalogo([{ id: 'ok', nombre: 'x', lat: 'no-numero', lng: 1 }]), false);
  assert.equal(PUNTOS_CORREDOR.length, n);
});
