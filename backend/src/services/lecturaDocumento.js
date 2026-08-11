import { createHash } from 'node:crypto';
import { parseDte, rutValido } from './dte.js';
import { normalizarRut } from './mandante.js';
import {
  extraerTextoPdf, extraerTextoImagenBuffer, ocrDisponible,
  extraerTextoPdfEscaneado, extraerTextoHeicBuffer,
} from './extractorTexto.js';
import { parsearFacturaTexto, detectarTipoNoCalculable } from './facturaTexto.js';
import { evaluarItems } from './motorPropio.js';
import { analisisIA } from './analisisIA.js';

// ============================================================
// Lectura automática de un documento — la cascada de decisión
// que antes vivía inline en routes/public.js. Extraerla permite:
//  (a) correr la lectura ANTES de la transacción de sesión (el
//      lock de cadena_estado pasa de minutos de OCR a milisegundos),
//  (b) registrar los rechazos fuera de la transacción, y
//  (c) testearla sin HTTP.
//
// Orden por archivo — cada camino cae al siguiente si no logra
// señal real:
//  0) Tipo no calculable (XML o encabezado de texto/OCR)
//                                  → { tipo:'rechazo', motivo:'tipo_documento_no_calculable' }
//     (orden de compra, cotización, guía de despacho, nota de crédito/
//     débito, liquidación: NUNCA se calculan como factura nueva —
//     duplicarían o distorsionarían el CO2e si el cliente entrega varios
//     documentos del mismo despacho)
//  1) XML con ítems reales        → { tipo:'xml', dte }
//  2) PDF con capa de texto       → IA primero (análisis flexible),
//     respaldo con reglas (regex) si la IA no está disponible/falla
//                                  → { tipo:'texto', motor:'propio_ia'|'propio_texto' }
//  3) PDF escaneado (raster+OCR)  → ídem                → motor:'propio_ia'|'propio_ocr'
//  4) JPG/PNG con OCR local       → ídem                → motor:'propio_ia'|'propio_ocr'
//  5) HEIC (heif-convert + OCR)   → ídem                → motor:'propio_ia'|'propio_ocr'
//  6) sin señal                   → { tipo:'sin_senal', etapa }
//     (el llamador decide: motor externo si está activo, o rechazo —
//      jamás corrección manual).
// ============================================================

export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

// DTE cuyo tipo NO es un gasto directo: modifican o reversan un documento
// previo (Nota de Débito 56 / Nota de Crédito 61 — una NC real trae montos
// POSITIVOS que representan lo reversado, no negativos: calcularla como
// factura nueva SUMARÍA en vez de anular), liquidan una factura ya emitida
// (Liquidación de Factura 43) o no representan un gasto en sí (Guía de
// Despacho 52). Netear NC/ND contra su documento original es otra ronda
// (requiere localizarlo); mientras tanto se rechaza explícito en vez de
// adivinar — nunca duplicar ni distorsionar el CO2e ya contabilizado.
const TIPOS_DTE_NO_CALCULABLES = new Set([43, 52, 56, 61]);

// Valida los ítems ya extraídos: un monto sobre el tope del motor es
// lectura corrupta → rechazo duro (aunque el motor externo esté activo);
// si TODOS los ítems quedan descartados (negativos / sin datos), el
// documento no tiene señal calculable.
function validarItems(items, base) {
  const { calculables, fueraDeRango } = evaluarItems(items);
  if (fueraDeRango) return { tipo: 'rechazo', motivo: 'monto_fuera_de_rango', etapa: base.etapa, dte: base.dte || null };
  if (calculables.length === 0) return { tipo: 'sin_senal', etapa: base.etapa, dte: base.dte || null };
  return null; // válido
}

// Orden de compra, cotización, guía de despacho, etc. fotografiadas o en
// PDF plano no traen TipoDTE (solo el XML lo tiene) — sin este chequeo el
// parser de texto las leería igual que una factura nueva por tener
// glosas y montos "válidos". Si el cliente entrega Guía + Orden de Compra
// + Factura del mismo despacho, solo la Factura debe contar.
function rechazoPorTipoTexto(texto, etapa) {
  const tipo = detectarTipoNoCalculable(texto);
  return tipo ? { tipo: 'rechazo', motivo: 'tipo_documento_no_calculable', etapa, tipo_detectado: tipo } : null;
}

