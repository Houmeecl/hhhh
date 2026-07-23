// ============================================================
// Tests del cierre de independencia del motor (adiós Simple, parte 2):
// PDF escaneado (pdftoppm + OCR) y fotos HEIC (heif-convert + OCR).
//
// Los caminos que dependen de binarios del sistema se saltan declarándolo
// (t.skip) si el binario no está — nunca fallan por entorno. La migración
// 019 se audita por lectura (idempotencia y valores nuevos del CHECK).
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  extraerTextoPdfEscaneado, extraerTextoHeicBuffer,
  rasterPdfDisponible, heicDisponible, ocrDisponible,
} from '../src/services/extractorTexto.js';
import { parsearFacturaTexto } from '../src/services/facturaTexto.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PDF = path.join(__dirname, 'fixtures', 'factura-texto.pdf');
const MIGRACION = path.join(__dirname, '..', 'migrations', '019_motor_revision.sql');

test('rasterPdfDisponible y heicDisponible devuelven boolean y cachean', () => {
  const r1 = rasterPdfDisponible();
  assert.equal(typeof r1, 'boolean');
  assert.equal(rasterPdfDisponible(), r1);
  const h1 = heicDisponible();
  assert.equal(typeof h1, 'boolean');
  assert.equal(heicDisponible(), h1);
});

test('extraerTextoPdfEscaneado: entradas vacías o basura devuelven "" sin lanzar', async () => {
  assert.equal(await extraerTextoPdfEscaneado(null), '');
  assert.equal(await extraerTextoPdfEscaneado(Buffer.alloc(0)), '');
  assert.equal(await extraerTextoPdfEscaneado(Buffer.from('no soy un pdf')), '');
});

test('extraerTextoHeicBuffer: entradas vacías o basura devuelven "" sin lanzar', async () => {
  assert.equal(await extraerTextoHeicBuffer(null), '');
  assert.equal(await extraerTextoHeicBuffer(Buffer.alloc(0)), '');
  assert.equal(await extraerTextoHeicBuffer(Buffer.from('no soy heic')), '');
});

test('PDF escaneado: rasterizar + OCR recupera la señal de la factura', async (t) => {
  if (!rasterPdfDisponible() || !ocrDisponible()) {
    return t.skip('pdftoppm o tesseract no instalados en este entorno');
  }
  // El fixture tiene capa de texto, pero este camino lo rasteriza igual:
  // valida exactamente lo que le pasa a un PDF escaneado de verdad.
  const buffer = fs.readFileSync(FIXTURE_PDF);
  const texto = await extraerTextoPdfEscaneado(buffer);
  assert.ok(texto.length > 50, 'el OCR debe devolver texto');
  const p = parsearFacturaTexto(texto);
  assert.equal(p.senal_suficiente, true, 'el parser debe encontrar señal en el OCR');
  assert.ok(Number(p.monto_total) > 0);
});

test('HEIC: heif-convert + OCR recupera la señal de la factura', async (t) => {
  if (!rasterPdfDisponible() || !heicDisponible() || !ocrDisponible()) {
    return t.skip('pdftoppm, heif-convert o tesseract no instalados');
  }
  // heif-enc (mismo paquete que heif-convert) permite fabricar el fixture
  // HEIC al vuelo desde el raster del PDF de prueba.
  let heifEnc = true;
  try { execFileSync('heif-enc', ['--version'], { timeout: 5000 }); } catch (e) {
    if (e.code === 'ENOENT') heifEnc = false;
  }
  if (!heifEnc) return t.skip('heif-enc no instalado (no se puede fabricar el HEIC de prueba)');

  const base = path.join(os.tmpdir(), `sicr3p-test-heic-${crypto.randomUUID()}`);
  const rutaHeic = `${base}.heic`;
  try {
    execFileSync('pdftoppm', ['-r', '300', '-png', '-f', '1', '-l', '1', FIXTURE_PDF, base], { timeout: 30000 });
    const png = fs.readdirSync(os.tmpdir())
      .filter((f) => f.startsWith(path.basename(base)) && f.endsWith('.png'))
      .map((f) => path.join(os.tmpdir(), f))[0];
    assert.ok(png, 'pdftoppm debe generar el PNG intermedio');
    try {
      execFileSync('heif-enc', [png, '-o', rutaHeic], { timeout: 30000 });
    } catch (e) {
      // Sin plugin de ENCODING HEVC no se puede fabricar el fixture (en
      // producción solo se DECODIFICA, así que esto no refleja una falla real).
      fs.rmSync(png, { force: true });
      return t.skip(`heif-enc sin encoder HEVC: ${String(e.stderr || e.message).trim().slice(0, 80)}`);
    }
    fs.unlinkSync(png);

    const texto = await extraerTextoHeicBuffer(fs.readFileSync(rutaHeic));
    assert.ok(texto.length > 50, 'el OCR del HEIC debe devolver texto');
    const p = parsearFacturaTexto(texto);
    assert.equal(p.senal_suficiente, true, 'el parser debe encontrar señal en el HEIC');
  } finally {
    fs.rmSync(rutaHeic, { force: true });
  }
});

