import fs from 'fs';
import crypto from 'crypto';
import { config } from '../config.js';

// ============================================================
// Export a BigQuery — todo lo que se escanea se replica al
// data warehouse para análisis y cruces a gran escala.
//
// Sin dependencias: autenticación con la cuenta de servicio
// (JWT RS256 → token OAuth) e ingesta vía streaming insertAll.
// Apagado por defecto (BIGQUERY_EXPORT=false): si está apagado
// o falla, NUNCA afecta el flujo principal — solo se registra
// en el log. El esquema del dataset está en backend/bigquery/.
// ============================================================

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/bigquery.insertdata';

let credCache = null;   // cuenta de servicio parseada
let tokenCache = null;  // { token, exp }

function loadCredentials() {
  if (credCache) return credCache;
  if (!config.bigquery.keyFile) throw new Error('BQ_KEY_FILE no configurado');
  credCache = JSON.parse(fs.readFileSync(config.bigquery.keyFile, 'utf8'));
  return credCache;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

// Token OAuth de la cuenta de servicio (JWT RS256 firmado localmente).
async function getToken() {
  if (tokenCache && tokenCache.exp > Date.now() / 1000 + 60) return tokenCache.token;
  const cred = loadCredentials();
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: cred.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600,
  }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(cred.private_key, 'base64url');
  const assertion = `${header}.${claims}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`OAuth ${res.status}`);
  const data = await res.json();
  tokenCache = { token: data.access_token, exp: now + (data.expires_in || 3600) };
  return tokenCache.token;
}

// Streaming insert a una tabla del dataset.
async function insertAll(table, rows) {
  const { projectId, dataset } = config.bigquery;
  const token = await getToken();
  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/datasets/${dataset}/tables/${table}/insertAll`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rows: rows.map((r) => ({ insertId: r.id || crypto.randomUUID(), json: r })),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.insertErrors?.length) {
    throw new Error(`insertAll ${table}: ${res.status} ${JSON.stringify(data.insertErrors || data.error || '')}`);
  }
}

// ---------- Mapeo de filas (exportado para poder testearlo) ----------
const rutNorm = (r) => (r ? String(r).replace(/[^0-9kK]/g, '').toUpperCase() : null);

export function rowFactura(factura, sesion) {
  return {
    id: factura.id,
    sesion_id: factura.sesion_id,
    numero_venta: factura.numero_venta || null,
    archivo_original: factura.archivo_original || null,
    rut_emisor: rutNorm(factura.rut_emisor),
    rut_receptor: rutNorm(factura.rut_receptor),
    rut_cliente: rutNorm(sesion?.rut_cliente),
    empresa_cliente: sesion?.nombre_cliente || null,
    categoria: factura.categoria || null,
    total_co2e: Number(factura.total_co2e || 0),
    origen: 'flujo_publico',
    hash_documento: factura.hash_documento || null,
    hash_anterior: factura.hash_anterior || null,
    hash_cadena: factura.hash_cadena || null,
    eslabon: factura.eslabon != null ? Number(factura.eslabon) : null,
    created_at: new Date(factura.created_at || Date.now()).toISOString(),
  };
}

export function rowLineItem(item, facturaId) {
  return {
    factura_id: facturaId,
    descripcion: item.descripcion || null,
    cantidad: Number(item.cantidad || 0),
    co2e: Number(item.co2e || 0),
    porcentaje_total: Number(item.porcentaje_total || 0),
  };
}

// Declaración de embalaje REP (Ley 20.920) — una por sesión; un re-POST
// que reemplaza la declaración genera una fila nueva en el warehouse
// (misma id de declaración, insertId distinto por created_at), así el
// historial de cambios queda trazable en BigQuery aunque en Postgres
// solo viva la versión vigente.
export function rowDeclaracionEmbalaje(decl, sesion) {
  return {
    id: decl.id,
    sesion_id: decl.sesion_id,
    rut_cliente: rutNorm(sesion?.rut_cliente),
    componentes: JSON.stringify(decl.componentes || []),
    n_componentes: Array.isArray(decl.componentes) ? decl.componentes.length : 0,
    peso_total_gr: Number(decl.peso_total_gr || 0),
    peso_reciclable_gr: Number(decl.peso_reciclable_gr || 0),
    porcentaje: Number(decl.porcentaje || 0),
    nivel: decl.nivel || null,
    created_at: new Date(decl.created_at || Date.now()).toISOString(),
  };
}

// Compensación del POS de mostrador — una por sesión en Postgres; un
// re-cobro del mismo trámite reemplaza la fila allá, pero acá cada
// versión queda como fila propia (insertId id+created_at, mismo patrón
// que las declaraciones de embalaje): el historial de cobros es trazable.
export function rowCompensacion(comp, sesion) {
  return {
    id: comp.id,
    sesion_id: comp.sesion_id,
    rut_cliente: rutNorm(sesion?.rut_cliente),
    terminal_id: comp.terminal_id || null,
    t_co2e: Number(comp.t_co2e || 0),
    tarifa_clp_tco2e: Number(comp.tarifa_clp_tco2e || 0),
    monto_clp: Number(comp.monto_clp || 0),
    metodo: comp.metodo || null,
    estado: comp.estado || null,
    created_at: new Date(comp.created_at || Date.now()).toISOString(),
  };
}

