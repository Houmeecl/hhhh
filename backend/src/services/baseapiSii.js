// ============================================================
// Descarga del Registro de Compras y Ventas (RCV) del SII vía BaseAPI.
//
// A diferencia de services/baseapi.js (situación tributaria, dato PÚBLICO
// por RUT, sin clave de nadie), acá SÍ se usa la clave tributaria del
// contribuyente — pero SIEMPRE por solicitud y JAMÁS persistida:
//
//   1. La clave llega en el body del request del proveedor logueado.
//   2. Se reenvía UNA vez a BaseAPI en el cuerpo (RcvCredentialsDto).
//   3. Se descarta al terminar el handler. No entra a la BD, ni a un log,
//      ni a un mensaje de error.
//
// Es exactamente la "otra fase" que anticipaba la cabecera de baseapi.js.
// La misma api key del servidor (config.baseapi.key) autoriza la llamada;
// la clave del contribuyente es un dato del cuerpo, no una credencial de
// sicr3p.
//
// Reglas (mismo espíritu que baseapi.js / tipoCambio.js):
//  - `fetcher` inyectable para tests sin red.
//  - Los errores NUNCA incluyen la clave, la api key, ni el cuerpo crudo
//    de la respuesta remota.
// ============================================================
import { config } from '../config.js';
import { normalizarRut } from './mandante.js';
import { rutValido, parseDte } from './dte.js';

// 'YYYY-MM' — el mismo formato que exige BaseAPI para el período.
export const PERIODO_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// Un RUT normalizado (solo dígitos + DV) al formato con guión que espera
// la API: '760000000' -> '76000000-0'. Lanza si el DV no cuadra: no
// gastamos una llamada pagada en un RUT que el SII no puede tener.
function rutConGuion(rutCrudo) {
  const norm = normalizarRut(rutCrudo);
  if (norm.length < 7 || norm.length > 9) throw new Error('RUT inválido');
  const con = `${norm.slice(0, -1)}-${norm.slice(-1)}`;
  if (!rutValido(con)) throw new Error('RUT inválido');
  return con;
}

// Lee un monto que el SII entrega como string ('350000', a veces con
// separadores) y lo devuelve como número. Nunca NaN: cae a 0.
function montoNum(v) {
  if (v == null) return 0;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

// 'DD/MM/YYYY' (formato del RCV) -> 'YYYY-MM-DD'. Deja pasar lo que ya
// venga en ISO; devuelve null si no reconoce el formato (la columna es
// opcional en BD).
function fechaISO(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  const dmy = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

// Primer valor no vacío entre varias claves posibles: el RCV nombra las
// columnas distinto en compra ('RUT Proveedor') y venta ('RUT Cliente').
function primero(obj, claves) {
  for (const k of claves) {
    if (obj[k] != null && String(obj[k]).trim() !== '') return obj[k];
  }
  return null;
}

// Reduce una fila cruda del RCV a lo que sicr3p guarda. Todo lo demás se
// descarta: menos datos de terceros almacenados (mismo criterio que
// normalizarSituacion en baseapi.js).
export function normalizarFilaRcv(fila) {
  if (!fila || typeof fila !== 'object') return null;
  const folio = primero(fila, ['Folio', 'folio']);
  if (folio == null) return null;
  const rut = primero(fila, ['RUT Proveedor', 'RUT Cliente', 'Rut cliente', 'RUT cliente', 'rut']);
  return {
    tipo_dte: primero(fila, ['Tipo Doc', 'Tipo DTE', 'tipo_dte']) != null
      ? String(primero(fila, ['Tipo Doc', 'Tipo DTE', 'tipo_dte'])) : null,
    folio: String(folio),
    rut_contraparte: rut ? normalizarRut(rut) : null,
    razon_social: primero(fila, ['Razon Social', 'Razón Social', 'razon_social']) || null,
    neto: montoNum(primero(fila, ['Monto Neto', 'monto_neto'])),
    iva: montoNum(primero(fila, ['Monto IVA', 'monto_iva'])),
    total: montoNum(primero(fila, ['Monto total', 'Monto Total', 'monto_total'])),
    fecha: fechaISO(primero(fila, ['Fecha Docto', 'Fecha Emision', 'fecha'])),
  };
}

// Extrae el arreglo de documentos del sobre { success, data: {datos|[]} }.
// Sin datos el RCV responde { data: [] } o { data: { datos: [] } }.
function filasDe(json) {
  const data = json?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.datos)) return data.datos;
  return [];
}

