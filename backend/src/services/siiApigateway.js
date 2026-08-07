// ============================================================
// Adaptador apigateway.cl (app.apigateway.cl) para la descarga del RCV
// del SII. Proveedor ALTERNATIVO a BaseAPI/SimpleAPI, mismo contrato
// rut+clave por request: la clave tributaria del contribuyente jamás se
// registra en logs, URLs ni mensajes de error.
//
// Diferencias con BaseAPI/SimpleAPI:
//  - Auth del servicio: API Key propia en la cabecera Authorization con
//    el prefijo "Token" ('Token <APIGATEWAY_API_KEY>').
//  - Auth del contribuyente: body { auth: { pass: { rut, clave } } }.
//  - Su RCV NO expone el detalle de ítems por documento ("En ningún caso
//    este recurso entregará el listado de items", según su propio spec)
//    — igual que SimpleAPI, las compras se calculan por gasto (origen
//    'texto'), no por unidades físicas.
//  - Los campos vienen con prefijo det*/rsmn* (paso directo del RCV del
//    SII); se traducen al shape intermedio que ya entienden
//    normalizarFilaRcv/normalizarResumenRcv de baseapiSii.js.
// ============================================================
import {
  PERIODO_RE, errEntrada, errFuente, rutConGuion,
  normalizarFilaRcv, normalizarResumenRcv,
} from './baseapiSii.js';
import { config } from '../config.js';

// 'YYYY-MM' -> 'YYYYMM': el formato de período que exige apigateway.cl en la URL.
const periodoUrl = (periodo) => periodo.replace('-', '');

