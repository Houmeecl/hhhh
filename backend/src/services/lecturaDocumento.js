import { createHash } from 'node:crypto';
import { parseDte } from './dte.js';
import {
  extraerTextoPdf, extraerTextoImagenBuffer, ocrDisponible,
  extraerTextoPdfEscaneado, extraerTextoHeicBuffer,
} from './extractorTexto.js';
import { parsearFacturaTexto } from './facturaTexto.js';
import { evaluarItems } from './motorPropio.js';

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
//  1) XML con ítems reales        → { tipo:'xml', dte }
//  2) PDF con capa de texto       → { tipo:'texto', motor:'propio_texto' }
//  3) PDF escaneado (raster+OCR)  → { tipo:'texto', motor:'propio_ocr' }
//  4) JPG/PNG con OCR local       → { tipo:'texto', motor:'propio_ocr' }
//  5) HEIC (heif-convert + OCR)   → { tipo:'texto', motor:'propio_ocr' }
//  6) sin señal                   → { tipo:'sin_senal', etapa }
//     (el llamador decide: motor externo si está activo, o rechazo —
//      jamás corrección manual).
// ============================================================

export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

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

export async function leerDocumento(buffer, nombreArchivo, { rutReceptorEsperado } = {}) {
  const opts = { rutReceptorEsperado };

  // 1) DTE XML: datos reales del documento (folio, RUT, ítems). Un XML
  //    sin ítems no tiene señal propia, pero conserva el dte parseado
  //    (folio/RUTs) por si el motor externo completa el cálculo.
  if (/\.xml$/i.test(nombreArchivo)) {
    const dte = parseDte(buffer.toString('utf8'));
    if (dte && dte.items?.length) {
      const invalido = validarItems(dte.items, { etapa: 'xml', dte });
      if (invalido) return invalido;
      return { tipo: 'xml', dte, etapa: 'xml' };
    }
    return { tipo: 'sin_senal', dte: dte || null, etapa: 'xml' };
  }

  // Los caminos OCR reintentan UNA vez con --psm 3 (segmentación
  // automática de página) cuando el --psm 6 por defecto (bloque uniforme)
  // no entrega señal — facturas con tablas o dos columnas suelen
  // recuperarse con la segmentación automática.
  let etapa = 'ninguna';
  try {
    if (/\.pdf$/i.test(nombreArchivo)) {
      etapa = 'pdf_texto';
      const texto = await extraerTextoPdf(buffer);
      const p = parsearFacturaTexto(texto, opts);
      if (p.senal_suficiente) {
        return validarItems(p.items, { etapa }) || { tipo: 'texto', textoParseado: p, motor: 'propio_texto', etapa };
      }
      // PDF sin capa de texto útil: rasterizar y leer con OCR.
      etapa = 'pdf_ocr';
      for (const psm of ['6', '3']) {
        const t = await extraerTextoPdfEscaneado(buffer, 2, psm);
        const q = parsearFacturaTexto(t, opts);
        if (q.senal_suficiente) {
          return validarItems(q.items, { etapa }) || { tipo: 'texto', textoParseado: q, motor: 'propio_ocr', etapa };
        }
      }
    } else if (/\.(jpe?g|png)$/i.test(nombreArchivo) && ocrDisponible()) {
      etapa = 'imagen_ocr';
      const ext = nombreArchivo.split('.').pop();
      for (const psm of ['6', '3']) {
        const t = await extraerTextoImagenBuffer(buffer, ext, psm);
        const q = parsearFacturaTexto(t, opts);
        if (q.senal_suficiente) {
          return validarItems(q.items, { etapa }) || { tipo: 'texto', textoParseado: q, motor: 'propio_ocr', etapa };
        }
      }
    } else if (/\.heic$/i.test(nombreArchivo)) {
      etapa = 'heic_ocr';
      for (const psm of ['6', '3']) {
        const t = await extraerTextoHeicBuffer(buffer, psm);
        const q = parsearFacturaTexto(t, opts);
        if (q.senal_suficiente) {
          return validarItems(q.items, { etapa }) || { tipo: 'texto', textoParseado: q, motor: 'propio_ocr', etapa };
        }
      }
    }
  } catch {
    // Cualquier falla de extracción → sin señal; el llamador decide.
  }
  return { tipo: 'sin_senal', etapa };
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