export function rowDocumentoCorredor(doc) {
  return {
    id: doc.id,
    pais_origen: doc.pais_origen || null,
    pais_destino: doc.pais_destino || null,
    tramo: doc.tramo || null,
    tipo_documento: doc.tipo_documento,
    numero_documento: doc.numero_documento || null,
    rut_emisor: rutNorm(doc.rut_emisor),
    rut_receptor: rutNorm(doc.rut_receptor),
    metodologia_pais: doc.metodologia_pais || null,
    estado: doc.estado,
    categoria: doc.categoria || null,
    total_co2e: Number(doc.total_co2e || 0),
    origen: 'corredor',
    created_at: new Date(doc.created_at || Date.now()).toISOString(),
  };
}

// "Sube y Suma" — capa de gamificación. Las tres tablas son append-only
// (nunca se actualizan tras crearse, salvo `trayectos` que se cierra una
// sola vez con llegada_at/puntos — se exporta ya cerrado), así que usan el
// insertId implícito (= id de la fila), sin el patrón id-created_at que sí
// necesitan declaraciones_embalaje/compensaciones (esas sí se reemplazan).
export function rowPuntosEvento(evento) {
  return {
    id: evento.id,
    jugador_id: evento.jugador_id,
    tipo: evento.tipo,
    puntos: Number(evento.puntos || 0),
    factura_id: evento.factura_id || null,
    mision_id: evento.mision_id || null,
    trayecto_id: evento.trayecto_id || null,
    created_at: new Date(evento.created_at || Date.now()).toISOString(),
  };
}

export function rowCanje(canje) {
  return {
    id: canje.id,
    jugador_id: canje.jugador_id,
    recompensa_id: canje.recompensa_id,
    puntos_gastados: Number(canje.puntos_gastados || 0),
    serial: canje.serial || null,
    hash: canje.hash || null,
    created_at: new Date(canje.created_at || Date.now()).toISOString(),
  };
}

export function rowTrayecto(trayecto) {
  return {
    id: trayecto.id,
    jugador_id: trayecto.jugador_id,
    salida_at: new Date(trayecto.salida_at || Date.now()).toISOString(),
    llegada_at: trayecto.llegada_at ? new Date(trayecto.llegada_at).toISOString() : null,
    modo_transporte: trayecto.modo_transporte || null,
    puntos: Number(trayecto.puntos || 0),
    created_at: new Date(trayecto.created_at || Date.now()).toISOString(),
  };
}

// Evento de auditoría: alguien (staff o mandante) cruzó datos de una
// contraparte. `actor` = { tipo: 'usuario'|'mandante', id }.
export function rowAcceso({ tipo, actor, rut_consultado, detalle }) {
  return {
    id: crypto.randomUUID(),
    tipo,
    actor_tipo: actor?.tipo || 'usuario',
    actor_id: actor?.id || null,
    rut_consultado: rut_consultado || null,
    detalle: detalle ? JSON.stringify(detalle) : null,
    created_at: new Date().toISOString(),
  };
}

// ---------- API del servicio (fire-and-forget, nunca lanza) ----------
async function exportar(table, rows) {
  if (!config.bigquery.enabled || !rows.length) return false;
  try {
    await insertAll(table, rows);
    return true;
  } catch (e) {
    console.warn(`[bigquery] export a ${table} falló (no afecta el flujo):`, e.message);
    return false;
  }
}

export const bigquery = {
  get enabled() { return config.bigquery.enabled; },

  // Sesión pública completa: facturas + ítems.
  exportSesion({ sesion, facturas }) {
    const fRows = (facturas || []).map((f) => rowFactura(f, sesion));
    const iRows = (facturas || []).flatMap((f) => (f.items || []).map((it) => rowLineItem(it, f.id)));
    return Promise.all([exportar('facturas', fRows), exportar('line_items', iRows)]);
  },

  exportDocumentoCorredor(doc) {
    return exportar('documentos_corredor', [rowDocumentoCorredor(doc)]);
  },

  // La declaración REP se exporta al guardarse/reemplazarse (el insertId
  // usa id+created_at para que cada versión quede como fila propia).
  exportDeclaracionEmbalaje(decl, sesion) {
    const row = rowDeclaracionEmbalaje(decl, sesion);
    row.insertId = `${row.id}-${row.created_at}`;
    return exportar('declaraciones_embalaje', [row]);
  },

  // La compensación del POS se exporta al registrarse/reemplazarse
  // (insertId id+created_at → cada versión del cobro es fila propia).
  exportCompensacion(comp, sesion) {
    const row = rowCompensacion(comp, sesion);
    row.insertId = `${row.id}-${row.created_at}`;
    return exportar('compensaciones', [row]);
  },

  // Auditoría de cruces de datos (routes/buscar.js, routes/mandante.js).
  // Copia externa opt-in del mismo evento que ya queda en actividad_log.
  exportAcceso({ tipo, actor, rut_consultado, detalle }) {
    return exportar('accesos_cruce', [rowAcceso({ tipo, actor, rut_consultado, detalle })]);
  },

  // "Sube y Suma": evento de puntaje (documento escaneado, misión
  // completada, trayecto registrado) — se exporta después del commit de
  // la transacción que lo generó (ver routes/public.js y routes/juego.js).
  exportPuntosEvento(evento) {
    return exportar('puntos_eventos', [rowPuntosEvento(evento)]);
  },

  // Canje de una recompensa simbólica.
  exportCanje(canje) {
    return exportar('canjes', [rowCanje(canje)]);
  },

  // Trayecto ya cerrado (con llegada_at/puntos) — un trayecto recién
  // abierto no se exporta, no aporta nada analizable todavía.
  exportTrayecto(trayecto) {
    return exportar('trayectos', [rowTrayecto(trayecto)]);
  },
};
