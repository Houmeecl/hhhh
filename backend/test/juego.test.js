import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
  PUNTOS_POR_DOCUMENTO,
  calcularPuntosPorFactura,
  nivelDePuntos,
  calcularPuntosTrayecto,
  generarSerialCanje,
  hashCanje,
  otorgarPuntos,
  evaluarMisionesContador,
  impactoDeJugador,
} from '../src/services/juego.js';
import { query, withTx } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { SALTO_PROD } from './util/soloDev.js';

// ---------- calcularPuntosPorFactura ----------

test('calcularPuntosPorFactura devuelve el puntaje fijo por documento', () => {
  assert.equal(calcularPuntosPorFactura(), PUNTOS_POR_DOCUMENTO);
  assert.equal(calcularPuntosPorFactura({ motor: 'propio_ia' }), PUNTOS_POR_DOCUMENTO);
});

// ---------- nivelDePuntos ----------

test('nivelDePuntos: 0 puntos es nivel 1', () => {
  const r = nivelDePuntos(0);
  assert.equal(r.nivel, 1);
  assert.equal(r.umbralActual, 0);
  assert.equal(r.umbralSiguiente, 100);
  assert.equal(r.puntosParaSiguiente, 100);
});

test('nivelDePuntos: justo en el umbral sube de nivel', () => {
  assert.equal(nivelDePuntos(99).nivel, 1);
  assert.equal(nivelDePuntos(100).nivel, 2);
});

test('nivelDePuntos: nivel máximo no tiene umbral siguiente', () => {
  const r = nivelDePuntos(5000);
  assert.equal(r.nivel, 5);
  assert.equal(r.umbralSiguiente, null);
  assert.equal(r.puntosParaSiguiente, 0);
});

test('nivelDePuntos: puntos negativos o no numéricos no lanzan (tratan como 0)', () => {
  assert.equal(nivelDePuntos(-50).nivel, 1);
  assert.equal(nivelDePuntos(undefined).nivel, 1);
  assert.equal(nivelDePuntos(null).nivel, 1);
});

// ---------- calcularPuntosTrayecto ----------

test('calcularPuntosTrayecto: sin llegada_at no puntúa (trayecto abierto)', () => {
  assert.equal(calcularPuntosTrayecto({ modoTransporte: 'bicicleta', salidaAt: new Date(), llegadaAt: null }), 0);
});

test('calcularPuntosTrayecto: bonus por modo de bajo carbono', () => {
  const base = { salidaAt: new Date(), llegadaAt: new Date() };
  assert.equal(calcularPuntosTrayecto({ ...base, modoTransporte: 'caminando' }), 30);
  assert.equal(calcularPuntosTrayecto({ ...base, modoTransporte: 'bicicleta' }), 30);
  assert.equal(calcularPuntosTrayecto({ ...base, modoTransporte: 'transporte_publico' }), 20);
  assert.equal(calcularPuntosTrayecto({ ...base, modoTransporte: 'auto' }), 10);
  assert.equal(calcularPuntosTrayecto({ ...base, modoTransporte: 'moto' }), 10);
  assert.equal(calcularPuntosTrayecto({ ...base, modoTransporte: 'otro' }), 10);
});

test('calcularPuntosTrayecto: modo desconocido no lanza, solo el puntaje base', () => {
  assert.equal(calcularPuntosTrayecto({ modoTransporte: 'teletransporte', salidaAt: new Date(), llegadaAt: new Date() }), 10);
});

// ---------- generarSerialCanje / hashCanje ----------

test('generarSerialCanje produce el formato SUMA-XXXXXX (6 hex mayúsculas)', () => {
  for (let i = 0; i < 30; i++) {
    assert.match(generarSerialCanje(), /^SUMA-[0-9A-F]{6}$/);
  }
});

test('hashCanje es determinista para los mismos datos', () => {
  const datos = { serial: 'SUMA-ABC123', jugador_id: 'j1', recompensa_codigo: 'insignia_nivel_2', puntos_gastados: 100, emitida_at: '2026-08-08T12:00:00.000Z' };
  assert.equal(hashCanje(datos), hashCanje({ ...datos }));
});

