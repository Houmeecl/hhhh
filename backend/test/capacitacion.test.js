import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTA_APROBACION,
  calcularPuntaje,
  generarSerialConstancia,
  hashConstancia,
} from '../src/services/capacitacion.js';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';

const PREGUNTAS = [
  { id: 'p1', opciones: [{ id: 'p1a', correcta: true }, { id: 'p1b', correcta: false }] },
  { id: 'p2', opciones: [{ id: 'p2a', correcta: false }, { id: 'p2b', correcta: true }] },
  { id: 'p3', opciones: [{ id: 'p3a', correcta: true }, { id: 'p3b', correcta: false }] },
  { id: 'p4', opciones: [{ id: 'p4a', correcta: true }, { id: 'p4b', correcta: false }] },
  { id: 'p5', opciones: [{ id: 'p5a', correcta: false }, { id: 'p5b', correcta: true }] },
];

test('calcularPuntaje: 100% con todas las respuestas correctas', () => {
  const respuestas = [
    { pregunta_id: 'p1', opcion_id: 'p1a' },
    { pregunta_id: 'p2', opcion_id: 'p2b' },
    { pregunta_id: 'p3', opcion_id: 'p3a' },
    { pregunta_id: 'p4', opcion_id: 'p4a' },
    { pregunta_id: 'p5', opcion_id: 'p5b' },
  ];
  const r = calcularPuntaje(PREGUNTAS, respuestas);
  assert.equal(r.puntaje_pct, 100);
  assert.equal(r.aprobado, true);
  assert.equal(r.n_correctas, 5);
  assert.equal(r.n_preguntas, 5);
});

test('calcularPuntaje: 0% con todas las respuestas incorrectas', () => {
  const respuestas = [
    { pregunta_id: 'p1', opcion_id: 'p1b' },
    { pregunta_id: 'p2', opcion_id: 'p2a' },
    { pregunta_id: 'p3', opcion_id: 'p3b' },
    { pregunta_id: 'p4', opcion_id: 'p4b' },
    { pregunta_id: 'p5', opcion_id: 'p5a' },
  ];
  const r = calcularPuntaje(PREGUNTAS, respuestas);
  assert.equal(r.puntaje_pct, 0);
  assert.equal(r.aprobado, false);
  assert.equal(r.n_correctas, 0);
});

test('calcularPuntaje: exactamente en el umbral de aprobación (70%) aprueba', () => {
  // 4 de 5 preguntas... no da 70% exacto con 5 preguntas (80% o 60%), así
  // que se prueba con 10 preguntas para poder aterrizar en 70% exacto.
  const preguntas10 = Array.from({ length: 10 }, (_, i) => ({
    id: `q${i}`,
    opciones: [{ id: `q${i}-si`, correcta: true }, { id: `q${i}-no`, correcta: false }],
  }));
  const respuestas = preguntas10.map((p, i) => ({
    pregunta_id: p.id,
    opcion_id: i < 7 ? `${p.id}-si` : `${p.id}-no`,
  }));
  const r = calcularPuntaje(preguntas10, respuestas);
  assert.equal(r.puntaje_pct, 70);
  assert.equal(NOTA_APROBACION, 0.7);
  assert.equal(r.aprobado, true, 'exactamente en el umbral debe aprobar (≥, no >)');
});

test('calcularPuntaje: justo bajo el umbral (60%) no aprueba', () => {
  const respuestas = [
    { pregunta_id: 'p1', opcion_id: 'p1a' },
    { pregunta_id: 'p2', opcion_id: 'p2b' },
    { pregunta_id: 'p3', opcion_id: 'p3a' },
    { pregunta_id: 'p4', opcion_id: 'p4b' }, // incorrecta
    { pregunta_id: 'p5', opcion_id: 'p5a' }, // incorrecta
  ];
  const r = calcularPuntaje(PREGUNTAS, respuestas);
  assert.equal(r.puntaje_pct, 60);
  assert.equal(r.aprobado, false);
});

test('calcularPuntaje: preguntas sin responder cuentan como incorrectas, sin lanzar error', () => {
  const r = calcularPuntaje(PREGUNTAS, [{ pregunta_id: 'p1', opcion_id: 'p1a' }]);
  assert.equal(r.n_correctas, 1);
  assert.equal(r.n_preguntas, 5);
  assert.equal(r.aprobado, false);
});

test('calcularPuntaje: banco de preguntas vacío no aprueba y no divide por cero', () => {
  const r = calcularPuntaje([], []);
  assert.equal(r.puntaje_pct, 0);
  assert.equal(r.aprobado, false);
  assert.equal(r.n_preguntas, 0);
});

