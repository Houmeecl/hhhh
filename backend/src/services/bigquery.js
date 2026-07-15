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
};
