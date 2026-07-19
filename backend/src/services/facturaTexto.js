// ============================================================
// Parser PURO de facturas en texto plano (salida de pdf-parse o de OCR).
// Extrae folio, RUTs (validados módulo 11), fecha, monto total e ítems
// con el MISMO shape que los ítems de services/dte.js, para alimentar
// motorPropio.calcularFactura sin adaptadores.
//
// Regla de oro: NUNCA inventar. `senal_suficiente` solo es true si se
// encontró un monto total real (> 0); sin señal, el llamador debe caer
// al motor externo.
// ============================================================

import { rutValido } from './dte.js';

// RUT chileno con o sin puntos: 76.123.456-0 / 76123456-0.
const RUT_RE = /\b(\d{1,2}(?:\.\d{3}){2}|\d{7,9})\s*-\s*([\dkK])\b/g;
// "TOTAL", "MONTO TOTAL", "TOTAL A PAGAR: $ …" — hasta 15 caracteres no
// numéricos entre la palabra y el monto (también calza dentro de SUBTOTAL;
// se resuelve tomando el MAYOR de todos los montos encontrados).
const TOTAL_RE = /TOTAL[^0-9]{0,15}\$?\s*([\d.,]+)/gi;
// Folio: "FACTURA 4521", "FOLIO: 4521", "N° 4521", "Nº #4521".
const FOLIO_RE = /(?:FACTURA|FOLIO|N[°º])\s*:?\s*#?(\d{1,10})/i;
// Fecha dd-mm-aaaa o dd/mm/aaaa.
const FECHA_RE = /\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/;
// Monto al final de una línea, precedido de espacio o inicio (así se
// descartan colas de fechas «…/2026» y dígitos verificadores «…-0»).
const MONTO_FINAL_RE = /(?:^|\s)\$?\s*([\d.,]+)\s*$/;
// Líneas de totales/impuestos/identificación/encabezado: no son ítems
// (el número final de "FACTURA … N° 4521" es un folio, no un monto).
const LINEA_EXCLUIDA_RE = /\b(?:SUB)?TOTAL\b|\bIVA\b|\bNETO\b|R\.?U\.?T|\bFACTURA\b|\bFOLIO\b|\bBOLETA\b|\bGU[IÍ]A\b/i;

const MONTO_MINIMO_ITEM = 1000; // ≥ $1.000 CLP para considerar la línea un ítem.

// "1.190.000" → 1190000 · "1.190.000,50" → 1190000.5 (formato chileno:
// punto de miles, coma decimal). Devuelve 0 si no es un número.
export function parsearMontoChileno(s) {
  let t = String(s ?? '').trim().replace(/^\$\s*/, '').replace(/[.,]+$/, '');
  if (!t) return 0;
  const coma = t.lastIndexOf(',');
  if (coma !== -1 && t.length - coma - 1 <= 2) {
    t = t.slice(0, coma).replace(/[.,]/g, '') + '.' + t.slice(coma + 1);
  } else {
    t = t.replace(/[.,]/g, '');
  }
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// RUTs válidos (módulo 11) en orden de aparición, normalizados sin puntos.
function extraerRuts(texto) {
  const vistos = new Set();
  const ruts = [];
  for (const m of texto.matchAll(RUT_RE)) {
    const normalizado = `${m[1].replace(/\./g, '')}-${m[2].toUpperCase()}`;
    if (vistos.has(normalizado)) continue;
    if (!rutValido(normalizado)) continue;
    vistos.add(normalizado);
    ruts.push(normalizado);
  }
  return ruts;
}

function extraerMontoTotal(texto) {
  let mayor = 0;
  for (const m of texto.matchAll(TOTAL_RE)) {
    const monto = parsearMontoChileno(m[1]);
    if (monto >= mayor) mayor = monto; // el mayor; en empate, el último.
  }
  return mayor;
}

function extraerFecha(texto) {
  const m = texto.match(FECHA_RE);
  if (!m) return null;
  const [, dd, mm, aaaa] = m;
  const dia = Number(dd), mes = Number(mm);
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;
  return `${aaaa}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function contarLetras(s) {
  return (s.match(/\p{L}/gu) || []).length;
}

// Ítems: líneas con un monto real al final y una glosa con ≥3 letras.
function extraerItems(texto) {
  const items = [];
  for (const cruda of texto.split(/\r?\n/)) {
    const linea = cruda.trim();
    if (!linea || LINEA_EXCLUIDA_RE.test(linea)) continue;
    const m = linea.match(MONTO_FINAL_RE);
    if (!m) continue;
    const monto = parsearMontoChileno(m[1]);
    if (monto < MONTO_MINIMO_ITEM) continue;
    const glosa = linea.slice(0, m.index).trim();
    if (contarLetras(glosa) < 3) continue;
    // Cantidad: solo si la línea parte con un número ("2 Toner láser …").
    const mCant = glosa.match(/^(\d+(?:[.,]\d+)?)\s+/);
    items.push({
      nombre: glosa.slice(0, 80),
      descripcion: null,
      cantidad: mCant ? parsearMontoChileno(mCant[1]) || 1 : 1,
      unidad: null, // el texto plano no trae unidad confiable → método por gasto.
      monto,
    });
  }
  return items;
}

/**
 * Parsea el texto plano de una factura chilena.
 * Devuelve { folio, rut_emisor, rut_receptor, fecha, monto_total, items,
 * senal_suficiente }. Los ítems tienen el mismo shape que los de parseDte,
 * listos para motorPropio.calcularFactura.
 */
export function parsearFacturaTexto(texto) {
  const t = typeof texto === 'string' ? texto : '';
  const ruts = extraerRuts(t);
  const montoTotal = extraerMontoTotal(t);
  const folioMatch = t.match(FOLIO_RE);

  let items = extraerItems(t);
  // Sin líneas útiles pero con total real → un único ítem por el total,
  // suficiente para el método por gasto (spend-based).
  if (items.length === 0 && montoTotal > 0) {
    items = [{
      nombre: 'Documento (texto extraído)',
      descripcion: null,
      cantidad: 1,
      unidad: null,
      monto: montoTotal,
    }];
  }

  return {
    folio: folioMatch ? folioMatch[1] : null,
    rut_emisor: ruts[0] || null,
    rut_receptor: ruts[1] || null,
    fecha: extraerFecha(t),
    monto_total: montoTotal,
    items,
    senal_suficiente: montoTotal > 0,
  };
}