// ---------- Migración 019: auditoría por lectura ----------

test('migración 019: CHECKs idempotentes con los orígenes y estados nuevos', () => {
  const sql = fs.readFileSync(MIGRACION, 'utf8');
  // Orígenes nuevos del motor presentes en el CHECK.
  assert.match(sql, /'revision'/);
  assert.match(sql, /'propio_revisado'/);
  // Estado nuevo de facturas.
  assert.match(sql, /'en_revision'/);
  // Guardias de idempotencia: los DO $$ solo re-crean si falta el valor.
  assert.match(sql, /pg_get_constraintdef\(oid\) LIKE '%propio_revisado%'/);
  assert.match(sql, /pg_get_constraintdef\(oid\) LIKE '%en_revision%'/);
  // Tabla efímera de la cola con borrado en cascada.
  assert.match(sql, /CREATE TABLE IF NOT EXISTS facturas_revision/);
  assert.match(sql, /ON DELETE CASCADE/);
  // Nada en la migración promete certificaciones.
  assert.doesNotMatch(sql, /certificad|acreditad/i);
});

// ---------- F5: raster degradado (100 dpi) y reintento de PSM ----------
// Vive en ESTE archivo a propósito: los tests de un mismo archivo corren
// en serie, así los dos caminos OCR pesados no compiten por CPU (en
// paralelo, tesseract puede exceder su timeout interno de 30 s).

test('imagen degradada (raster 100 dpi): la cascada recorre los PSM sin lanzar', async (t) => {
  if (!rasterPdfDisponible() || !ocrDisponible()) {
    return t.skip('pdftoppm o tesseract no instalados en este entorno');
  }
  const { leerDocumento } = await import('../src/services/lecturaDocumento.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sicr3p-degradado-'));
  try {
    const base = path.join(dir, 'pagina');
    fs.writeFileSync(`${base}.pdf`, fs.readFileSync(FIXTURE_PDF));
    // 100 dpi en escala de grises: calidad de foto mala, no de escáner.
    execFileSync('pdftoppm', ['-r', '100', '-gray', '-png', '-f', '1', '-l', '1', `${base}.pdf`, base], { timeout: 20000 });
    const png = fs.readdirSync(dir).find((f) => f.endsWith('.png'));
    assert.ok(png, 'pdftoppm debe producir un PNG');
    const r = await leerDocumento(fs.readFileSync(path.join(dir, png)), 'degradada.png');
    // Ejercita el reintento --psm 3 cuando --psm 6 no da señal. El resultado
    // depende del OCR: o recupera señal real, o rechaza limpio — nunca inventa.
    assert.equal(r.etapa, 'imagen_ocr');
    assert.ok(['texto', 'sin_senal'].includes(r.tipo), r.tipo);
    if (r.tipo === 'texto') {
      assert.equal(r.motor, 'propio_ocr');
      assert.equal(r.textoParseado.senal_suficiente, true);
      assert.ok(Number(r.textoParseado.monto_total) > 0);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