test('hashCanje cambia si cambia cualquier campo', () => {
  const base = { serial: 'SUMA-ABC123', jugador_id: 'j1', recompensa_codigo: 'insignia_nivel_2', puntos_gastados: 100, emitida_at: '2026-08-08T12:00:00.000Z' };
  const h = hashCanje(base);
  assert.notEqual(hashCanje({ ...base, puntos_gastados: 101 }), h);
  assert.notEqual(hashCanje({ ...base, serial: 'SUMA-ZZZ999' }), h);
});

// ---------- otorgarPuntos / evaluarMisionesContador (con BD) ----------

async function crearJugadorDePrueba() {
  const sufijo = crypto.randomBytes(4).toString('hex');
  const { rows: cod } = await query(
    `INSERT INTO codigos_acceso (codigo, creditos, empresa, modo_juego) VALUES ($1, 100, $2, true) RETURNING id`,
    [`SUMA-TEST-${sufijo}`, `Empresa Test ${sufijo}`]
  );
  const { rows: jug } = await query(
    `INSERT INTO jugadores (email, codigo_id, empresa) VALUES ($1, $2, $3) RETURNING id`,
    [`jugador-${sufijo}@ejemplo.cl`, cod[0].id, `Empresa Test ${sufijo}`]
  );
  return jug[0].id;
}

test('otorgarPuntos suma a jugadores.puntos_totales, deja constancia en puntos_eventos y devuelve la fila insertada', { skip: SALTO_PROD }, async () => {
  const jugadorId = await crearJugadorDePrueba();
  let evento;
  await withTx(async (client) => {
    evento = await otorgarPuntos(client, { jugadorId, tipo: 'documento_escaneado', puntos: 10 });
  });
  const { rows } = await query(`SELECT puntos_totales FROM jugadores WHERE id = $1`, [jugadorId]);
  assert.equal(rows[0].puntos_totales, 10);
  const { rows: eventos } = await query(`SELECT tipo, puntos FROM puntos_eventos WHERE jugador_id = $1`, [jugadorId]);
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].tipo, 'documento_escaneado');
  assert.equal(eventos[0].puntos, 10);
  assert.equal(evento.jugador_id, jugadorId);
  assert.equal(evento.tipo, 'documento_escaneado');
  assert.equal(evento.puntos, 10);
});

test('otorgarPuntos con 0 puntos no inserta evento ni suma, y devuelve null', { skip: SALTO_PROD }, async () => {
  const jugadorId = await crearJugadorDePrueba();
  let evento;
  await withTx(async (client) => {
    evento = await otorgarPuntos(client, { jugadorId, tipo: 'trayecto_registrado', puntos: 0 });
  });
  const { rows } = await query(`SELECT puntos_totales FROM jugadores WHERE id = $1`, [jugadorId]);
  assert.equal(rows[0].puntos_totales, 0);
  const { rows: eventos } = await query(`SELECT * FROM puntos_eventos WHERE jugador_id = $1`, [jugadorId]);
  assert.equal(eventos.length, 0);
  assert.equal(evento, null);
});

test('evaluarMisionesContador completa la misión al alcanzar la meta, otorga sus puntos una sola vez y devuelve el evento', { skip: SALTO_PROD }, async () => {
  const jugadorId = await crearJugadorDePrueba();
  // Misión sembrada 'primeros_5': contar_documentos, meta 5, recompensa 50.
  const eventosPorRonda = [];
  for (let i = 0; i < 5; i++) {
    await withTx(async (client) => {
      eventosPorRonda.push(await evaluarMisionesContador(client, { jugadorId, tipoMision: 'contar_documentos', incremento: 1 }));
    });
  }
  const { rows: progreso } = await query(
    `SELECT mp.progreso, mp.completada_at FROM misiones_progreso mp
     JOIN misiones m ON m.id = mp.mision_id WHERE mp.jugador_id = $1 AND m.codigo = 'primeros_5'`,
    [jugadorId]
  );
  assert.equal(progreso[0].progreso, 5);
  assert.ok(progreso[0].completada_at);

  const { rows: jugador } = await query(`SELECT puntos_totales FROM jugadores WHERE id = $1`, [jugadorId]);
  assert.equal(jugador[0].puntos_totales, 50);

  // Las primeras 4 rondas no completan la misión: array vacío. La quinta
  // (la que cruza la meta) devuelve el evento 'mision_completada' de 50 puntos.
  for (let i = 0; i < 4; i++) assert.deepEqual(eventosPorRonda[i], []);
  assert.equal(eventosPorRonda[4].length, 1);
  assert.equal(eventosPorRonda[4][0].tipo, 'mision_completada');
  assert.equal(eventosPorRonda[4][0].puntos, 50);

  // Un sexto documento no debe volver a otorgar los 50 puntos de la misión,
  // ni devolver un evento (ya está completada).
  let eventosSexto;
  await withTx(async (client) => {
    eventosSexto = await evaluarMisionesContador(client, { jugadorId, tipoMision: 'contar_documentos', incremento: 1 });
  });
  assert.deepEqual(eventosSexto, []);
  const { rows: jugadorDespues } = await query(`SELECT puntos_totales FROM jugadores WHERE id = $1`, [jugadorId]);
  assert.equal(jugadorDespues[0].puntos_totales, 50);
});

