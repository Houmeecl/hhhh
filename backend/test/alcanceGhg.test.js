import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsearAlcanceGHG, agregarAlcance3, agregarPorAlcance, CATEGORIAS_ALCANCE3_GHG_PROTOCOL } from '../src/services/alcanceGhg.js';

test('parsearAlcanceGHG: Alcance 1 sin categoría', () => {
  assert.deepEqual(parsearAlcanceGHG('Alcance 1 — combustión estacionaria (gas natural)'),
    { alcance: 1, categoria: null, descripcion: 'combustión estacionaria (gas natural)' });
});

test('parsearAlcanceGHG: Alcance 2 sin categoría', () => {
  assert.deepEqual(parsearAlcanceGHG('Alcance 2 — electricidad comprada'),
    { alcance: 2, categoria: null, descripcion: 'electricidad comprada' });
});

test('parsearAlcanceGHG: Alcance 3 con categoría', () => {
  assert.deepEqual(parsearAlcanceGHG('Alcance 3 · Cat. 5 — residuos generados en la operación'),
    { alcance: 3, categoria: 5, descripcion: 'residuos generados en la operación' });
  assert.deepEqual(parsearAlcanceGHG('Alcance 3 · Cat. 4 — transporte y distribución (marítimo)'),
    { alcance: 3, categoria: 4, descripcion: 'transporte y distribución (marítimo)' });
});

test('parsearAlcanceGHG: texto sin patrón no revienta', () => {
  assert.deepEqual(parsearAlcanceGHG('texto libre sin formato'),
    { alcance: null, categoria: null, descripcion: 'texto libre sin formato' });
  assert.deepEqual(parsearAlcanceGHG(null), { alcance: null, categoria: null, descripcion: null });
  assert.deepEqual(parsearAlcanceGHG(''), { alcance: null, categoria: null, descripcion: null });
});

test('agregarAlcance3: agrupa por proveedor + categoría, suma tCO2e, cuenta documentos', () => {
  const rows = [
    { rut_proveedor: '761111111', alcance_ghg: 'Alcance 3 · Cat. 5 — residuos generados en la operación', total_co2e: 1.5, organismo: 'DEFRA (Reino Unido)', documento: 'UK Government GHG Conversion Factors', version_anio: '2024' },
    { rut_proveedor: '761111111', alcance_ghg: 'Alcance 3 · Cat. 5 — residuos generados en la operación', total_co2e: 0.5, organismo: 'DEFRA (Reino Unido)', documento: 'UK Government GHG Conversion Factors', version_anio: '2024' },
    { rut_proveedor: '762222222', alcance_ghg: 'Alcance 3 · Cat. 1 — bienes adquiridos (agua potable)', total_co2e: 3.0, organismo: 'DEFRA (Reino Unido)', documento: 'UK Government GHG Conversion Factors', version_anio: '2024' },
  ];
  const filas = agregarAlcance3(rows);
  assert.equal(filas.length, 2);
  const relleno = filas.find((f) => f.rut_proveedor === '761111111');
  assert.equal(relleno.categoria_numero, 5);
  assert.equal(relleno.categoria_nombre, CATEGORIAS_ALCANCE3_GHG_PROTOCOL[5]);
  assert.equal(relleno.n_documentos, 2);
  assert.equal(relleno.total_tco2e, 2.0);
  assert.equal(relleno.fuente_factor, 'DEFRA (Reino Unido) — UK Government GHG Conversion Factors (2024)');
});

test('agregarAlcance3: junta descripciones distintas bajo la misma categoría Scope 3, sin perder ninguna', () => {
  const rows = [
    { rut_proveedor: '761111111', alcance_ghg: 'Alcance 3 · Cat. 1 — bienes adquiridos', total_co2e: 1, organismo: null, documento: null, version_anio: null },
    { rut_proveedor: '761111111', alcance_ghg: 'Alcance 3 · Cat. 1 — bienes adquiridos (agua potable)', total_co2e: 1, organismo: null, documento: null, version_anio: null },
  ];
  const [fila] = agregarAlcance3(rows);
  assert.ok(fila.descripcion_motor.includes('bienes adquiridos'));
  assert.ok(fila.descripcion_motor.includes('bienes adquiridos (agua potable)'));
});

test('agregarAlcance3: descarta filas de Alcance 1/2 aunque lleguen por error', () => {
  const rows = [{ rut_proveedor: '761111111', alcance_ghg: 'Alcance 1 — combustión propia (referencial)', total_co2e: 5 }];
  assert.equal(agregarAlcance3(rows).length, 0);
});

test('agregarAlcance3: filas sin categoría (Cat. ausente) quedan agrupadas aparte, sin nombre', () => {
  const rows = [{ rut_proveedor: '761111111', alcance_ghg: 'Alcance 3 — sin categoría definida', total_co2e: 2 }];
  const [fila] = agregarAlcance3(rows);
  assert.equal(fila.categoria_numero, null);
  assert.equal(fila.categoria_nombre, null);
});

