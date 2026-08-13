import crypto from 'crypto';
import { config } from '../config.js';

// ============================================================
// Pasarela de pago. Dos implementaciones detrás de la misma interfaz:
//
//  · 'manual'  — transferencia bancaria. El link muestra los datos de la
//                cuenta y un admin confirma el pago en el panel. No
//                depende de contratar nada: es lo que funciona HOY.
//  · 'flow'    — Flow.cl. Emite el link de pago y avisa por webhook.
//
// LA REGLA QUE NO SE NEGOCIA: el webhook de Flow NO se cree. Flow avisa
// mandando un token, y el estado real se pregunta de vuelta a Flow
// firmando la consulta (`estadoPagoFlow`). Un webhook es un POST público
// —cualquiera en internet puede inventarlo—, así que tratar su cuerpo
// como verdad sería regalar accesos a quien adivine el formato. El único
// dato del que se hace caso es el token, y solo para preguntar por él.
//
// Y una segunda: el MONTO se compara contra el del cobro. Que el pago
// exista no significa que sea por lo que se cobró.
// ============================================================

export const PASARELAS = ['manual', 'flow'];

/** La pasarela configurada, degradando a 'manual' si le faltan llaves. */
export function pasarelaActiva(cfg = config) {
  const p = cfg.pagos?.pasarela;
  if (p === 'flow' && cfg.pagos.flow.apiKey && cfg.pagos.flow.secret) return 'flow';
  return 'manual';
}

/** ¿Se puede enviar un correo de cobro? Con transferencia hacen falta los datos de la cuenta. */
export function puedeCobrar(cfg = config) {
  if (pasarelaActiva(cfg) === 'flow') return { ok: true };
  const t = cfg.pagos.transferencia;
  if (!t.banco || !t.numero || !t.titular) {
    return {
      ok: false,
      error: 'Falta configurar la cuenta bancaria para transferencias (PAGO_BANCO, PAGO_CUENTA y '
        + 'PAGO_TITULAR en el .env del backend — ver .env.example en la raíz del repo), o activar '
        + 'una pasarela con PAGOS_PASARELA=flow.',
    };
  }
  return { ok: true };
}

/**
 * Token del link de pago. 32 bytes: no se adivina por fuerza bruta y no
 * hace falta que sea corto porque viaja en un enlace, no se transcribe.
 */
export const generarTokenPago = () => crypto.randomBytes(32).toString('hex');

// ---------- Flow ----------

/**
 * Firma de Flow: HMAC-SHA256 (hex) sobre la concatenación de
 * `clave + valor` de TODOS los parámetros ORDENADOS ALFABÉTICAMENTE por
 * clave, sin separadores y sin incluir la propia firma.
 *
 * El orden es la parte que se rompe sola: si un día se agrega un
 * parámetro y se manda en el orden en que se escribió el objeto, la
 * firma deja de calzar y Flow responde un error que no dice por qué.
 * Por eso se ordena acá adentro y no en el llamador.
 */
export function firmarFlow(params, secret) {
  const cadena = Object.keys(params)
    .filter((k) => k !== 's' && params[k] !== undefined && params[k] !== null)
    .sort()
    .map((k) => k + params[k])
    .join('');
  return crypto.createHmac('sha256', secret).update(cadena).digest('hex');
}

/** Cuerpo firmado, listo para mandar como application/x-www-form-urlencoded. */
export function cuerpoFirmado(params, secret) {
  const firmados = { ...params, s: firmarFlow(params, secret) };
  return new URLSearchParams(
    Object.entries(firmados).filter(([, v]) => v !== undefined && v !== null)
  ).toString();
}

async function pedirFlow(ruta, params, { metodo = 'POST', cfg = config } = {}) {
  const { base, secret, timeoutMs } = cfg.pagos.flow;
  const cuerpo = cuerpoFirmado(params, secret);
  const url = metodo === 'GET' ? `${base}${ruta}?${cuerpo}` : `${base}${ruta}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: metodo,
      signal: ctrl.signal,
      ...(metodo === 'POST'
        ? { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: cuerpo }
        : {}),
    });
    const texto = await r.text();
    let datos;
    try { datos = JSON.parse(texto); } catch { datos = null; }
    if (!r.ok) {
      throw new Error(`Flow ${ruta} respondió ${r.status}: ${datos?.message || texto.slice(0, 200)}`);
    }
    if (!datos) throw new Error(`Flow ${ruta} respondió algo que no es JSON.`);
    return datos;
  } finally {
    clearTimeout(t);
  }
}

// Flow exige que `commerceOrder` sea ÚNICO por orden creada, y quien
// abre el link, se arrepiente y vuelve genera una segunda orden. Mandar
// el id del cobro a secas dejaba a esa persona sin poder pagar nunca.
//
// Se le pega un sufijo aleatorio y se recorta de vuelta al leerlo: el id
// del cobro es un UUID, que mide exactamente 36 caracteres, así que
// `cobroDeOrden` sabe siempre dónde cortar sin necesidad de guardar nada.
export const LARGO_UUID = 36;
export const ordenDeCobro = (cobroId) => `${cobroId}-${crypto.randomBytes(4).toString('hex')}`;
export const cobroDeOrden = (orden) => String(orden || '').slice(0, LARGO_UUID) || null;

/**
 * Crea la orden en Flow y devuelve la URL a la que mandar al comprador.
 *
 * `urlConfirmation` la llama Flow servidor-a-servidor (tiene que ser
 * pública y sin autenticación); `urlReturn` es a donde vuelve la persona
 * con su navegador. Son distintas a propósito: la primera decide si se
 * entrega el acceso, la segunda solo muestra una pantalla.
 */
export async function crearPagoFlow({ cobro, asunto, cfg = config }) {
  const datos = await pedirFlow('/payment/create', {
    apiKey: cfg.pagos.flow.apiKey,
    commerceOrder: ordenDeCobro(cobro.id),
    subject: asunto.slice(0, 255),
    currency: 'CLP',
    // Flow exige entero en CLP: un decimal lo rechaza con un error genérico.
    amount: Math.round(Number(cobro.monto_clp)),
    email: cobro.email,
    urlConfirmation: `${cfg.publicApiUrl}/api/pagos/flow/confirmar`,
    urlReturn: `${cfg.publicAppUrl}/pagar/${cobro.token}/listo`,
  }, { cfg });
  if (!datos.url || !datos.token) throw new Error('Flow no devolvió una URL de pago.');
  return { url: `${datos.url}?token=${datos.token}`, ref: String(datos.flowOrder ?? datos.token) };
}

/** Estados de Flow: 1 pendiente, 2 pagada, 3 rechazada, 4 anulada. */
export const FLOW_PAGADA = 2;

/**
 * Pregunta a Flow por el estado real de una orden. Es la ÚNICA fuente
 * que decide si un pago ocurrió — ver el comentario de arriba.
 */
export async function estadoPagoFlow(token, { cfg = config } = {}) {
  const d = await pedirFlow('/payment/getStatus', { apiKey: cfg.pagos.flow.apiKey, token },
    { metodo: 'GET', cfg });
  return {
    pagada: Number(d.status) === FLOW_PAGADA,
    estado: Number(d.status),
    // `commerceOrder` lleva el id del cobro más el sufijo del intento
    // (ver ordenDeCobro): así se sabe A QUÉ cobro corresponde este aviso,
    // aunque la persona haya abierto el pago varias veces.
    cobroId: d.commerceOrder ? cobroDeOrden(d.commerceOrder) : null,
    monto: Math.round(Number(d.amount) || 0),
    ref: String(d.flowOrder ?? token),
  };
}
