// ============================================================
// Extracción de texto de documentos — motor propio para PDF e imágenes.
//
// - PDF: capa de texto con pdf-parse (sin OCR). Si el PDF es solo imagen
//   (sin capa de texto) devuelve '' y el llamador decide el siguiente paso.
// - PDF escaneado: rasterizado local con pdftoppm (poppler-utils) y OCR
//   de las primeras páginas.
// - Imagen (jpg/jpeg/png): OCR con tesseract del sistema, si está instalado.
// - HEIC: conversión local a JPG con heif-convert (libheif-examples) y OCR.
//
// Contrato honesto: cualquier falla devuelve '' — NUNCA se lanza hacia el
// flujo de sesiones. Sin texto no hay señal, y sin señal el llamador cae
// al camino siguiente (motor externo, o rechazo del envío si está apagado).
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
export async function extraerTextoImagen(rutaArchivo, psm = '6') {
  try {
    const ext = path.extname(String(rutaArchivo || '')).toLowerCase();
    if (!EXTENSIONES_OCR.has(ext)) return '';
    if (!ocrDisponible()) return '';
    const { stdout } = await execFileAsync(
      'tesseract',
      [rutaArchivo, 'stdout', '-l', 'spa+eng', '--psm', String(psm)],
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
export async function extraerTextoImagenBuffer(buffer, extension, psm = '6') {
  if (!buffer || !buffer.length) return '';
  const ext = String(extension || '').toLowerCase().replace(/^\.?/, '.');
  if (!EXTENSIONES_OCR.has(ext)) return '';
  const ruta = path.join(os.tmpdir(), `sicr3p-ocr-${crypto.randomUUID()}${ext}`);
  try {
    await fs.writeFile(ruta, buffer);
    return await extraerTextoImagen(ruta, psm);
  } catch {
    return '';
  } finally {
    await fs.unlink(ruta).catch(() => {});
  }
}

// ---------- PDF escaneado (pdftoppm + OCR) ----------

let _rasterDisponible = null; // cache por proceso, igual que ocrDisponible.

/** true si el binario `pdftoppm` (poppler-utils) está instalado. */
export function rasterPdfDisponible() {
  if (_rasterDisponible === null) {
    try {
      const r = spawnSync('pdftoppm', ['-v'], { timeout: 5000 });
      // pdftoppm -v imprime la versión por stderr y sale con 0 ó 99 según
      // build; lo que importa es que el binario exista (sin ENOENT).
      _rasterDisponible = !r.error;
    } catch {
      _rasterDisponible = false;
    }
  }
  return _rasterDisponible;
}

/**
 * PDF sin capa de texto (escaneado): rasteriza las primeras `maxPaginas`
 * a PNG con pdftoppm (300 dpi) y les pasa OCR, concatenando el texto.
 * Devuelve '' si falta pdftoppm o tesseract, o ante cualquier falla.
 * Temporales SIEMPRE limpiados (incluso en timeout).
 */
export async function extraerTextoPdfEscaneado(buffer, maxPaginas = 2, psm = '6') {
  if (!buffer || !buffer.length) return '';
  if (!rasterPdfDisponible() || !ocrDisponible()) return '';
  const base = path.join(os.tmpdir(), `sicr3p-raster-${crypto.randomUUID()}`);
  const rutaPdf = `${base}.pdf`;
  try {
    await fs.writeFile(rutaPdf, buffer);
    await execFileAsync(
      'pdftoppm',
      ['-r', '300', '-gray', '-png', '-f', '1', '-l', String(maxPaginas), rutaPdf, base],
      { timeout: OCR_TIMEOUT_MS }
    );
    // pdftoppm nombra base-1.png, base-2.png… (o base-01.png según total).
    const dir = path.dirname(base);
    const prefijo = path.basename(base);
    const generados = (await fs.readdir(dir))
      .filter((f) => f.startsWith(`${prefijo}-`) && f.endsWith('.png'))
      .sort()
      .map((f) => path.join(dir, f));
    let texto = '';
    for (const png of generados) {
      texto += `${await extraerTextoImagen(png, psm)}\n`;
    }
    return texto.trim() ? texto : '';
  } catch {
    return '';
  } finally {
    await fs.unlink(rutaPdf).catch(() => {});
    // Limpieza de los PNG generados aunque el OCR haya fallado a medias.
    try {
      const dir = path.dirname(base);
      const prefijo = path.basename(base);
      for (const f of await fs.readdir(dir)) {
        if (f.startsWith(`${prefijo}-`) && f.endsWith('.png')) {
          await fs.unlink(path.join(dir, f)).catch(() => {});
        }
      }
    } catch { /* el tmpdir siempre existe; nada que hacer */ }
  }
}

// ---------- HEIC (heif-convert + OCR) ----------

let _heicDisponible = null;

/** true si el binario `heif-convert` (libheif-examples) está instalado. */
export function heicDisponible() {
  if (_heicDisponible === null) {
    try {
      const r = spawnSync('heif-convert', ['--version'], { timeout: 5000 });
      _heicDisponible = !r.error;
    } catch {
      _heicDisponible = false;
    }
  }
  return _heicDisponible;
}

/**
 * Foto HEIC (formato por defecto de iPhone): convierte a JPG local con
 * heif-convert y le pasa el OCR normal. Devuelve '' si falta el binario
 * o ante cualquier falla. Ambos temporales limpiados siempre.
 */
export async function extraerTextoHeicBuffer(buffer, psm = '6') {
  if (!buffer || !buffer.length) return '';
  if (!heicDisponible() || !ocrDisponible()) return '';
  const base = path.join(os.tmpdir(), `sicr3p-heic-${crypto.randomUUID()}`);
  const rutaHeic = `${base}.heic`;
  const rutaJpg = `${base}.jpg`;
  try {
    await fs.writeFile(rutaHeic, buffer);
    await execFileAsync('heif-convert', [rutaHeic, rutaJpg], { timeout: OCR_TIMEOUT_MS });
    return await extraerTextoImagen(rutaJpg, psm);
  } catch {
    return '';
  } finally {
    await fs.unlink(rutaHeic).catch(() => {});
    await fs.unlink(rutaJpg).catch(() => {});
  }
}
