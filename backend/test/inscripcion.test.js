import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { validarInscripcion, prospectoDesdeInscripcion, INTERESES } from '../src/services/inscripcion.js';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { EN_PRODUCCION, SALTO_PROD } from './util/soloDev.js';

const BASE = {
  nombre_empresa: 'Fábrica de Prueba Ltda.',
  rut: '78.345.120-4',
  contacto_nombre: 'Ana Prueba',
  contacto_email: 'ana@fabrica-prueba.cl',
  intereses: ['carbono'],
};

test('validarInscripcion: caso feliz normaliza y acepta', () => {
  const r = validarInscripcion({ ...BASE, contacto_email: '  ANA@Fabrica-Prueba.CL ', contacto_cargo: ' Gerenta ' });
  assert.equal(r.ok, true);
  assert.equal(r.datos.contacto_email, 'ana@fabrica-prueba.cl');
  assert.equal(r.datos.contacto_cargo, 'Gerenta');
  assert.deepEqual(r.datos.intereses, ['carbono']);
});

test('validarInscripcion: rechaza RUT inválido', () => {
  const r = validarInscripcion({ ...BASE, rut: '11.111.111-9' });
  assert.equal(r.ok, false);
  assert.match(r.error, /RUT/);
});

test('validarInscripcion: rechaza sin empresa, sin contacto o correo malo', () => {
  assert.equal(validarInscripcion({ ...BASE, nombre_empresa: ' ' }).ok, false);
  assert.equal(validarInscripcion({ ...BASE, contacto_nombre: '' }).ok, false);
  assert.equal(validarInscripcion({ ...BASE, contacto_email: 'no-es-correo' }).ok, false);
});

test('validarInscripcion: exige al menos un interés y filtra claves desconocidas', () => {
  assert.equal(validarInscripcion({ ...BASE, intereses: [] }).ok, false);
  const r = validarInscripcion({ ...BASE, intereses: ['carbono', 'hackear', 'rep', 'rep'] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.datos.intereses, ['carbono', 'rep']);
  // Solo claves del catálogo cerrado
  for (const i of r.datos.intereses) assert.ok(INTERESES.includes(i));
});

test('validarInscripcion: cuerpo nulo o no-objeto no lanza', () => {
  assert.equal(validarInscripcion(null).ok, false);
  assert.equal(validarInscripcion('texto').ok, false);
});

test('prospectoDesdeInscripcion: arma el prospecto con contacto en notas', () => {
  const p = prospectoDesdeInscripcion({
    ...BASE, contacto_telefono: '+56 9 1234', mensaje: 'Hola', intereses: ['carbono', 'rep'],
  });
  assert.equal(p.etapa, 'nuevo');
  assert.equal(p.origen, 'inscripción web');
  assert.equal(p.contacto, 'Ana Prueba');
  assert.match(p.notas, /ana@fabrica-prueba\.cl/);
  assert.match(p.notas, /carbono, rep/);
  assert.match(p.notas, /Hola/);
});

// ============================================================
// Integración contra BD real: dedupe de pendientes por RUT (índice único
// parcial de la migración 064). Mismo patrón que capacitacion.test.js.
// ============================================================

after(async () => {
  if (!EN_PRODUCCION) {
    await query(`DELETE FROM solicitudes_inscripcion WHERE rut = '78.345.120-4'`);
  }
  await pool.end(); // SIEMPRE: sin esto node:test se cuelga con el pool abierto
});

test('migración 064: solo una inscripción pendiente por RUT; resuelta permite otra', { skip: SALTO_PROD }, async () => {
  await runMigrations();
  await query(`DELETE FROM solicitudes_inscripcion WHERE rut = '78.345.120-4'`);

  const ins = () => query(
    `INSERT INTO solicitudes_inscripcion (rut, nombre_empresa, contacto_nombre, contacto_email, intereses)
     VALUES ('78.345.120-4','Fábrica de Prueba Ltda.','Ana Prueba','ana@fabrica-prueba.cl','["carbono"]'::jsonb)
     ON CONFLICT (rut) WHERE estado = 'pendiente' DO NOTHING RETURNING id`
  );
  const a = await ins();
  assert.equal(a.rows.length, 1, 'la primera inserta');
  const b = await ins();
  assert.equal(b.rows.length, 0, 'la segunda pendiente con mismo RUT no duplica');

  await query(`UPDATE solicitudes_inscripcion SET estado = 'descartada' WHERE id = $1`, [a.rows[0].id]);
  const c = await ins();
  assert.equal(c.rows.length, 1, 'resuelta la anterior, el RUT puede volver a inscribirse');
});
