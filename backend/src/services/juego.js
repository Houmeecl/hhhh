import crypto from 'crypto';
import { query } from '../lib/db.js';

// ============================================================
// "Sube y Suma" — helpers puros de puntaje/nivel/trayecto (sin BD) +
// evaluación de misiones (con BD, recibe el client de una transacción ya
// abierta — mismo patrón que cadenaHash.js/anexarEslabon). Nunca calcula
// CO2e: solo puntúa sobre resultados que el motor propio ya calculó.
// Recompensas 100% simbólicas — no hay dinero real detrás de un punto.
// ============================================================

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Puntos fijos por documento calculado con éxito (nunca por uno rechazado
// — eso lo decide el llamador, no esta función). Sin bonus por tipo de
// motor: propio/propio_ia/propio_ocr/propio_texto son todos cálculos
// reales, no hay razón para premiar uno sobre otro.
export const PUNTOS_POR_DOCUMENTO = 10;

export function calcularPuntosPorFactura() {
  return PUNTOS_POR_DOCUMENTO;
}

// Umbrales de nivel — array simple, no tabla: ajustar acá no requiere
// migración. nivelDePuntos(puntos) es pura y determinista.
const NIVELES = [
  { nivel: 1, nombre: 'Recién llegado', desde: 0 },
  { nivel: 2, nombre: 'En marcha', desde: 100 },
  { nivel: 3, nombre: 'Constante', desde: 300 },
  { nivel: 4, nombre: 'Proveedor Verde', desde: 600 },
  { nivel: 5, nombre: 'Referente', desde: 1000 },
];

export function nivelDePuntos(puntos) {
  const p = Math.max(0, Number(puntos) || 0);
  let actual = NIVELES[0];
  for (const n of NIVELES) {
    if (p >= n.desde) actual = n;
  }
  const siguiente = NIVELES.find((n) => n.desde > actual.desde);
  return {
    nivel: actual.nivel,
    nombre: actual.nombre,
    puntos: p,
    umbralActual: actual.desde,
    umbralSiguiente: siguiente ? siguiente.desde : null,
    puntosParaSiguiente: siguiente ? Math.max(0, siguiente.desde - p) : 0,
  };
}

// Puntos por registrar un trayecto: base + bonus por medio de bajo carbono
// (coherente con lo que el resto de sicr3p ya mide — transporte por modo,
// Alcance 3 Cat. 6/7). Requiere llegada_at para puntuar: un trayecto sin
// cerrar (solo salida marcada) no suma nada todavía.
const PUNTOS_BASE_TRAYECTO = 10;
const BONUS_POR_MODO = {
  caminando: 20,
  bicicleta: 20,
  transporte_publico: 10,
  auto: 0,
  moto: 0,
  otro: 0,
};

export function calcularPuntosTrayecto({ modoTransporte, salidaAt, llegadaAt }) {
  if (!llegadaAt) return 0;
  const bonus = BONUS_POR_MODO[modoTransporte] ?? 0;
  return PUNTOS_BASE_TRAYECTO + bonus;
}

// Un modo cuenta como "bajo carbono" si trae bonus — usado para filtrar qué
// trayectos hacen avanzar la misión 'primer_trayecto_verde' (que exige
// caminando/bicicleta/transporte público, no cualquier trayecto cerrado).
export function esModoBajoCarbono(modoTransporte) {
  return (BONUS_POR_MODO[modoTransporte] ?? 0) > 0;
}

// ---------- Reciclaje en punto limpio ----------
// Puntaje simbólico por envase entregado (coherente con
// PUNTOS_POR_DOCUMENTO=10 y el bonus de trayecto) + topes anti-abuso:
// el premio es simbólico, así que el abuso debe ser caro y de bajo retorno.
export const PUNTOS_POR_ENVASE = 2;
export const TOPE_ENVASES_POR_REGISTRO = 30; // máx. puntuable por foto
export const TOPE_RECICLAJES_POR_DIA = 3;    // registros por jugador/día
export const RADIO_PUNTO_LIMPIO_M = 300;     // cercanía exigida si el punto tiene coordenadas
// 'otro' existe en el enum de la IA para que tenga dónde poner lo dudoso,
// pero no puntúa: solo suman los materiales reciclables reconocidos.
export const MATERIALES_ENVASE = ['pet', 'vidrio', 'lata', 'tetra'];

// Normaliza el conteo que validó la IA → { envases, totalEnvases, puntos }.
// Filtra materiales no puntuables, descarta cantidades no finitas o
// negativas y aplica el tope por registro. Pura y determinista: la IA solo
// cuenta, el puntaje lo decide siempre esta función.
export function calcularPuntosReciclaje(envases) {
  const limpios = [];
  let total = 0;
  for (const e of Array.isArray(envases) ? envases : []) {
    if (!e || !MATERIALES_ENVASE.includes(e.material)) continue;
    const cantidad = Math.floor(Number(e.cantidad));
    if (!Number.isFinite(cantidad) || cantidad <= 0) continue;
    limpios.push({ material: e.material, cantidad });
    total += cantidad;
  }
  const totalPuntuable = Math.min(total, TOPE_ENVASES_POR_REGISTRO);
  return { envases: limpios, totalEnvases: total, puntos: totalPuntuable * PUNTOS_POR_ENVASE };
}

// Distancia haversine en metros entre dos coordenadas WGS84.
export function distanciaHaversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Valida un par lat/lng venido del request: números finitos y en rango.
// OJO: Number(null) y Number('') son 0 (finito) — un request sin GPS
// pasaría como coordenada (0,0) si no se descartan antes.
export function coordenadasValidas(lat, lng) {
  if (lat == null || lat === '' || lng == null || lng === '') return false;
  const la = Number(lat);
  const ln = Number(lng);
  return Number.isFinite(la) && Number.isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180;
}

// Serial legible de canje: SUMA- + 6 hex mayúsculas (ej: SUMA-3F0A9B).
// La unicidad la garantiza el UNIQUE de la tabla canjes; la ruta que la
// crea reintenta si colisiona (mismo patrón que capacitacion.js).
export function generarSerialCanje() {
  return `SUMA-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

// Hash determinista del contenido verificable de un canje — sello propio,
// no forma parte de ninguna cadena encadenada (mismo criterio que
// hashConstancia: es evidencia de no-alteración, no trazabilidad de
// origen ni contabilidad de carbono).
export function hashCanje({ serial, jugador_id, recompensa_codigo, puntos_gastados, emitida_at }) {
  const canonico = [
    serial || '', jugador_id || '', recompensa_codigo || '',
    Number(puntos_gastados || 0), emitida_at ? new Date(emitida_at).toISOString() : '',
  ].join('|');
  return sha256(canonico);
}

// ---------- Evaluación de misiones (con BD) ----------
// Suma puntos a un jugador y deja constancia en puntos_eventos, dentro de
// la MISMA transacción del llamador (client ya abierto con BEGIN). No hace
// su propio commit/rollback — eso es responsabilidad de withTx.
export async function otorgarPuntos(client, { jugadorId, tipo, puntos, facturaId = null, misionId = null, trayectoId = null, reciclajeId = null }) {
  if (puntos <= 0) return null;
  const { rows } = await client.query(
    `INSERT INTO puntos_eventos (jugador_id, tipo, puntos, factura_id, mision_id, trayecto_id, reciclaje_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [jugadorId, tipo, puntos, facturaId, misionId, trayectoId, reciclajeId]
  );
  await client.query(
    `UPDATE jugadores SET puntos_totales = puntos_totales + $2 WHERE id = $1`,
    [jugadorId, puntos]
  );
  return rows[0];
}

// Suma progreso a todas las misiones activas de un tipo dado para un
// jugador; si alguna se completa recién ahora (progreso cruza meta_valor
// por primera vez), otorga sus puntos de recompensa. Idempotente frente a
// reintentos: una misión ya completada (completada_at IS NOT NULL) no
// vuelve a otorgar puntos aunque su progreso siga sumando. Devuelve los
// eventos de puntos_eventos de las misiones recién completadas en esta
// llamada (para que el llamador los exporte a BigQuery tras el commit).
export async function evaluarMisionesContador(client, { jugadorId, tipoMision, incremento = 1 }) {
  const { rows: misiones } = await client.query(
    `SELECT id, meta_valor, puntos_recompensa FROM misiones WHERE tipo = $1 AND activo = true`,
    [tipoMision]
  );
  const eventos = [];
  for (const m of misiones) {
    const { rows } = await client.query(
      `INSERT INTO misiones_progreso (jugador_id, mision_id, progreso)
       VALUES ($1, $2, $3)
       ON CONFLICT (jugador_id, mision_id)
       DO UPDATE SET progreso = misiones_progreso.progreso + $3
       RETURNING progreso, completada_at`,
      [jugadorId, m.id, incremento]
    );
    const fila = rows[0];
    if (fila.progreso >= m.meta_valor && !fila.completada_at) {
      await client.query(
        `UPDATE misiones_progreso SET completada_at = now() WHERE jugador_id = $1 AND mision_id = $2`,
        [jugadorId, m.id]
      );
      const evento = await otorgarPuntos(client, {
        jugadorId, tipo: 'mision_completada', puntos: m.puntos_recompensa, misionId: m.id,
      });
      if (evento) eventos.push(evento);
    }
  }
  return eventos;
}

// Panel de impacto personal: el CO2e real detrás de los puntos de un
// jugador — nunca "huella", nunca certificación. Cada evento
// 'documento_escaneado' siempre trae factura_id (viene de un INSERT en
// facturas ya confirmado dentro de la misma transacción, ver public.js),
// así que el INNER JOIN no necesita LEFT ni filtro de nulos.
export async function impactoDeJugador(jugadorId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS documentos, COALESCE(SUM(f.total_co2e), 0)::float AS co2e_total
     FROM puntos_eventos pe JOIN facturas f ON f.id = pe.factura_id
     WHERE pe.jugador_id = $1 AND pe.tipo = 'documento_escaneado'`,
    [jugadorId]
  );
  const { rows: rec } = await query(
    `SELECT COUNT(*)::int AS entregas, COALESCE(SUM(total_envases), 0)::int AS envases
     FROM reciclajes WHERE jugador_id = $1`,
    [jugadorId]
  );
  return {
    documentos: rows[0].documentos,
    co2e_total: rows[0].co2e_total,
    entregas_reciclaje: rec[0].entregas,
    envases_reciclados: rec[0].envases,
  };
}
