import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { config } from '../src/config.js';
import { query, pool, withTx } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import {
  calcularPuntosReciclaje, distanciaHaversineM, coordenadasValidas,
  otorgarPuntos, evaluarMisionesContador, impactoDeJugador,
  PUNTOS_POR_ENVASE, TOPE_ENVASES_POR_REGISTRO,
} from '../src/services/juego.js';
import { analisisIA, validarRespuestaEnvases, presupuestoIA } from '../src/services/analisisIA.js';
import { EN_PRODUCCION, SALTO_PROD } from './util/soloDev.js';

// ============================================================
// "Reciclaje en punto limpio" (Sube y Suma): helpers puros de puntaje y
// distancia, validador de la respuesta de visión, y el camino de visión
// contarEnvases() con un fetcher falso — la API real de Anthropic nunca
// se toca (mismo criterio que analisisIA.test.js / baseapiSii.test.js).
// ============================================================

const originalIA = { ...config.analisisIA };

after(async () => {
  Object.assign(config.analisisIA, originalIA);
  presupuestoIA.reiniciar();
  if (!EN_PRODUCCION) {
    await query(`DELETE FROM analisis_ia_uso WHERE modelo = $1`, ['modelo-de-prueba-envases']).catch(() => {});
  }
  await pool.end().catch(() => {});
});

// ---------- calcularPuntosReciclaje (pura) ----------

test('calcularPuntosReciclaje: suma por material y puntúa por envase', () => {
  const r = calcularPuntosReciclaje([
    { material: 'pet', cantidad: 3 },
    { material: 'lata', cantidad: 2 },
  ]);
  assert.equal(r.totalEnvases, 5);
  assert.equal(r.puntos, 5 * PUNTOS_POR_ENVASE);
  assert.deepEqual(r.envases, [{ material: 'pet', cantidad: 3 }, { material: 'lata', cantidad: 2 }]);
});

test('calcularPuntosReciclaje: "otro" no puntúa y las cantidades inválidas se descartan', () => {
  const r = calcularPuntosReciclaje([
    { material: 'otro', cantidad: 10 },
    { material: 'vidrio', cantidad: -2 },
    { material: 'pet', cantidad: 'tres' },
    { material: 'tetra', cantidad: 1.9 },      // se trunca a 1
    { material: 'inventado', cantidad: 5 },
  ]);
  assert.equal(r.totalEnvases, 1);
  assert.equal(r.puntos, PUNTOS_POR_ENVASE);
});

test('calcularPuntosReciclaje: aplica el tope por registro pero informa el total real', () => {
  const r = calcularPuntosReciclaje([{ material: 'pet', cantidad: 100 }]);
  assert.equal(r.totalEnvases, 100);
  assert.equal(r.puntos, TOPE_ENVASES_POR_REGISTRO * PUNTOS_POR_ENVASE);
});

test('calcularPuntosReciclaje: vacío o no-array devuelve ceros', () => {
  assert.deepEqual(calcularPuntosReciclaje([]), { envases: [], totalEnvases: 0, puntos: 0 });
  assert.deepEqual(calcularPuntosReciclaje(null), { envases: [], totalEnvases: 0, puntos: 0 });
});

// ---------- distanciaHaversineM / coordenadasValidas (puras) ----------

test('distanciaHaversineM: mismo punto es 0 y pares conocidos dan lo esperado', () => {
  assert.equal(distanciaHaversineM(-33.45, -70.66, -33.45, -70.66), 0);
  // Plaza de Armas de Santiago → cumbre del Cerro San Cristóbal ≈ 2,2 km.
  const d = distanciaHaversineM(-33.4372, -70.6506, -33.4253, -70.6310);
  assert.ok(d > 2000 && d < 3000, `distancia fuera de rango: ${d}`);
  // Un grado de latitud ≈ 111 km.
  const grado = distanciaHaversineM(0, 0, 1, 0);
  assert.ok(Math.abs(grado - 111195) < 200, `grado de latitud fuera de rango: ${grado}`);
});

test('coordenadasValidas: rangos y no-números', () => {
  assert.equal(coordenadasValidas(-33.45, -70.66), true);
  assert.equal(coordenadasValidas('-33.45', '-70.66'), true); // vienen como string del form
  assert.equal(coordenadasValidas(91, 0), false);
  assert.equal(coordenadasValidas(0, 181), false);
  assert.equal(coordenadasValidas(null, null), false);
  assert.equal(coordenadasValidas('x', 'y'), false);
  assert.equal(coordenadasValidas(undefined, undefined), false);
});

// ---------- validarRespuestaEnvases (pura) ----------