test('generarSerialConstancia: formato CAP-XXXXXX (6 hex mayúsculas)', () => {
  const serial = generarSerialConstancia();
  assert.match(serial, /^CAP-[0-9A-F]{6}$/);
});

test('generarSerialConstancia: no determinista (dos llamadas no chocan en la práctica)', () => {
  const a = generarSerialConstancia();
  const b = generarSerialConstancia();
  assert.notEqual(a, b);
});

test('hashConstancia: determinista (mismos datos → mismo hash)', () => {
  const datos = { serial: 'CAP-ABC123', usuario_nombre: 'Ana', curso_titulo: 'Curso X', puntaje_pct: 100, emitida_at: '2026-01-01T00:00:00.000Z' };
  assert.equal(hashConstancia(datos), hashConstancia({ ...datos }));
});

test('hashConstancia: sensible a cada campo', () => {
  const base = { serial: 'CAP-ABC123', usuario_nombre: 'Ana', curso_titulo: 'Curso X', puntaje_pct: 100, emitida_at: '2026-01-01T00:00:00.000Z' };
  assert.notEqual(hashConstancia(base), hashConstancia({ ...base, puntaje_pct: 90 }));
  assert.notEqual(hashConstancia(base), hashConstancia({ ...base, usuario_nombre: 'Otro' }));
  assert.notEqual(hashConstancia(base), hashConstancia({ ...base, serial: 'CAP-ZZZ999' }));
});

// ============================================================
// Integración contra BD real (migración 063 — Instituto sicr3p): confirma
// que el catálogo público queda bien segmentado (es_publico) y que correr
// la migración dos veces no duplica filas. Mismo patrón que
// proveedor.test.js/trazador.test.js.
// ============================================================

after(async () => {
  await pool.end();
});

test('migración 063: panel-mostrador queda interno, los demás publicables', async () => {
  await runMigrations();
  const { rows } = await query('SELECT slug, es_publico FROM cursos ORDER BY orden');
  const porSlug = Object.fromEntries(rows.map((r) => [r.slug, r.es_publico]));
  assert.equal(porSlug['panel-mostrador'], false);
  assert.equal(porSlug['fundamentos-rep'], true);
  assert.equal(porSlug['contabilidad-carbono'], true);
  assert.equal(porSlug['captura-documental-agencias'], true);
  assert.equal(porSlug['apl-en-simple'], true, 'el curso APL (066) es público');
});

test('migraciones 063/066: contenido sembrado completo (5 lecciones + 5 preguntas × 4 opciones por curso nuevo)', async () => {
  for (const slug of ['contabilidad-carbono', 'captura-documental-agencias', 'apl-en-simple']) {
    const { rows: cRows } = await query('SELECT id FROM cursos WHERE slug = $1', [slug]);
    assert.ok(cRows[0], `curso ${slug} debe existir`);
    const cursoId = cRows[0].id;
    const { rows: lRows } = await query('SELECT count(*)::int AS n FROM lecciones WHERE curso_id = $1', [cursoId]);
    assert.equal(lRows[0].n, 5, `${slug} debe tener 5 lecciones`);
    const { rows: pRows } = await query('SELECT count(*)::int AS n FROM preguntas WHERE curso_id = $1', [cursoId]);
    assert.equal(pRows[0].n, 5, `${slug} debe tener 5 preguntas`);
    const { rows: oRows } = await query(
      `SELECT count(*)::int AS n FROM opciones o JOIN preguntas p ON p.id = o.pregunta_id WHERE p.curso_id = $1`,
      [cursoId]
    );
    assert.equal(oRows[0].n, 20, `${slug} debe tener 20 opciones (5 preguntas × 4)`);
  }
});

test('runMigrations es idempotente: correrla otra vez no duplica cursos/lecciones/preguntas/opciones', async () => {
  const contar = async (tabla) => (await query(`SELECT count(*)::int AS n FROM ${tabla}`)).rows[0].n;
  const antes = {
    cursos: await contar('cursos'), lecciones: await contar('lecciones'),
    preguntas: await contar('preguntas'), opciones: await contar('opciones'),
  };
  await assert.doesNotReject(runMigrations());
  const despues = {
    cursos: await contar('cursos'), lecciones: await contar('lecciones'),
    preguntas: await contar('preguntas'), opciones: await contar('opciones'),
  };
  assert.deepEqual(despues, antes);
});