// Llamada base a BaseAPI con credenciales del contribuyente en el cuerpo.
// `password` NO se registra en ningún lado: ni en console, ni en el throw.
async function llamar(path, { rut, password, rutEmpresa }, { fetcher = fetch, cfg = config.baseapi } = {}) {
  if (!cfg.enabled || !cfg.key) throw new Error('BaseAPI no está configurada (BASEAPI_API_KEY)');
  if (!password || typeof password !== 'string') throw new Error('Falta la clave tributaria.');

  const body = { rut: rutConGuion(rut), password };
  // rut_empresa solo si el proveedor consulta como representante de una
  // empresa distinta a la persona que se autentica.
  if (rutEmpresa) {
    const empresa = rutConGuion(rutEmpresa);
    if (empresa !== body.rut) body.rut_empresa = empresa;
  }

  let res;
  try {
    res = await fetcher(`${cfg.base}${path}`, {
      method: 'POST',
      headers: { 'X-API-Key': cfg.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
  } catch {
    // Nunca propagamos el error crudo: podría llevar el cuerpo (con la clave).
    throw new Error('No se pudo contactar al SII en este momento. Intenta más tarde.');
  }

  if (!res.ok) {
    // 401/403 = credenciales SII inválidas en RCV/DTE. OJO: /sii/auth/validar
    // responde 400 para "credenciales inválidas" (así lo documenta BaseAPI);
    // ese caso lo interpreta validarCredencialesSii() con e.status.
    if (res.status === 401 || res.status === 403) {
      throw Object.assign(new Error('Clave tributaria incorrecta o bloqueada en el SII.'), { credenciales: true, status: res.status });
    }
    if (res.status === 400) {
      // En RCV/DTE un 400 es período/empresa inválidos. Mensaje accionable,
      // sin cuerpo crudo de la respuesta remota.
      throw Object.assign(new Error('El SII rechazó la consulta: revisa el período (AAAA-MM) y que el RUT de la empresa exista en el SII.'), { status: 400 });
    }
    throw Object.assign(new Error(`El SII respondió con un error (HTTP ${res.status}). Intenta más tarde.`), { status: res.status });
  }
  const json = await res.json().catch(() => null);
  if (!json || json.success === false) throw new Error('El SII no entregó una respuesta válida.');
  return json;
}

// Valida credenciales sin costo/operación (POST /sii/auth/validar) antes
// de gastar cuota en la descarga. Devuelve true/false; solo relanza fallas
// de la fuente distintas a "credenciales malas".
export async function validarCredencialesSii({ rut, password }, opts = {}) {
  try {
    await llamar('/sii/auth/validar', { rut, password }, opts);
    return true;
  } catch (e) {
    // En ESTE endpoint, BaseAPI documenta 400 = "Credenciales inválidas"
    // (además de los 401/403 genéricos): todos significan clave mala.
    if (e.credenciales || e.status === 400) return false;
    throw e;
  }
}

// Descarga el RCV de un período/tipo y devuelve las filas normalizadas.
export async function descargarRcv({ rut, password, rutEmpresa, periodo, tipo }, opts = {}) {
  if (!PERIODO_RE.test(String(periodo || ''))) throw new Error('Período inválido (usa AAAA-MM).');
  if (tipo !== 'compra' && tipo !== 'venta') throw new Error('Tipo inválido (compra|venta).');
  const json = await llamar(`/sii/rcv/${periodo}/${tipo}`, { rut, password, rutEmpresa }, opts);
  return filasDe(json).map(normalizarFilaRcv).filter(Boolean);
}

// Normaliza un DTE recibido (compra) trayendo el DETALLE de ítems desde el
// XML firmado (xml_base64), para poder calcular emisiones por ítem con el
// motor propio. Si el XML falta o no parsea, cae a un solo ítem por el
// monto total (método por gasto), sin perder el documento.
export function normalizarDteRecibido(doc) {
  if (!doc || typeof doc !== 'object') return null;
  const folio = doc.folio ?? doc.Folio;
  if (folio == null) return null;

  let dte = null;
  if (typeof doc.xml_base64 === 'string' && doc.xml_base64) {
    try { dte = parseDte(Buffer.from(doc.xml_base64, 'base64').toString('utf8')); } catch { dte = null; }
  }

  const total = Number(doc.monto_total ?? dte?.monto_total ?? 0) || 0;
  const neto = Number(dte?.monto_neto ?? 0) || 0;
  const iva = Number(dte?.iva ?? 0) || 0;
  const rut = doc.rut_emisor ?? dte?.rut_emisor;
  // Ítems del XML; si no hay, un ítem sintético por el monto (razón social
  // como texto para que el motor pueda clasificar por palabras clave).
  const items = dte?.items?.length
    ? dte.items
    : [{ nombre: doc.razon_social_emisor || dte?.razon_social_emisor || 'Documento', descripcion: '', cantidad: 0, unidad: null, monto: neto || total }];

  return {
    tipo_dte: String(doc.tipo_dte ?? dte?.tipo_dte ?? ''),
    folio: String(folio),
    rut_contraparte: rut ? normalizarRut(rut) : null,
    razon_social: doc.razon_social_emisor || dte?.razon_social_emisor || null,
    neto: neto || total,
    iva,
    total,
    fecha: fechaISO(doc.fecha ?? dte?.fecha_emision),
    items, // detalle para el cálculo; no se persiste tal cual
    origen_calculo: dte?.items?.length ? 'xml' : 'texto', // xml habilita método físico
  };
}

// Descarga los DTE recibidos (compras) CON su XML, para extraer el detalle.
export async function descargarDteRecibidos({ rut, password, rutEmpresa, periodo }, opts = {}) {
  if (!PERIODO_RE.test(String(periodo || ''))) throw new Error('Período inválido (usa AAAA-MM).');
  const json = await llamar(`/sii/dte/recibidos/${periodo}`, { rut, password, rutEmpresa }, opts);
  const docs = Array.isArray(json?.data?.documentos) ? json.data.documentos : [];
  return docs.map(normalizarDteRecibido).filter(Boolean);
}

// Descarga compras Y ventas de un período en una sola operación. Valida
// primero las credenciales con el endpoint barato: si están malas, no
// gasta las llamadas caras.
//  - COMPRAS: por DTE recibidos (con XML) para extraer todo el detalle y
//    poder calcular emisiones por ítem.
//  - VENTAS: por RCV (totales); las ventas no alimentan la estimación de
//    emisiones de compras, basta el resumen.
export async function descargarComprasVentas({ rut, password, rutEmpresa, periodo }, opts = {}) {
  if (!PERIODO_RE.test(String(periodo || ''))) throw new Error('Período inválido (usa AAAA-MM).');
  const ok = await validarCredencialesSii({ rut, password }, opts);
  if (!ok) throw Object.assign(new Error('Clave tributaria incorrecta o bloqueada en el SII.'), { credenciales: true });
  const compra = await descargarDteRecibidos({ rut, password, rutEmpresa, periodo }, opts);
  const venta = await descargarRcv({ rut, password, rutEmpresa, periodo, tipo: 'venta' }, opts);
  return { compra, venta };
}
