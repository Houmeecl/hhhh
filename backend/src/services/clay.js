import { config } from '../config.js';

// ============================================================
// Cliente de la Clay Public API v2 (api.clay.cl) — plataforma contable y
// financiera chilena. Especificación OpenAPI 2.0.0 entregada por el titular.
//
// Qué aporta a sicr3p, en orden de valor:
//
// 1. DATOS DE EMPRESA POR RUT (`empresa`). Hoy el alta de un cliente se
//    teclea a mano y esa razón social queda CONGELADA en el snapshot del
//    contrato (services/contrato.js). Consultarla evita que el contrato
//    salga con lo que alguien escribió apurado.
//
// 2. DTE SINCRONIZADOS DESDE EL SII (`dtes`, `productosPorDocumento`).
//    Con `recibidos: true` es el libro de compras completo de la empresa,
//    con sus líneas de detalle (item_name, quantity, unit_price,
//    total_price) — exactamente la forma que consume el motor de cálculo,
//    y con la misma calidad estructural que un XML DTE.
//    **No están conectados al motor todavía**: hacerlo cambia de dónde
//    salen los documentos del cálculo, y eso es una decisión de producto y
//    de metodología, no un detalle de implementación. Ver
//    docs/INTEGRACIONES.md.
//
// Apagado por defecto (CLAY_HABILITADO=false). Sin token no hace nada.
//
// El token es personal del usuario de Clay y da acceso a las empresas de
// su cuenta: va en el .env del servidor, jamás en el repositorio ni en el
// frontend.
// ============================================================

const BASE = 'https://api.clay.cl';

// 1.000 solicitudes por hora por token. Se lee de las cabeceras de cada
// respuesta y se deja disponible para diagnóstico.
export const LIMITE_POR_HORA = 1000;

// Máximo que acepta la API por página en los listados.
export const MAX_LIMITE = 500;

// Códigos SII de los tipos de documento que nombra la especificación.
export const TIPOS_SII = {
  33: 'Factura Electrónica',
  34: 'Factura No Afecta o Exenta Electrónica',
  39: 'Boleta Electrónica',
  52: 'Guía de Despacho Electrónica',
  56: 'Nota de Débito Electrónica',
  61: 'Nota de Crédito Electrónica',
};

// La especificación se contradice consigo misma: la convención general dice
// que el RUT "se acepta en cualquier formato", pero los endpoints de
// obligaciones piden explícitamente "RUT de la empresa sin guión ni dígito
// verificador". Se normaliza siempre a la forma estricta, que satisface las
// dos lecturas.
export function rutCompania(rut) {
  const limpio = String(rut || '').replace(/[^0-9kK]/g, '');
  if (limpio.length < 2) throw new Error('RUT inválido');
  return limpio.slice(0, -1); // quita el dígito verificador
}

// Las respuestas de la especificación vienen como { status, data }, pero
// varios listados declaran su esquema vacío — o sea, sin contrato. Se
// desenvuelve de forma tolerante en vez de asumir una forma: si viene el
// sobre se devuelve `data`, si viene un array pelado se devuelve tal cual.
export function desenvolver(json) {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object' && 'data' in json) return json.data;
  return json;
}

export function limitesDe(headers) {
  const n = (h) => {
    const v = headers?.get?.(h);
    return v == null || v === '' ? null : Number(v);
  };
  return {
    limite: n('X-RateLimit-Limit'),
    restantes: n('X-RateLimit-Remaining'),
    reinicia: n('X-RateLimit-Reset'), // unix timestamp UTC
    requestId: headers?.get?.('X-Request-Id') || null,
  };
}

// Traduce los errores de la API a mensajes que sirvan en el panel. El 401 y
// el 429 son los dos que un operador va a ver de verdad, y ninguno se
// arregla reintentando en el momento.
export function mensajeDeError(status, cuerpo) {
  const detalle = cuerpo?.detail ?? cuerpo?.message ?? cuerpo?.error;
  if (status === 401 || status === 403) {
    return 'Clay rechazó el token. Revisa CLAY_TOKEN en el servidor.';
  }
  if (status === 404) return 'Clay no encontró ese recurso.';
  if (status === 429) {
    return `Se superó el límite de ${LIMITE_POR_HORA} solicitudes por hora del token de Clay.`;
  }
  if (status === 422) {
    // HTTPValidationError: detail es un array de { loc, msg, type }.
    const msgs = Array.isArray(detalle) ? detalle.map((e) => e?.msg).filter(Boolean) : [];
    return msgs.length ? `Clay rechazó los parámetros: ${msgs.join('; ')}` : 'Clay rechazó los parámetros de la consulta.';
  }
  const texto = typeof detalle === 'string' ? detalle : '';
  return `Clay respondió ${status}${texto ? `: ${texto}` : ''}`;
}

// Arma la query descartando lo que no se mandó. Sin esto, un `undefined`
// viaja como el string "undefined" y la API lo rechaza con 422.
export function construirQuery(params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    q.set(k, typeof v === 'boolean' ? String(v) : String(v));
  }
  return q.toString();
}

async function pedir(ruta, { params, fetchImpl = fetch } = {}) {
  if (!config.clay?.habilitado) throw new Error('Clay está apagado (CLAY_HABILITADO=false)');
  if (!config.clay?.token) throw new Error('Falta CLAY_TOKEN');

  const qs = construirQuery(params);
  const res = await fetchImpl(`${BASE}${ruta}${qs ? `?${qs}` : ''}`, {
    headers: { Authorization: `Bearer ${config.clay.token}`, Accept: 'application/json' },
  });
  const cuerpo = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(mensajeDeError(res.status, cuerpo));
    err.status = res.status;
    err.limites = limitesDe(res.headers);
    throw err;
  }
  return { datos: desenvolver(cuerpo), limites: limitesDe(res.headers) };
}

// Valida el token sin traer datos de nadie.
export function identidad(opts) {
  return pedir('/v2/me', opts);
}

// Detalle de una empresa. Devuelve, entre otras cosas, `name`, `rut` y `dv`.
export function empresa(rut, opts) {
  return pedir(`/v2/companies/${encodeURIComponent(rutCompania(rut))}`, opts);
}

// DTE sincronizados desde el SII. `recibidos: true` = libro de compras
// (facturas de proveedores); `false` = libro de ventas.
export function dtes({ rut, recibidos, desde, hasta, tipoSii, excluirTipos, limite = 100, offset = 0 }, opts) {
  return pedir('/v2/obligations/dte', {
    ...opts,
    params: {
      company_rut: rutCompania(rut),
      is_received: recibidos,
      date_from: desde,
      date_to: hasta,
      sii_code: tipoSii,
      sii_code_exclude: Array.isArray(excluirTipos) ? excluirTipos.join(',') : excluirTipos,
      limit: Math.min(limite, MAX_LIMITE),
      offset,
    },
  });
}

// Líneas de detalle de los DTE. `date_from` es obligatorio en esta ruta.
// No incluye boletas (39) ni guías de despacho (52), según la especificación.
export function productosPorDocumento({ rut, recibidos, desde, hasta, limite = 100, offset = 0 }, opts) {
  if (!desde) throw new Error('productosPorDocumento exige `desde` (date_from)');
  return pedir('/v2/obligations/products', {
    ...opts,
    params: {
      company_rut: rutCompania(rut),
      is_received: recibidos,
      date_from: desde,
      date_to: hasta,
      limit: Math.min(limite, MAX_LIMITE),
      offset,
    },
  });
}