test('validarRespuestaEnvases: acepta una respuesta bien formada', () => {
  const r = validarRespuestaEnvases({
    foto_valida: true,
    envases: [{ material: 'pet', cantidad: 3 }, { material: 'lata', cantidad: 0 }],
  });
  assert.equal(r.fotoValida, true);
  assert.deepEqual(r.envases, [{ material: 'pet', cantidad: 3 }]); // cantidad 0 no aporta
});

test('validarRespuestaEnvases: rechaza esquemas inválidos', () => {
  assert.equal(validarRespuestaEnvases(null), null);
  assert.equal(validarRespuestaEnvases({ foto_valida: 'si', envases: [] }), null);
  assert.equal(validarRespuestaEnvases({ foto_valida: true }), null);
});

test('validarRespuestaEnvases: descarta materiales fuera del enum y cantidades no enteras/negativas', () => {
  const r = validarRespuestaEnvases({
    foto_valida: true,
    envases: [
      { material: 'plutonio', cantidad: 2 },
      { material: 'vidrio', cantidad: 2.5 },
      { material: 'lata', cantidad: -1 },
      { material: 'tetra', cantidad: 4 },
    ],
  });
  assert.deepEqual(r.envases, [{ material: 'tetra', cantidad: 4 }]);
});

// ---------- contarEnvases (visión, con fetcher falso) ----------

function respuestaAnthropic(input) {
  return {
    ok: true,
    json: async () => ({
      content: [{ type: 'tool_use', name: 'extraer_envases', input }],
      usage: { input_tokens: 1600, output_tokens: 60 },
    }),
  };
}

function habilitarIAdePrueba() {
  config.analisisIA.enabled = true;
  config.analisisIA.apiKey = 'clave-de-prueba';
  config.analisisIA.modelo = 'modelo-de-prueba-envases';
  config.analisisIA.presupuestoDiarioClp = 100000;
  presupuestoIA.reiniciar();
}

const IMG = Buffer.from('foto-falsa').toString('base64');

test('contarEnvases: arma la llamada de visión (bloque image + herramienta extraer_envases) y devuelve el conteo', { skip: SALTO_PROD }, async () => {
  habilitarIAdePrueba();
  const capturas = [];
  const fetcher = async (url, opts) => { capturas.push(JSON.parse(opts.body)); return respuestaAnthropic({ foto_valida: true, envases: [{ material: 'pet', cantidad: 4 }] }); };
  const r = await analisisIA.contarEnvases({ imagenBase64: IMG, mediaType: 'image/jpeg' }, { fetcher });
  assert.deepEqual(r, { fotoValida: true, envases: [{ material: 'pet', cantidad: 4 }] });
  const body = capturas[0];
  assert.equal(body.tool_choice.name, 'extraer_envases');
  assert.equal(body.messages[0].content[0].type, 'image');
  assert.equal(body.messages[0].content[0].source.media_type, 'image/jpeg');
  assert.equal(body.messages[0].content[0].source.data, IMG);
  assert.equal(body.messages[0].content[1].type, 'text');
  Object.assign(config.analisisIA, originalIA);
});

test('contarEnvases: foto no contable → fotoValida false (el llamador rechaza)', { skip: SALTO_PROD }, async () => {
  habilitarIAdePrueba();
  const fetcher = async () => respuestaAnthropic({ foto_valida: false, envases: [] });
  const r = await analisisIA.contarEnvases({ imagenBase64: IMG, mediaType: 'image/png' }, { fetcher });
  assert.equal(r.fotoValida, false);
  Object.assign(config.analisisIA, originalIA);
});

test('contarEnvases: esquema inválido o API caída → null, sin lanzar', { skip: SALTO_PROD }, async () => {
  habilitarIAdePrueba();
  const rInvalido = await analisisIA.contarEnvases(
    { imagenBase64: IMG, mediaType: 'image/jpeg' },
    { fetcher: async () => respuestaAnthropic({ cualquier: 'cosa' }) }
  );
  assert.equal(rInvalido, null);
  const rCaida = await analisisIA.contarEnvases(
    { imagenBase64: IMG, mediaType: 'image/jpeg' },
    { fetcher: async () => { throw new Error('sin red'); } }
  );
  assert.equal(rCaida, null);
  Object.assign(config.analisisIA, originalIA);
});

test('contarEnvases: media type no permitido o IA apagada → null sin llamar al fetcher', async () => {
  let llamadas = 0;
  const fetcher = async () => { llamadas += 1; return respuestaAnthropic({}); };
  config.analisisIA.enabled = true;
  config.analisisIA.apiKey = 'clave-de-prueba';
  assert.equal(await analisisIA.contarEnvases({ imagenBase64: IMG, mediaType: 'image/heic' }, { fetcher }), null);
  assert.equal(await analisisIA.contarEnvases({ imagenBase64: '', mediaType: 'image/jpeg' }, { fetcher }), null);
  config.analisisIA.enabled = false;
  assert.equal(await analisisIA.contarEnvases({ imagenBase64: IMG, mediaType: 'image/jpeg' }, { fetcher }), null);
  assert.equal(llamadas, 0);
  Object.assign(config.analisisIA, originalIA);
});

