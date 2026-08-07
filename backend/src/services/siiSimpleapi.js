// ============================================================
// Adaptador SimpleAPI (simpleapi.cl) para la descarga del RCV del SII.
//
// Es un proveedor ALTERNATIVO a BaseAPI, con el mismo espíritu: la clave
// tributaria del contribuyente viaja SOLO por request y jamás se registra
// en logs, URLs ni mensajes de error. Se activa con SII_PROVEEDOR=simpleapi.
//
// Diferencias con BaseAPI:
//  - Autenticación del servicio: API Key propia en la cabecera Authorization
//    (BaseAPI usa X-API-Key).
//  - Las credenciales del contribuyente van en el cuerpo como RutUsuario /
//    PasswordSII (+ RutEmpresa opcional).
//  - SimpleRCV entrega el RCV por scraping del portal (mismas columnas que
//    el CSV del SII), así que reutilizamos los normalizadores de baseapiSii.
//    No expone el XML del DTE, de modo que las compras se calculan por gasto
//    (origen 'texto'), no por unidades físicas.
//
// NOTA: los paths exactos y los nombres de campos de SimpleAPI deben
// confirmarse contra su documentación (documentacion.simpleapi.cl) antes de
// activar este proveedor en producción; acá se implementan según el contrato
// público conocido (API Key en Authorization; RutUsuario/PasswordSII).
// ============================================================
import { config } from '../config.js';
import {
  PERIODO_RE, errEntrada, errFuente, rutConGuion,
  normalizarFilaRcv, normalizarResumenRcv,
} from './baseapiSii.js';

// Llamada base a SimpleAPI. `password` (PasswordSII) NO se registra jamás.
async function llamar(path, { rut, password, rutEmpresa, periodo }, { fetcher = fetch, cfg = config.sii.simpleapi } = {}) {
  if (!cfg.enabled || !cfg.key) throw errFuente('SimpleAPI no está configurada (SIMPLEAPI_KEY)');
  if (!password || typeof password !== 'string') throw errEntrada('Falta la clave tributaria.');

  const body = { RutUsuario: rutConGuion(rut), PasswordSII: password, Ambiente: 1 };
  if (periodo) body.Periodo = periodo;
  if (rutEmpresa) {
    const empresa = rutConGuion(rutEmpresa);
    if (empresa !== body.RutUsuario) body.RutEmpresa = empresa;
  }

  let res;
  try {
    res = await fetcher(`${cfg.base}${path}`, {
      method: 'POST',
      headers: { Authorization: cfg.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
  } catch {
    throw errFuente('No se pudo contactar al SII en este momento. Intenta más tarde.');
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw Object.assign(new Error('Clave tributaria incorrecta o bloqueada en el SII.'), { credenciales: true, status: res.status });
    }
    if (res.status === 400) {
      throw Object.assign(errEntrada('El SII rechazó la consulta: revisa el período (AAAA-MM) y que el RUT de la empresa exista en el SII.'), { status: 400 });
    }
    throw errFuente(`El SII respondió con un error (HTTP ${res.status}). Intenta más tarde.`, res.status);
  }
  const json = await res.json().catch(() => null);
  if (json == null) throw errFuente('El SII no entregó una respuesta válida.');
  return json;
}

// Extrae las filas del RCV de la respuesta de SimpleAPI. SimpleRCV devuelve
// el listado como arreglo (o bajo `data`/`datos`); se toleran las variantes.
function filasDe(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.datos)) return json.datos;
  if (Array.isArray(json?.data?.datos)) return json.data.datos;
  return [];
}

function resumenDe(json) {
  const r = json?.resumenPorTipo || json?.data?.resumenPorTipo;
  return Array.isArray(r) ? r : [];
}

// Descarga el RCV de un período/tipo y normaliza igual que BaseAPI, sumando
// la fila-resumen de los tipos agregados (boletas 39/41, comprobantes 48).
async function descargarRcv({ rut, password, rutEmpresa, periodo, tipo }, opts = {}) {
  if (!PERIODO_RE.test(String(periodo || ''))) throw errEntrada('Período inválido: usa AAAA-MM (ej: 2026-06).');
  if (tipo !== 'compra' && tipo !== 'venta') throw errEntrada('Tipo inválido (compra|venta).');
  const json = await llamar(`/rcv/${tipo}`, { rut, password, rutEmpresa, periodo }, opts);
  const filas = filasDe(json).map(normalizarFilaRcv).filter(Boolean);
  const resumen = resumenDe(json).map(normalizarResumenRcv).filter(Boolean);
  return [...filas, ...resumen];
}

// Valida credenciales haciendo una consulta mínima de compras: si el SII
// autentica, devuelve true; solo un error de credenciales da false.
export async function validarCredencialesSii({ rut, password }, opts = {}) {
  try {
    await llamar('/rcv/compra', { rut, password, periodo: undefined }, opts);
    return true;
  } catch (e) {
    if (e.credenciales || e.status === 400) return false;
    throw e;
  }
}

// Descarga compras y ventas del período. Sin XML del DTE, las compras salen
// del RCV (método por gasto); mismas claves normalizadas que BaseAPI para
// que el cálculo y el UPSERT aguas abajo no distingan proveedor.
export async function descargarComprasVentas({ rut, password, rutEmpresa, periodo }, opts = {}) {
  if (!PERIODO_RE.test(String(periodo || ''))) throw errEntrada('Período inválido: usa AAAA-MM (ej: 2026-06).');
  const compraRcv = await descargarRcv({ rut, password, rutEmpresa, periodo, tipo: 'compra' }, opts);
  const venta = await descargarRcv({ rut, password, rutEmpresa, periodo, tipo: 'venta' }, opts);
  // Un ítem sintético por documento para que el motor calcule por gasto.
  const compra = compraRcv.map((f) => ({
    ...f,
    items: [{ nombre: f.razon_social || 'Documento', descripcion: '', cantidad: 0, unidad: null, monto: f.neto || f.total }],
    origen_calculo: 'texto',
  }));
  return { compra, venta };
}