// ---------- impactoDeJugador (con BD) ----------

test('impactoDeJugador: sin eventos devuelve ceros', { skip: SALTO_PROD }, async () => {
  const jugadorId = await crearJugadorDePrueba();
  const r = await impactoDeJugador(jugadorId);
  assert.deepEqual(r, { documentos: 0, co2e_total: 0 });
});

test('impactoDeJugador: suma el total_co2e de las facturas ligadas a sus eventos "documento_escaneado"', { skip: SALTO_PROD }, async () => {
  const jugadorId = await crearJugadorDePrueba();
  const { rows: [sesion] } = await query(
    `INSERT INTO sesiones (rut_cliente, nombre_cliente) VALUES ('11.111.111-1', 'Empresa Impacto') RETURNING id`
  );
  const { rows: facturas } = await query(
    `INSERT INTO facturas (sesion_id, total_co2e) VALUES ($1, 1.5), ($1, 2.25) RETURNING id`,
    [sesion.id]
  );
  await withTx(async (client) => {
    await otorgarPuntos(client, { jugadorId, tipo: 'documento_escaneado', puntos: 10, facturaId: facturas[0].id });
    await otorgarPuntos(client, { jugadorId, tipo: 'documento_escaneado', puntos: 10, facturaId: facturas[1].id });
    // Un evento de otro tipo (misión completada) no debe sumar CO2e aunque
    // traiga un factura_id — solo cuenta lo que el jugador escaneó.
    await otorgarPuntos(client, { jugadorId, tipo: 'mision_completada', puntos: 50, facturaId: facturas[0].id });
  });
  const r = await impactoDeJugador(jugadorId);
  assert.equal(r.documentos, 2);
  assert.equal(r.co2e_total, 3.75);
});

test('impactoDeJugador: nunca mezcla el CO2e de otro jugador', { skip: SALTO_PROD }, async () => {
  const jugadorA = await crearJugadorDePrueba();
  const jugadorB = await crearJugadorDePrueba();
  const { rows: [sesion] } = await query(
    `INSERT INTO sesiones (rut_cliente, nombre_cliente) VALUES ('22.222.222-2', 'Empresa Impacto B') RETURNING id`
  );
  const { rows: [factura] } = await query(
    `INSERT INTO facturas (sesion_id, total_co2e) VALUES ($1, 9.9) RETURNING id`,
    [sesion.id]
  );
  await withTx(async (client) => {
    await otorgarPuntos(client, { jugadorId: jugadorA, tipo: 'documento_escaneado', puntos: 10, facturaId: factura.id });
  });
  const impactoB = await impactoDeJugador(jugadorB);
  assert.deepEqual(impactoB, { documentos: 0, co2e_total: 0 });
});

test('runMigrations es idempotente: correrla otra vez no duplica misiones/recompensas de Sube y Suma', { skip: SALTO_PROD }, async () => {
  const contar = async (tabla) => (await query(`SELECT count(*)::int AS n FROM ${tabla}`)).rows[0].n;
  const antes = { misiones: await contar('misiones'), recompensas: await contar('recompensas') };
  await assert.doesNotReject(runMigrations());
  const despues = { misiones: await contar('misiones'), recompensas: await contar('recompensas') };
  assert.deepEqual(despues, antes);
});