test('contarEnvases: presupuesto agotado → null sin llamar al fetcher', { skip: SALTO_PROD }, async () => {
  await runMigrations();
  habilitarIAdePrueba();
  config.analisisIA.presupuestoDiarioClp = 100;
  // El gasto se siembra en la BD (no solo en memoria): presupuestoAgotado()
  // relee la bitácora del día y REEMPLAZA el acumulador — mismo criterio
  // que gastarHoy() en analisisIAPresupuesto.test.js.
  await query(
    `INSERT INTO analisis_ia_uso (modelo, exito, tokens_entrada, tokens_salida, costo_estimado_clp, latencia_ms)
     VALUES ($1, true, 1000, 500, 500, 100)`,
    ['modelo-de-prueba-envases']
  );
  presupuestoIA.reiniciar();
  let llamadas = 0;
  const fetcher = async () => { llamadas += 1; return respuestaAnthropic({}); };
  assert.equal(await analisisIA.contarEnvases({ imagenBase64: IMG, mediaType: 'image/jpeg' }, { fetcher }), null);
  assert.equal(llamadas, 0);
  Object.assign(config.analisisIA, originalIA);
  presupuestoIA.reiniciar();
});

// ---------- Con BD: reciclaje_id en puntos_eventos + misión contar_envases ----------

async function crearJugadorConPunto() {
  await runMigrations();
  const sufijo = crypto.randomBytes(4).toString('hex');
  const { rows: cod } = await query(
    `INSERT INTO codigos_acceso (codigo, creditos, empresa, modo_juego) VALUES ($1, 100, $2, true) RETURNING id`,
    [`SUMA-REC-${sufijo}`, `Empresa Reciclaje ${sufijo}`]
  );
  const { rows: jug } = await query(
    `INSERT INTO jugadores (email, codigo_id, empresa) VALUES ($1, $2, $3) RETURNING id`,
    [`reciclador-${sufijo}@ejemplo.cl`, cod[0].id, `Empresa Reciclaje ${sufijo}`]
  );
  const { rows: pl } = await query(
    `INSERT INTO puntos_limpios (nombre, token, lat, lng) VALUES ($1, $2, -33.45, -70.66) RETURNING id`,
    [`Punto de prueba ${sufijo}`, `pl_test_${sufijo}`]
  );
  return { jugadorId: jug[0].id, puntoLimpioId: pl[0].id };
}

test('otorgarPuntos con reciclajeId deja la FK en puntos_eventos', { skip: SALTO_PROD }, async () => {
  const { jugadorId, puntoLimpioId } = await crearJugadorConPunto();
  const { rows: [reciclaje] } = await query(
    `INSERT INTO reciclajes (jugador_id, punto_limpio_id, lat, lng, distancia_m, envases, total_envases, puntos)
     VALUES ($1,$2,-33.4501,-70.6601,15,'[{"material":"pet","cantidad":3}]',3,6) RETURNING id`,
    [jugadorId, puntoLimpioId]
  );
  let evento;
  await withTx(async (client) => {
    evento = await otorgarPuntos(client, { jugadorId, tipo: 'envase_reciclado', puntos: 6, reciclajeId: reciclaje.id });
  });
  assert.equal(evento.tipo, 'envase_reciclado');
  assert.equal(evento.reciclaje_id, reciclaje.id);
  const { rows } = await query(`SELECT puntos_totales FROM jugadores WHERE id = $1`, [jugadorId]);
  assert.equal(rows[0].puntos_totales, 6);
});

test('evaluarMisionesContador con contar_envases completa la misión "primeros_10_envases" de una vez', { skip: SALTO_PROD }, async () => {
  const { jugadorId } = await crearJugadorConPunto();
  let eventos;
  await withTx(async (client) => {
    eventos = await evaluarMisionesContador(client, { jugadorId, tipoMision: 'contar_envases', incremento: 10 });
  });
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].tipo, 'mision_completada');
  assert.equal(eventos[0].puntos, 60);
});

test('impactoDeJugador incluye las entregas de reciclaje', { skip: SALTO_PROD }, async () => {
  const { jugadorId, puntoLimpioId } = await crearJugadorConPunto();
  await query(
    `INSERT INTO reciclajes (jugador_id, punto_limpio_id, lat, lng, envases, total_envases, puntos)
     VALUES ($1,$2,-33.45,-70.66,'[{"material":"lata","cantidad":5}]',5,10)`,
    [jugadorId, puntoLimpioId]
  );
  const r = await impactoDeJugador(jugadorId);
  assert.equal(r.entregas_reciclaje, 1);
  assert.equal(r.envases_reciclados, 5);
});
