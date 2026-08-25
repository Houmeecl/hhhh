import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  soloDatosPublicos, vigente, participantesPublicos, estadoCupos, eventosProximos,
} from '../src/services/programa.js';

// ============================================================
// La regla que ordena la portada del Programa Norte, en palabras de la
// propuesta de patrocinio:
//
//   «Sólo se presentarán como integrantes confirmados quienes hayan
//    aceptado formalmente participar.»
//
// Es una promesa a quien todavía está decidiendo. Una empresa que aparece
// antes de aceptar queda expuesta a que le pregunten por algo que no
// firmó, y el programa queda exhibiendo un respaldo que no tiene.
// ============================================================

const AHORA = new Date('2026-08-23T12:00:00Z');

// ---------- Lo que sale a la calle ----------

test('solo sale el nombre: ni RUT, ni correo, ni teléfono', () => {
  const p = soloDatosPublicos({
    nombre_empresa: 'Minera del Norte SpA',
    rut: '76.123.456-0',
    contacto_email: 'gerencia@ejemplo.cl',
    contacto_telefono: '+56 9 1234 5678',
    aporta_monetario: true,
  });
  assert.deepEqual(Object.keys(p).sort(), ['nombre', 'rol']);
  const serializado = JSON.stringify(p);
  for (const secreto of ['76.123.456-0', 'gerencia@ejemplo.cl', '+56 9 1234 5678']) {
    assert.ok(!serializado.includes(secreto), `se filtró ${secreto}`);
  }
});

test('la lista es blanca, no negra: una columna nueva no se publica sola', () => {
  // Con `delete fila.rut` bastaría con que alguien agregue una columna al
  // SELECT para publicarla sin querer. Este test fija la otra política.
  const p = soloDatosPublicos({
    nombre_empresa: 'Empresa X',
    columna_agregada_manana: 'dato sensible que nadie revisó',
  });
  assert.ok(!JSON.stringify(p).includes('dato sensible'));
});

// ---------- Quién aparece y quién no ----------

test('sin nadie aceptado la lista viene vacía', () => {
  // La portada usa esto para NO renderizar la sección. Una grilla vacía
  // titulada "Nos acompañan" es peor que no tenerla.
  assert.deepEqual(participantesPublicos([], AHORA), []);
});

test('un patrocinio dado de baja deja de mostrarse', () => {
  const filas = [{ nombre_empresa: 'Ex Patrocinador', activo: false }];
  assert.deepEqual(participantesPublicos(filas, AHORA), []);
});

test('un patrocinio vencido deja de mostrarse', () => {
  // Seguir mostrándolo afirma un vínculo que ya no existe.
  const filas = [{ nombre_empresa: 'Venció', activo: true, fecha_fin: '2026-06-30' }];
  assert.deepEqual(participantesPublicos(filas, AHORA), []);
});

test('un patrocinio que todavía no empieza no se adelanta', () => {
  const filas = [{ nombre_empresa: 'Parte en octubre', activo: true, fecha_inicio: '2026-10-01' }];
  assert.deepEqual(participantesPublicos(filas, AHORA), []);
});

test('sin fechas declaradas se considera vigente', () => {
  // Es el caso normal de un auspicio sin plazo. Tratarlo como vencido lo
  // borraría de la página sin que nadie lo haya decidido.
  assert.equal(vigente({ nombre_empresa: 'Sin plazo' }, AHORA), true);
  assert.equal(participantesPublicos([{ nombre_empresa: 'Sin plazo', activo: true }], AHORA).length, 1);
});

test('una fila sin nombre no se muestra', () => {
  assert.deepEqual(participantesPublicos([{ nombre_empresa: '   ', activo: true }], AHORA), []);
});

// ---------- Cupos ----------

test('los cupos se cuentan, no se declaran', () => {
  assert.deepEqual(estadoCupos(20, 7), { total: 20, inscritos: 7, quedan: 13, abierto: true, lleno: false });
});

test('lleno cierra el formulario y no baja de cero', () => {
  assert.equal(estadoCupos(20, 20).abierto, false);
  assert.equal(estadoCupos(20, 20).lleno, true);
  // Si por una carrera entraran 21, no se muestra "quedan -1".
  assert.equal(estadoCupos(20, 21).quedan, 0);
});

test('sin cupo declarado NO se inventa uno: queda gris, no cero', () => {
  // Misma doctrina que el semáforo del resto del producto: lo que no se
  // sabe no se pinta de un color.
  const e = estadoCupos(null, 5);
  assert.equal(e.total, null);
  assert.equal(e.quedan, null);
  assert.equal(e.abierto, true, 'sin límite declarado el formulario sigue abierto');
});

test('basura en el cupo no rompe la página', () => {
  for (const malo of [undefined, 'veinte', -3, 0, NaN]) {
    const e = estadoCupos(malo, 4);
    assert.equal(e.total, null);
    assert.equal(e.abierto, true);
  }
});

// ---------- Eventos ----------

test('solo se muestran los publicados', () => {
  const filas = [
    { titulo: 'Borrador', publicado: false, inicia_at: '2026-09-10T13:00:00Z' },
    { titulo: 'Listo', publicado: true, inicia_at: '2026-09-10T13:00:00Z' },
  ];
  assert.deepEqual(eventosProximos(filas, AHORA).map((e) => e.titulo), ['Listo']);
});

test('el corte es por hora, no por día', () => {
  // Una charla que empezó hace dos horas ya no es algo a lo que alguien
  // pueda llegar, aunque sea del mismo día.
  const filas = [
    { titulo: 'Ya pasó', publicado: true, inicia_at: '2026-08-23T10:00:00Z' },
    { titulo: 'Es después', publicado: true, inicia_at: '2026-08-23T18:00:00Z' },
  ];
  assert.deepEqual(eventosProximos(filas, AHORA).map((e) => e.titulo), ['Es después']);
});

test('vienen ordenados por fecha', () => {
  const filas = [
    { titulo: 'Octubre', publicado: true, inicia_at: '2026-10-01T13:00:00Z' },
    { titulo: 'Septiembre', publicado: true, inicia_at: '2026-09-01T13:00:00Z' },
  ];
  assert.deepEqual(eventosProximos(filas, AHORA).map((e) => e.titulo), ['Septiembre', 'Octubre']);
});

test('una fecha ilegible no cuela ni revienta', () => {
  const filas = [{ titulo: 'Rota', publicado: true, inicia_at: 'cuando sea' }];
  assert.deepEqual(eventosProximos(filas, AHORA), []);
});
