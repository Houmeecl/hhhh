// ============================================================
// Situación tributaria por RUT vía BaseAPI (api.baseapi.cl).
//
// Alcance deliberadamente acotado: SOLO el endpoint
// POST /sii/contribuyente/situacion-tributaria, que consulta datos
// PÚBLICOS del SII (razón social, inicio de actividades, actividades
// económicas) y NO requiere la clave tributaria de nadie — basta la
// API key del servidor (config.baseapi.key, solo en backend/.env).
// Cualquier función futura que necesite credenciales SII de un
// cliente (RCV, DTE, F22) es otra fase: uso por solicitud y jamás
// persistir esa clave.
//
// Reglas (mismo espíritu que services/tipoCambio.js):
//  - fetch inyectable para tests sin red.
//  - Cada consulta cuesta cuota → caché en BD por RUT (migración 067),
//    fresca por CACHE_DIAS. Con la fuente caída se sirve la caché
//    vencida marcada { desactualizado: true }: nunca se pierde el dato
//    por una caída de BaseAPI.
//  - Los errores NUNCA incluyen la API key ni el cuerpo crudo de la
//    respuesta remota.
// ============================================================
import { config } from '../config.js';
import { query as dbQuery } from '../lib/db.js';
import { normalizarRut } from './mandante.js';

export const CACHE_DIAS = 30;

// Valida el shape mínimo que devuelve BaseAPI (SituacionTributaria del
// SDK oficial) y lo reduce a lo que sicr3p usa. Todo lo demás se
// descarta: menos superficie, menos datos de terceros guardados.
export function normalizarSituacion(data) {
  if (!data || typeof data !== 'object' || typeof data.nombre !== 'string' || !data.nombre.trim()) {
    return null;
  }
  const actividades = Array.isArray(data.actividadesEconomicas)
    ? data.actividadesEconomicas
        .filter((a) => a && typeof a.descripcion === 'string')
        .map((a) => ({
          codigo: String(a.codigo ?? ''),
          descripcion: a.descripcion,
          afectaIva: a.afectaIva === true,
        }))
    : [];
  return {
    rut: typeof data.rut === 'string' ? data.rut : null,
    razonSocial: data.nombre.trim(),
    inicioActividades: data.inicioActividades === true,
    fechaInicioActividades: typeof data.fechaInicioActividades === 'string' ? data.fechaInicioActividades : null,
    empresaMenorTamano: data.empresaMenorTamano === true,
    actividades,
  };
}

// Llamada directa a BaseAPI (sin caché). Lanza con mensaje seguro si la
// respuesta no sirve. `fetcher` inyectable para tests.
export async function consultarSituacionTributaria(rut, { fetcher = fetch, cfg = config.baseapi } = {}) {
  if (!cfg.enabled || !cfg.key) throw new Error('BaseAPI no está configurada (BASEAPI_API_KEY)');
  const norm = normalizarRut(rut);
  if (norm.length < 7 || norm.length > 9) throw new Error('RUT inválido');
  const rutConGuion = `${norm.slice(0, -1)}-${norm.slice(-1)}`;

  const res = await fetcher(`${cfg.base}/sii/contribuyente/situacion-tributaria`, {
    method: 'POST',
    headers: { 'X-API-Key': cfg.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rut: rutConGuion }),
    signal: AbortSignal.timeout(cfg.timeoutMs),
  });
  if (!res.ok) {
    // 404 = RUT sin registro en el SII; el resto son fallas de la fuente.
    if (res.status === 404) throw Object.assign(new Error('RUT sin registro en el SII'), { sinRegistro: true });
    throw new Error(`BaseAPI respondió HTTP ${res.status}`);
  }
  const json = await res.json().catch(() => null);
  // La API envuelve la respuesta en { data: ... } (así la lee el SDK oficial).
  const situacion = normalizarSituacion(json?.data ?? json);
  if (!situacion) throw new Error('BaseAPI no entregó una situación tributaria válida');
  return situacion;
}

// Punto de entrada con caché: devuelve la fila fresca si tiene menos de
// CACHE_DIAS; si no, consulta y hace UPSERT. Si BaseAPI falla pero hay
// caché vencida, la devuelve con { desactualizado: true }.
export async function consultarRut(rut, { fetcher = fetch, query = dbQuery, cfg = config.baseapi } = {}) {
  const norm = normalizarRut(rut);
  if (norm.length < 7 || norm.length > 9) throw new Error('RUT inválido');

  const { rows } = await query(
    `SELECT respuesta, consultado_at FROM sii_consultas WHERE rut_norm = $1`,
    [norm]
  );
  const cacheada = rows[0];
  const fresca =
    cacheada && Date.now() - new Date(cacheada.consultado_at).getTime() < CACHE_DIAS * 24 * 60 * 60 * 1000;
  if (fresca) return { ...cacheada.respuesta, desactualizado: false };

  try {
    const situacion = await consultarSituacionTributaria(norm, { fetcher, cfg });
    await query(
      `INSERT INTO sii_consultas (rut_norm, respuesta, consultado_at)
       VALUES ($1, $2, now())
       ON CONFLICT (rut_norm) DO UPDATE SET respuesta = EXCLUDED.respuesta, consultado_at = now()`,
      [norm, JSON.stringify(situacion)]
    );
    return { ...situacion, desactualizado: false };
  } catch (e) {
    // Un RUT que el SII no conoce no es una falla de la fuente: se propaga
    // tal cual (y no pisa una caché anterior si existiera).
    if (e.sinRegistro) throw e;
    if (cacheada) {
      console.error(`[baseapi] fuente caída (${e.message}) — se sirve caché vencida para el RUT consultado`);
      return { ...cacheada.respuesta, desactualizado: true };
    }
    throw e;
  }
}