// Llamada base. `password` (la clave tributaria) NUNCA se registra: ni en
// console, ni en la URL, ni en el throw.
async function llamar(path, { rut, password }, { fetcher = fetch, cfg = config.sii.apigateway } = {}) {
  if (!cfg.enabled || !cfg.key) throw errFuente('apigateway.cl no está configurado (APIGATEWAY_API_KEY)');
  if (!password || typeof password !== 'string') throw errEntrada('Falta la clave tributaria.');

  let res;
  try {
    res = await fetcher(`${cfg.base}${path}`, {
      method: 'POST',
      headers: { Authorization: `Token ${cfg.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ auth: { pass: { rut: rutConGuion(rut), clave: password } } }),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
  } catch {
    // Nunca propagamos el error crudo: podría llevar el cuerpo (con la clave).
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
  if (!json) throw errFuente('El SII no entregó una respuesta válida.');
  // apigateway.cl es una pasarela directa al SII: algunos recursos informan
  // credenciales inválidas con HTTP 200 y un código de error != 0 dentro del
  // sobre de datos, no con un status HTTP de error.
  const codigo = json?.data?.datos?.codigoError ?? json?.data?.respEstado?.codRespuesta;
  if (codigo != null && Number(codigo) !== 0) {
    throw Object.assign(new Error('Clave tributaria incorrecta o bloqueada en el SII.'), { credenciales: true });
  }
  return json;
}

// Valida credenciales con la consulta más barata del catálogo (datos del
// contribuyente autenticado en MiSii), antes de gastar en la descarga del RCV.
export async function validarCredencialesSii({ rut, password }, opts = {}) {
  try {
    await llamar('/sii/misii/contribuyente/datos', { rut, password }, opts);
    return true;
  } catch (e) {
    if (e.credenciales || e.status === 400) return false;
    throw e;
  }
}

// RUT+DV del formato det* ('detRutDoc'/'detDvDoc') al formato con guión
// que espera normalizarFilaRcv.
function rutDetalle(fila) {
  const rut = fila.detRutDoc, dv = fila.detDvDoc;
  return rut != null && dv != null ? `${rut}-${dv}` : null;
}

// Traduce una fila del detalle (compra o venta) al shape intermedio que ya
// entiende normalizarFilaRcv (mismos nombres que usa el CSV del RCV del SII).
function filaDetalleAIntermedio(fila) {
  return {
    'Tipo Doc': fila.detTipoDoc, Folio: fila.detNroDoc,
    rut: rutDetalle(fila), 'Razon Social': fila.detRznSoc,
    'Fecha Docto': fila.detFchDoc,
    'Monto Neto': fila.detMntNeto, 'Monto IVA': fila.detMntIVA, 'Monto total': fila.detMntTotal,
  };
}

// Traduce una fila del resumen (boletas/comprobantes sin detalle, tipos
// 39/41/48) al shape que espera normalizarResumenRcv.
function resumenAIntermedio(fila) {
  return {
    codigoTipoDoc: fila.rsmnTipoDocInteger, tipoDocumento: fila.dcvNombreTipoDoc,
    totalDocumentos: fila.rsmnTotDoc, montoNeto: fila.rsmnMntNeto,
    montoIva: fila.rsmnMntIVA, montoTotal: fila.rsmnMntTotal,
  };
}

// `dte=0` + `tipo=rcv_csv` trae TODOS los tipos de documento del período en
// una sola llamada (recomendación del propio spec de apigateway.cl).
async function descargarDetalle(tipo, cred, opts = {}) {
  const sujeto = rutConGuion(cred.rutEmpresa || cred.rut);
  const per = periodoUrl(cred.periodo);
  const path = tipo === 'compra'
    ? `/sii/rcv/compras/detalle/${sujeto}/${per}/0/REGISTRO?tipo=rcv_csv&formato=json&certificacion=0`
    : `/sii/rcv/ventas/detalle/${sujeto}/${per}/0?tipo=rcv_csv&formato=json&certificacion=0`;
  const json = await llamar(path, cred, opts);
  const filas = Array.isArray(json?.data) ? json.data : [];
  return filas.map(filaDetalleAIntermedio).map(normalizarFilaRcv).filter(Boolean);
}

// Boletas (39/41) y comprobantes (48) no vienen en el detalle: hay que
// pedir el resumen aparte (mismo criterio que baseapiSii.js/SIN_DETALLE_RCV).
async function descargarResumen(tipo, cred, opts = {}) {
  const sujeto = rutConGuion(cred.rutEmpresa || cred.rut);
  const per = periodoUrl(cred.periodo);
  const path = tipo === 'compra'
    ? `/sii/rcv/compras/resumen/${sujeto}/${per}/REGISTRO?formato=json&certificacion=0`
    : `/sii/rcv/ventas/resumen/${sujeto}/${per}?formato=json&certificacion=0`;
  const json = await llamar(path, cred, opts);
  const filas = Array.isArray(json?.data?.data) ? json.data.data : [];
  return filas.map(resumenAIntermedio).map(normalizarResumenRcv).filter(Boolean);
}

// Descarga compras y ventas del período. Sin XML del DTE: las compras se
// calculan por gasto (un ítem sintético por documento), igual que SimpleAPI.
// Valida primero las credenciales con la consulta barata: si están malas,
// no gasta las llamadas de RCV.
export async function descargarComprasVentas({ rut, password, rutEmpresa, periodo }, opts = {}) {
  if (!PERIODO_RE.test(String(periodo || ''))) throw errEntrada('Período inválido: usa AAAA-MM (ej: 2026-06).');
  const ok = await validarCredencialesSii({ rut, password }, opts);
  if (!ok) throw Object.assign(new Error('Clave tributaria incorrecta o bloqueada en el SII.'), { credenciales: true });

  const args = { rut, password, rutEmpresa, periodo };
  const [compraDet, compraRes, ventaDet, ventaRes] = await Promise.all([
    descargarDetalle('compra', args, opts),
    descargarResumen('compra', args, opts),
    descargarDetalle('venta', args, opts),
    descargarResumen('venta', args, opts),
  ]);
  const compra = [...compraDet, ...compraRes].map((f) => ({
    ...f,
    items: [{ nombre: f.razon_social || 'Documento', descripcion: '', cantidad: 0, unidad: null, monto: f.neto || f.total }],
    origen_calculo: 'texto',
  }));
  const venta = [...ventaDet, ...ventaRes];
  return { compra, venta };
}