// Intenta leer el texto extraído (capa de PDF u OCR) con IA primero — más
// flexible ante layouts raros y ruido de OCR que el parser de reglas — y
// cae al parser de reglas si la IA no está disponible, falla, o no logra
// señal suficiente. `analizarIA` es inyectable (por defecto
// analisisIA.analizarTexto) para poder testear la cascada sin red.
// Devuelve un resultado de leerDocumento, o null si ni la IA ni las
// reglas lograron señal en ESTE intento (el llamador decide si reintenta
// con otro PSM o sigue cayendo al siguiente formato).
async function leerTexto(texto, etapa, opts, analizarIA) {
  const ia = await analizarIA(texto).catch(() => null);
  if (ia) {
    if (ia.tipo_no_calculable) {
      return { tipo: 'rechazo', motivo: 'tipo_documento_no_calculable', etapa, tipo_detectado: ia.tipo_no_calculable };
    }
    if (ia.senal_suficiente) {
      return validarItems(ia.items, { etapa }) || { tipo: 'texto', textoParseado: ia, motor: 'propio_ia', etapa };
    }
  }
  const rechazoTipo = rechazoPorTipoTexto(texto, etapa);
  if (rechazoTipo) return rechazoTipo;
  const p = parsearFacturaTexto(texto, opts);
  if (p.senal_suficiente) {
    const motor = etapa === 'pdf_texto' ? 'propio_texto' : 'propio_ocr';
    return validarItems(p.items, { etapa }) || { tipo: 'texto', textoParseado: p, motor, etapa };
  }
  return null;
}

export async function leerDocumento(buffer, nombreArchivo, { rutReceptorEsperado, analizarIA = analisisIA.analizarTexto.bind(analisisIA) } = {}) {
  const opts = { rutReceptorEsperado };

  // 1) DTE XML: datos reales del documento (folio, RUT, ítems). Un XML
  //    sin ítems no tiene señal propia, pero conserva el dte parseado
  //    (folio/RUTs) por si el motor externo completa el cálculo. La IA
  //    no participa aquí: el XML ya es dato estructurado del SII, sin
  //    ambigüedad que resolver.
  if (/\.xml$/i.test(nombreArchivo)) {
    const dte = parseDte(buffer.toString('utf8'));
    if (dte && TIPOS_DTE_NO_CALCULABLES.has(dte.tipo_dte)) {
      return { tipo: 'rechazo', motivo: 'tipo_documento_no_calculable', etapa: 'xml', dte };
    }
    if (dte && dte.items?.length) {
      const invalido = validarItems(dte.items, { etapa: 'xml', dte });
      if (invalido) return invalido;
      return { tipo: 'xml', dte, etapa: 'xml' };
    }
    return { tipo: 'sin_senal', dte: dte || null, etapa: 'xml' };
  }

  // Los caminos de texto/OCR intentan la IA primero (leerTexto) y caen al
  // parser de reglas si no está disponible o no logra señal; los caminos
  // OCR además reintentan UNA vez con --psm 3 (segmentación automática de
  // página) cuando el --psm 6 por defecto (bloque uniforme) no entrega
  // señal — facturas con tablas o dos columnas suelen recuperarse así.
  let etapa = 'ninguna';
  try {
    if (/\.pdf$/i.test(nombreArchivo)) {
      etapa = 'pdf_texto';
      const texto = await extraerTextoPdf(buffer);
      const r = await leerTexto(texto, etapa, opts, analizarIA);
      if (r) return r;
      // PDF sin capa de texto útil: rasterizar y leer con OCR.
      etapa = 'pdf_ocr';
      for (const psm of ['6', '3']) {
        const t = await extraerTextoPdfEscaneado(buffer, 2, psm);
        const r2 = await leerTexto(t, etapa, opts, analizarIA);
        if (r2) return r2;
      }
    } else if (/\.(jpe?g|png)$/i.test(nombreArchivo) && ocrDisponible()) {
      etapa = 'imagen_ocr';
      const ext = nombreArchivo.split('.').pop();
      for (const psm of ['6', '3']) {
        const t = await extraerTextoImagenBuffer(buffer, ext, psm);
        const r = await leerTexto(t, etapa, opts, analizarIA);
        if (r) return r;
      }
    } else if (/\.heic$/i.test(nombreArchivo)) {
      etapa = 'heic_ocr';
      for (const psm of ['6', '3']) {
        const t = await extraerTextoHeicBuffer(buffer, psm);
        const r = await leerTexto(t, etapa, opts, analizarIA);
        if (r) return r;
      }
    }
  } catch {
    // Cualquier falla de extracción → sin señal; el llamador decide.
  }
  return { tipo: 'sin_senal', etapa };
}

