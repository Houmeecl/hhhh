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
import { normalizarDigitosOcr } from './textoOcr.js';

// RUT chileno con o sin puntos, tolerante a confusiones de OCR en los
// dígitos (O/o→0, l/I→1): 76.123.456-0 / 76l23456-O. La tolerancia es
// solo léxica — el módulo 11 valida después de normalizar, así que una
// palabra real jamás pasa por RUT.
const RUT_RE = /\b([\dOoIl]{1,2}(?:\.[\dOoIl]{3}){2}|[\dOoIl]{7,9})\s*-\s*([\dOoIlkK])\b/g;
// "TOTAL", "MONTO TOTAL", "TOTAL A PAGAR: $ …" — hasta 15 caracteres no
// numéricos entre la palabra y el monto (también calza dentro de SUBTOTAL;
// se resuelve tomando el MAYOR de todos los montos encontrados). El hueco
// excluye O/o/l/I para no comerse el primer "dígito" mal leído del monto.
const TOTAL_RE = /TOTAL[^0-9OoIl]{0,15}\$?\s*([\d.,OoIl]+)/gi;
// Folio: "FACTURA 4521", "FOLIO: 4521", "N° 4521", "Nº #4521".
const FOLIO_RE = /(?:FACTURA|FOLIO|N[°º])\s*:?\s*#?(\d{1,10})/i;
// Fecha dd-mm-aaaa o dd/mm/aaaa.
const FECHA_RE = /\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/;
// Monto al final de una línea, precedido de espacio o inicio (así se
// descartan colas de fechas «…/2026» y dígitos verificadores «…-0»).
// Tolera O/l/I de OCR; el llamador exige al menos un dígito real.
const MONTO_FINAL_RE = /(?:^|\s)\$?\s*([\d.,OoIl]+)\s*$/;
// Líneas de totales/impuestos/identificación/encabezado/descuento: no son
// ítems (el número final de "FACTURA … N° 4521" es un folio, no un monto;
// una línea de descuento no es un ítem nuevo, es un ajuste del anterior).
const LINEA_EXCLUIDA_RE = /\b(?:SUB)?TOTAL\b|\bIVA\b|\bNETO\b|R\.?U\.?T|\bFACTURA\b|\bFOLIO\b|\bBOLETA\b|\bGU[IÍ]A\b|\bD?E?SCTO\.?\b|\bDESCUENTO\b/i;

const MONTO_MINIMO_ITEM = 1000; // ≥ $1.000 CLP para considerar la línea un ítem.

// "1.190.000" → 1190000 · "1.190.000,50" → 1190000.5 (formato chileno:
// punto de miles, coma decimal). También tolera el formato inverso
// ("1,190,000.50", miles con coma y decimal con punto) por si el
// documento viene de un layout no chileno: el separador DECIMAL es el
// último que aparece con 1-2 dígitos detrás; el otro se trata como miles.
// Devuelve 0 si no es un número.
export function parsearMontoChileno(s) {
  let t = String(s ?? '').trim().replace(/^\$\s*/, '').replace(/[.,]+$/, '');
  if (!t) return 0;
  const iPunto = t.lastIndexOf('.');
  const iComa = t.lastIndexOf(',');
  const iDecimal = Math.max(iPunto, iComa);
  if (iDecimal !== -1 && t.length - iDecimal - 1 >= 1 && t.length - iDecimal - 1 <= 2) {
    const separadorMiles = t[iDecimal] === ',' ? '.' : ',';
    t = t.slice(0, iDecimal).split(separadorMiles).join('') + '.' + t.slice(iDecimal + 1);
  } else {
    t = t.replace(/[.,]/g, '');
  }
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// RUTs válidos (módulo 11) en orden de aparición, normalizados sin puntos.
// Un token de puras letras no es un RUT mal leído: se exige ≥1 dígito real
// antes de normalizar las confusiones de OCR.
function extraerRuts(texto) {
  const vistos = new Set();
  const ruts = [];
  for (const m of texto.matchAll(RUT_RE)) {
    if (!/\d/.test(m[1])) continue;
    const cuerpo = normalizarDigitosOcr(m[1]).replace(/\./g, '');
    const dv = normalizarDigitosOcr(m[2]).toUpperCase();
    const normalizado = `${cuerpo}-${dv}`;
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
    if (!/\d/.test(m[1])) continue; // puras letras: no es un monto mal leído
    const monto = parsearMontoChileno(normalizarDigitosOcr(m[1]));
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
    if (!/\d/.test(m[1])) continue; // puras letras: no es un monto mal leído
    const monto = parsearMontoChileno(normalizarDigitosOcr(m[1]));
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

// a cuadra con b dentro de una tolerancia del 5%.
const cuadra = (a, b) => b > 0 && Math.abs(a - b) <= b * 0.05;

/**
 * Parsea el texto plano de una factura chilena.
 * Devuelve { folio, rut_emisor, rut_receptor, fecha, monto_total, items,
 * senal_suficiente, verificaciones }. Los ítems tienen el mismo shape que
 * los de parseDte, listos para motorPropio.calcularFactura.
 *
 * opciones.rutReceptorEsperado: RUT del cliente que inició el trámite
 * (identidad del formulario, no dato de factura). Si aparece entre los
 * RUTs extraídos, se fija como receptor y el otro como emisor — corrige
 * la asignación posicional cuando el layout lista primero al receptor.
 */
export function parsearFacturaTexto(texto, { rutReceptorEsperado } = {}) {
  const t = typeof texto === 'string' ? texto : '';
  const ruts = extraerRuts(t);
  const montoTotal = extraerMontoTotal(t);
  const folioMatch = t.match(FOLIO_RE);

  let rutEmisor = ruts[0] || null;
  let rutReceptor = ruts[1] || null;
  const esperado = rutReceptorEsperado
    ? String(rutReceptorEsperado).replace(/\./g, '').toUpperCase().trim()
    : null;
  if (esperado && ruts.includes(esperado)) {
    rutReceptor = esperado;
    rutEmisor = ruts.find((r) => r !== esperado) || null;
  }

  let items = extraerItems(t);

  // Verificación cruzada (paridad con dte.js): la suma de ítems debe
  // cuadrar con el total (con IVA) o con el neto (total/1,19). Si el OCR
  // duplicó líneas (sobreconteo) o perdió la mayoría (subconteo), se
  // colapsa al ítem único por el total: se pierde granularidad de
  // clasificación pero el CO2e queda anclado al total real del documento
  // — nunca se infla ni se inventa.
  let verificaciones = null;
  if (montoTotal > 0 && items.length >= 2) {
    const sumaItems = items.reduce((a, it) => a + it.monto, 0);
    const cuadraConTotal = cuadra(sumaItems, montoTotal);
    const cuadraConNeto = cuadra(sumaItems, montoTotal / 1.19);
    const sobreconteo = sumaItems > montoTotal * 1.05;
    const subconteo = sumaItems < montoTotal * 0.5;
    let colapsado = false;
    if (!cuadraConTotal && !cuadraConNeto && (sobreconteo || subconteo)) {
      items = [];
      colapsado = true;
    }
    verificaciones = {
      suma_items: sumaItems,
      cuadra_con_total: cuadraConTotal,
      cuadra_con_neto: cuadraConNeto,
      colapsado,
    };
  }

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
    rut_emisor: rutEmisor,
    rut_receptor: rutReceptor,
    fecha: extraerFecha(t),
    monto_total: montoTotal,
    items,
    senal_suficiente: montoTotal > 0,
    verificaciones,
  };
}
