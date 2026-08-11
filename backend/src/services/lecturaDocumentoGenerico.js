import {
  extraerTextoPdf, extraerTextoImagenBuffer, ocrDisponible,
  extraerTextoPdfEscaneado, extraerTextoHeicBuffer,
} from './extractorTexto.js';

// ============================================================
// Lectura de documentos de una Carga Bioceánica (lote_documentos) — NO
// reutiliza lecturaDocumento.js ni motorPropio.js/facturaTexto.js/
// analisisIA.js: esos asumen estructura de factura (folio, RUT, ítems,
// montos), y un packing list, una carta de porte o una foto de sello no
// tienen esa forma. Aquí solo se reutilizan los extractores de texto/OCR
// (extractorTexto.js) con un umbral mínimo de legibilidad.
//
// A diferencia del flujo público /cargar (que rechaza con 422 sin
// revisión posible), lo "sin_texto" aquí NO se descarta: el llamador
// (routes/origen.js) lo guarda en estado 'pendiente_revision' para que
// un humano de sicrep lo revise — esta es la única cola de revisión que
// existe en el proyecto, acotada a este flujo.
//
// Tipos con umbral de texto (deben traer contenido legible):
//   factura, packing_list, carta_porte, mic_dta, cert_origen, sag,
//   seguro, comprobante_frontera, otro
// Tipos con umbral liviano — puede ser solo una imagen sin texto
// (una foto del contenedor, un ticket de pesaje casi ilegible):
//   foto, pesaje  → solo se exige un archivo abrible, no longitud de texto.
// ============================================================

const TIPOS_SIN_UMBRAL_TEXTO = new Set(['foto', 'pesaje']);
const UMBRAL_CARACTERES = 15;

function tieneSenal(texto) {
  return (texto || '').replace(/\s+/g, '').length >= UMBRAL_CARACTERES;
}

// Sniff de cabecera — confirma que el buffer es del formato que dice ser,
// sin depender de extensión (un archivo corrupto/truncado no la pasa).
function esArchivoValido(buffer, nombreArchivo) {
  if (!buffer || buffer.length < 8) return false;
  const ext = (nombreArchivo.split('.').pop() || '').toLowerCase();
  const cab = buffer.subarray(0, 12);
  if (ext === 'pdf') return cab.subarray(0, 4).toString('latin1') === '%PDF';
  if (ext === 'jpg' || ext === 'jpeg') return cab[0] === 0xff && cab[1] === 0xd8;
  if (ext === 'png') return cab.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (ext === 'heic') return cab.subarray(4, 8).toString('latin1') === 'ftyp';
  return false;
}

export async function leerDocumentoGenerico(buffer, nombreArchivo, tipoDocumento) {
  if (TIPOS_SIN_UMBRAL_TEXTO.has(tipoDocumento)) {
    return esArchivoValido(buffer, nombreArchivo)
      ? { estado: 'leido', etapa: 'ninguna' }
      : { estado: 'sin_texto', etapa: 'ninguna' };
  }

  const nombre = nombreArchivo.toLowerCase();
  try {
    if (nombre.endsWith('.pdf')) {
      const texto = await extraerTextoPdf(buffer);
      if (tieneSenal(texto)) return { estado: 'leido', etapa: 'pdf_texto' };
      const rasterizado = await extraerTextoPdfEscaneado(buffer, 2, '6');
      if (tieneSenal(rasterizado)) return { estado: 'leido', etapa: 'pdf_ocr' };
      return { estado: 'sin_texto', etapa: 'pdf_ocr' };
    }
    if (/\.(jpe?g|png)$/.test(nombre) && ocrDisponible()) {
      const ext = nombre.split('.').pop();
      const texto = await extraerTextoImagenBuffer(buffer, ext, '6');
      return tieneSenal(texto)
        ? { estado: 'leido', etapa: 'imagen_ocr' }
        : { estado: 'sin_texto', etapa: 'imagen_ocr' };
    }
    if (nombre.endsWith('.heic')) {
      const texto = await extraerTextoHeicBuffer(buffer, '6');
      return tieneSenal(texto)
        ? { estado: 'leido', etapa: 'heic_ocr' }
        : { estado: 'sin_texto', etapa: 'heic_ocr' };
    }
  } catch {
    // Cualquier falla de extracción → sin señal; el llamador decide (revisión).
  }
  return { estado: 'sin_texto', etapa: 'ninguna' };
}
