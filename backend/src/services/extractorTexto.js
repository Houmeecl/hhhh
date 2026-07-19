// ============================================================
// Extracción de texto de documentos — motor propio para PDF e imágenes.
//
// - PDF: capa de texto con pdf-parse (sin OCR). Si el PDF es solo imagen
//   (sin capa de texto) devuelve '' y el llamador decide el siguiente paso.
// - Imagen (jpg/jpeg/png): OCR con tesseract del sistema, si está
//   instalado. HEIC y otros formatos quedan fuera → motor externo.
//
// Contrato honesto: cualquier falla devuelve '' — NUNCA se lanza hacia el
// flujo de sesiones. Sin texto no hay señal, y sin señal el llamador cae
// al motor externo (comportamiento actual intacto).
// ============================================================

import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const execFileAsync = promisify(execFile);

const OCR_TIMEOUT_MS = 30_000;
const EXTENSIONES_OCR = new Set(['.jpg', '.jpeg', '.png']);

// ---------- PDF (capa de texto, sin OCR) ----------

/**
 * Extrae la capa de texto de un PDF. Devuelve '' si el buffer no es un PDF
 * válido, está cifrado o no tiene texto (PDF escaneado como imagen).
 */
export async function extraerTextoPdf(buffer) {
  if (!buffer || !buffer.length) return '';
  let parser = null;
  try {
    const { PDFParse } = await import('pdf-parse');
    parser = new PDFParse({ data: new Uint8Array(buffer) });
    const resultado = await parser.getText();
    return typeof resultado?.text === 'string' ? resultado.text : '';
  } catch {
    return '';
  } finally {
    if (parser) await parser.destroy().catch(() => {});
  }
}

// ---------- OCR (tesseract del sistema) ----------

let _ocrDisponible = null; // cache: se pregunta una sola vez por proceso.

/** true si el binario `tesseract` está instalado y responde. */
export function ocrDisponible() {
  if (_ocrDisponible === null) {
    try {
      const r = spawnSync('tesseract', ['--version'], { timeout: 5000 });
      _ocrDisponible = r.status === 0;
    } catch {
      _ocrDisponible = false;
    }
  }
  return _ocrDisponible;
}

/**
 * OCR de una imagen en disco (solo jpg/jpeg/png). Devuelve el texto
 * reconocido o '' ante cualquier falla (archivo inexistente, formato no
 * soportado, tesseract ausente, timeout de 30 s).
 */
export async function extraerTextoImagen(rutaArchivo) {
  try {
    const ext = path.extname(String(rutaArchivo || '')).toLowerCase();
    if (!EXTENSIONES_OCR.has(ext)) return '';
    if (!ocrDisponible()) return '';
    const { stdout } = await execFileAsync(
      'tesseract',
      [rutaArchivo, 'stdout', '-l', 'spa+eng', '--psm', '6'],
      { timeout: OCR_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }
    );
    return stdout || '';
  } catch {
    return '';
  }
}

/**
 * OCR sobre un buffer en memoria (los archivos llegan por multer sin tocar
 * disco): escribe un temporal, corre tesseract y limpia siempre.
 * `extension` con o sin punto ('.png', 'jpg', …).
 */
export async function extraerTextoImagenBuffer(buffer, extension) {
  if (!buffer || !buffer.length) return '';
  const ext = String(extension || '').toLowerCase().replace(/^\.?/, '.');
  if (!EXTENSIONES_OCR.has(ext)) return '';
  const ruta = path.join(os.tmpdir(), `sicr3p-ocr-${crypto.randomUUID()}${ext}`);
  try {
    await fs.writeFile(ruta, buffer);
    return await extraerTextoImagen(ruta);
  } catch {
    return '';
  } finally {
    await fs.unlink(ruta).catch(() => {});
  }
}