// ¿El documento está emitido a OTRO RUT que el del titular del envío?
// Devuelve true SOLO cuando hay evidencia firme: el documento trae un
// rut_receptor propio, que pasa módulo 11, y que normalizado NO coincide
// con el RUT del formulario. Sin receptor detectable, o con un receptor
// ilegible (basura de OCR que no pasa módulo 11), devuelve false —
// beneficio de la duda, el documento se asimila como siempre (evita
// falsos rechazos por mala lectura).
//
// Nota: en el camino de texto la asignación emisor/receptor puede venir
// invertida por el layout (facturaTexto.js la corrige solo si el RUT
// esperado aparece en el documento) — no importa para esta regla: si
// NINGUNO de los RUT del documento es el del titular, el que quede en
// rut_receptor será el de un tercero válido y el rechazo es correcto
// igual.
export function rutReceptorNoCalza(lectura, rutTitular) {
  if (!rutTitular) return false;
  // El XML es la evidencia más firme y también llega en lecturas
  // 'sin_senal' (XML sin ítems conserva el dte para el motor externo):
  // sin leerlo ahí, un XML ajeno sin ítems se asimilaba igual con el
  // motor externo activo — el mismo bug reportado, por una rendija.
  const receptor = (lectura?.tipo === 'xml' || lectura?.tipo === 'sin_senal')
    ? lectura?.dte?.rut_receptor
    : lectura?.tipo === 'texto'
      ? lectura.textoParseado?.rut_receptor
      : null; // 'rechazo': ya quedó fuera por su propio motivo
  if (!receptor) return false;
  const norm = normalizarRut(receptor);
  if (norm.length < 7 || norm.length > 9) return false;
  if (!rutValido(`${norm.slice(0, -1)}-${norm.slice(-1)}`)) return false;
  const titular = normalizarRut(rutTitular);
  // Camino de texto/IA: emisor y receptor pueden venir INTERCAMBIADOS
  // (el anclaje de facturaTexto.js solo corrige el swap si el RUT
  // esperado aparece; la IA no recibe esa pista). Si el titular figura
  // como EMISOR, lo probable es el swap, no un documento ajeno —
  // beneficio de la duda. En XML no aplica: RUTEmisor/RUTRecep son
  // campos estructurados del DTE, no una adivinanza posicional.
  if (lectura?.tipo === 'texto') {
    const emisor = normalizarRut(lectura.textoParseado?.rut_emisor || '');
    if (emisor && emisor === titular) return false;
  }
  return norm !== titular;
}

// Fila lista para insertar en documentos_rechazados (sin el binario:
// minimización por diseño — solo metadatos + sha256 del buffer).
export function filaRechazo(file, lectura, rutCliente, motivo = 'sin_senal') {
  return {
    nombre_archivo: file.originalname,
    extension: (file.originalname.split('.').pop() || '').toLowerCase().slice(0, 10),
    tamano_bytes: file.buffer?.length ?? null,
    sha256: sha256Hex(file.buffer || Buffer.alloc(0)),
    motivo,
    etapa_alcanzada: lectura?.etapa || 'ninguna',
    rut_cliente: rutCliente || null,
  };
}
