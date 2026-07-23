import { createHash } from 'node:crypto';
import { parseDte } from './dte.js';
import {
  extraerTextoPdf, extraerTextoImagenBuffer, ocrDisponible,
  extraerTextoPdfEscaneado, extraerTextoHeicBuffer,
} from './extractorTexto.js';
import { parsearFacturaTexto } from './facturaTexto.js';

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

export async function leerDocumento(buffer, nombreArchivo) {
  // 1) DTE XML: datos reales del documento (folio, RUT, ítems). Un XML
  //    sin ítems no tiene señal propia, pero conserva el dte parseado
  //    (folio/RUTs) por si el motor externo completa el cálculo.
  if (/\.xml$/i.test(nombreArchivo)) {
    const dte = parseDte(buffer.toString('utf8'));
    if (dte && dte.items?.length) return { tipo: 'xml', dte, etapa: 'xml' };
    return { tipo: 'sin_senal', dte: dte || null, etapa: 'xml' };
  }

  let etapa = 'ninguna';
  try {
    if (/\.pdf$/i.test(nombreArchivo)) {
      etapa = 'pdf_texto';
      let texto = await extraerTextoPdf(buffer);
      let p = parsearFacturaTexto(texto);
      if (p.senal_suficiente) return { tipo: 'texto', textoParseado: p, motor: 'propio_texto', etapa };
      // PDF sin capa de texto útil: rasterizar y leer con OCR.
      etapa = 'pdf_ocr';
      texto = await extraerTextoPdfEscaneado(buffer);
      p = parsearFacturaTexto(texto);
      if (p.senal_suficiente) return { tipo: 'texto', textoParseado: p, motor: 'propio_ocr', etapa };
    } else if (/\.(jpe?g|png)$/i.test(nombreArchivo) && ocrDisponible()) {
      etapa = 'imagen_ocr';
      const ext = nombreArchivo.split('.').pop();
      const texto = await extraerTextoImagenBuffer(buffer, ext);
      const p = parsearFacturaTexto(texto);
      if (p.senal_suficiente) return { tipo: 'texto', textoParseado: p, motor: 'propio_ocr', etapa };
    } else if (/\.heic$/i.test(nombreArchivo)) {
      etapa = 'heic_ocr';
      const texto = await extraerTextoHeicBuffer(buffer);
      const p = parsearFacturaTexto(texto);
      if (p.senal_suficiente) return { tipo: 'texto', textoParseado: p, motor: 'propio_ocr', etapa };
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