test('agregarAlcance3: ordena por RUT y luego por categoría', () => {
  const rows = [
    { rut_proveedor: '762222222', alcance_ghg: 'Alcance 3 · Cat. 5 — x', total_co2e: 1 },
    { rut_proveedor: '761111111', alcance_ghg: 'Alcance 3 · Cat. 9 — y', total_co2e: 1 },
    { rut_proveedor: '761111111', alcance_ghg: 'Alcance 3 · Cat. 1 — z', total_co2e: 1 },
  ];
  const filas = agregarAlcance3(rows);
  assert.deepEqual(filas.map((f) => [f.rut_proveedor, f.categoria_numero]), [
    ['761111111', 1], ['761111111', 9], ['762222222', 5],
  ]);
});

// ---------- agregarPorAlcance: desglose 1/2/3 del panel de la empresa ----------

// Filas como las que devuelve analizarPeriodo tras el JOIN al snapshot del
// motor. `categoria_origen: 'xml'` es lo que habilita la atribución de
// alcance: la categoría salió de la glosa real de los ítems del documento.
const DOCS = [
  { categoria: 'electricidad', categoria_nombre: 'Energía eléctrica', alcance_ghg: 'Alcance 2 — electricidad comprada', co2e: 1.5, categoria_origen: 'xml', motor_version_id: 7 },
  { categoria: 'combustible', categoria_nombre: 'Combustible', alcance_ghg: 'Alcance 1 — combustión propia (referencial)', co2e: 2, categoria_origen: 'xml', motor_version_id: 7 },
  { categoria: 'electricidad', categoria_nombre: 'Energía eléctrica', alcance_ghg: 'Alcance 2 — electricidad comprada', co2e: 0.5, categoria_origen: 'xml', motor_version_id: 7 },
  { categoria: 'residuos_relleno', categoria_nombre: 'Residuos a relleno', alcance_ghg: 'Alcance 3 · Cat. 5 — residuos generados', co2e: 0.25, categoria_origen: 'xml', motor_version_id: 7 },
];

test('agregarPorAlcance agrupa por alcance y suma por categoría', () => {
  const { alcances } = agregarPorAlcance(DOCS);
  assert.deepEqual(alcances.map((a) => [a.alcance, a.tco2e, a.n_documentos]), [
    [1, 2, 1], [2, 2, 2], [3, 0.25, 1],
  ]);
  const a2 = alcances.find((a) => a.alcance === 2);
  assert.equal(a2.categorias.length, 1);
  assert.equal(a2.categorias[0].codigo, 'electricidad');
  assert.equal(a2.categorias[0].tco2e, 2);
  assert.equal(a2.categorias[0].n_documentos, 2);
});

test('agregarPorAlcance nombra la categoría del GHG Protocol en Alcance 3', () => {
  const a3 = agregarPorAlcance(DOCS).alcances.find((a) => a.alcance === 3);
  assert.equal(a3.categorias[0].categoria_ghg, 5);
  assert.equal(a3.categorias[0].categoria_ghg_nombre, CATEGORIAS_ALCANCE3_GHG_PROTOCOL[5]);
});

test('un documento sin categoría cae a sin_clasificar, NUNCA a Alcance 3', () => {
  const { alcances, sin_clasificar } = agregarPorAlcance([
    ...DOCS,
    { categoria: null, categoria_nombre: null, alcance_ghg: null, co2e: 7, motor_version_id: 7 },
  ]);
  assert.equal(sin_clasificar.tco2e, 7);
  assert.equal(sin_clasificar.n_documentos, 1);
  const a3 = alcances.find((a) => a.alcance === 3);
  assert.equal(a3.tco2e, 0.25, 'lo no clasificado no se cuela en Alcance 3');
});

// EL CASO QUE MOTIVA LA COLUMNA `categoria_origen`. Los adaptadores que solo
// traen el RCV fabrican un ítem sintético cuyo nombre es la razón social de la
// contraparte, y el motor tiene 'copec' entre sus palabras clave. Sin esta
// regla, una factura DE COMPRA a COPEC quedaba contabilizada como Alcance 1 —
// emisiones DIRECTAS de la propia operación del comprador — por el puro
// nombre del emisor.
test('una categoría deducida de la razón social NO recibe alcance, aunque el motor la haya resuelto', () => {
  const { alcances, sin_clasificar } = agregarPorAlcance([
    { categoria: 'combustible', categoria_nombre: 'Combustible', alcance_ghg: 'Alcance 1 — combustión propia (referencial)', co2e: 9, categoria_origen: 'razon_social', motor_version_id: 7 },
  ]);
  assert.deepEqual(alcances, [], 'nada entra a Alcance 1 por el nombre del proveedor');
  assert.equal(sin_clasificar.inferido_por_nombre, 1);
  assert.equal(sin_clasificar.tco2e, 9, 'su CO2e sigue contando en el total del período');
});

// El catch-all del motor ('servicios') mapea a Alcance 3 · Cat. 1. Dejarlo
// pasar convertía "no pude clasificarlo" en "es cadena de valor".
test('el catch-all del motor (sin coincidencia de palabra clave) no se presenta como Alcance 3', () => {
  const { alcances, sin_clasificar } = agregarPorAlcance([
    { categoria: 'servicios', categoria_nombre: 'Servicios', alcance_ghg: 'Alcance 3 · Cat. 1 — servicios adquiridos', co2e: 4, categoria_origen: 'sin_coincidencia', motor_version_id: 7 },
  ]);
  assert.deepEqual(alcances, []);
  assert.equal(sin_clasificar.sin_coincidencia, 1);
  assert.equal(sin_clasificar.tco2e, 4);
});

test('un alcance_ghg editado a mano que no calza el patrón no revienta ni se adivina', () => {
  const { sin_clasificar } = agregarPorAlcance([
    { categoria: 'servicios', categoria_nombre: 'Servicios', alcance_ghg: 'ojo: revisar esto', co2e: 3, categoria_origen: 'xml', motor_version_id: 7 },
  ]);
  assert.equal(sin_clasificar.tco2e, 3);
  assert.equal(sin_clasificar.alcance_no_legible, 1, 'lo arregla un admin en el catálogo, no la empresa');
});

test('INVARIANTE: la suma de los alcances más lo no clasificado es el total del período', () => {
  const filas = [
    ...DOCS,
    { categoria: null, categoria_nombre: null, alcance_ghg: null, co2e: 7, motor_version_id: 7 },
    { categoria: 'servicios', categoria_nombre: 'Servicios', alcance_ghg: 'texto raro', co2e: 3, categoria_origen: 'xml', motor_version_id: 7 },
    { categoria: 'combustible', categoria_nombre: 'Combustible', alcance_ghg: 'Alcance 1 — combustión propia', co2e: 1.11111, categoria_origen: 'razon_social', motor_version_id: 7 },
  ];
  const { alcances, sin_clasificar } = agregarPorAlcance(filas);
  const total = filas.reduce((a, f) => a + Number(f.co2e || 0), 0);
  const sumado = alcances.reduce((a, x) => a + x.tco2e, 0) + sin_clasificar.tco2e;
  assert.equal(Math.round(sumado * 10000) / 10000, Math.round(total * 10000) / 10000,
    'ni se pierde ni se duplica CO2e entre el desglose y el total');
});

test('un documento sin cálculo (co2e null) no entra a ningún bucket', () => {
  const { alcances, sin_clasificar } = agregarPorAlcance([
    { categoria: null, categoria_nombre: null, alcance_ghg: null, co2e: null },
  ]);
  assert.deepEqual(alcances, []);
  assert.equal(sin_clasificar.n_documentos, 0);
});

// Cada motivo para quedar sin alcance tiene una salida distinta para quien
// lee el informe, así que se cuentan por separado: ofrecerle "vuelve a
// descargar" por un documento que el motor ya miró es una promesa falsa.
test('sin_clasificar desglosa cada motivo y los subtotales cuadran con el total', () => {
  const r = agregarPorAlcance([
    { categoria: 'electricidad', alcance_ghg: 'Alcance 2 — electricidad comprada', co2e: 4, categoria_origen: 'xml', motor_version_id: 7 },
    { categoria: null, alcance_ghg: null, co2e: 2, motor_version_id: null },  // bajado antes de la clasificación
    { categoria: null, alcance_ghg: null, co2e: 0, motor_version_id: 7 },     // nota de crédito
    { categoria: 'combustible', alcance_ghg: 'Alcance 1 — combustión propia', co2e: 5, categoria_origen: 'razon_social', motor_version_id: 7 },
    { categoria: 'servicios', alcance_ghg: 'Alcance 3 · Cat. 1 — servicios', co2e: 1, categoria_origen: 'sin_coincidencia', motor_version_id: 7 },
    { categoria: 'servicios', alcance_ghg: 'texto libre roto', co2e: 3, categoria_origen: 'xml', motor_version_id: 7 },
  ]);
  const sin = r.sin_clasificar;
  assert.equal(sin.n_documentos, 5);
  assert.equal(sin.descarga_antigua, 1);
  assert.equal(sin.motor_sin_categoria, 1);
  assert.equal(sin.inferido_por_nombre, 1);
  assert.equal(sin.sin_coincidencia, 1);
  assert.equal(sin.alcance_no_legible, 1);
  const porMotivo = sin.descarga_antigua + sin.motor_sin_categoria + sin.inferido_por_nombre
    + sin.sin_coincidencia + sin.alcance_no_legible;
  assert.equal(porMotivo, sin.n_documentos, 'todo motivo tiene que estar contado en exactamente un balde');
  assert.equal(sin.tco2e, 11);
});

// Una fila con categoría pero SIN `categoria_origen` es una descarga anterior
// a esa columna: no consta de dónde salió, así que no se le atribuye alcance.
test('una categoría sin procedencia registrada no recibe alcance', () => {
  const { alcances, sin_clasificar } = agregarPorAlcance([
    { categoria: 'electricidad', alcance_ghg: 'Alcance 2 — electricidad comprada', co2e: 6, motor_version_id: 7 },
  ]);
  assert.deepEqual(alcances, []);
  assert.equal(sin_clasificar.descarga_antigua, 1);
});
