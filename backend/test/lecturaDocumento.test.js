// ============================================================
// Tests del servicio de lectura automática (Fase 1 de la ronda
// metodología/cálculo/captación): la cascada XML → PDF texto →
// PDF OCR → imagen → HEIC extraída de routes/public.js, más los
// helpers de la bitácora de rechazos (migración 030).
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { leerDocumento, filaRechazo, sha256Hex } from '../src/services/lecturaDocumento.js';
import { ocrDisponible } from '../src/services/extractorTexto.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PDF = path.join(__dirname, 'fixtures', 'factura-texto.pdf');
const MIGRACION = path.join(__dirname, '..', 'migrations', '030_documentos_rechazados.sql');

const XML_DTE = `<?xml version="1.0" encoding="ISO-8859-1"?>
<DTE version="1.0"><Documento ID="F77T33">
<Encabezado><IdDoc><TipoDTE>33</TipoDTE><Folio>77</Folio><FchEmis>2026-07-01</FchEmis></IdDoc>
<Emisor><RUTEmisor>76123456-0</RUTEmisor><RznSoc>Electro SpA</RznSoc></Emisor>
<Receptor><RUTRecep>11111111-1</RUTRecep><RznSocRecep>Cliente</RznSocRecep></Receptor>
<Totales><MntNeto>100000</MntNeto><IVA>19000</IVA><MntTotal>119000</MntTotal></Totales></Encabezado>
<Detalle><NmbItem>Suministro electrico</NmbItem><QtyItem>500</QtyItem><UnmdItem>kWh</UnmdItem><MontoItem>100000</MontoItem></Detalle>
</Documento></DTE>`;

test('XML con ítems → tipo xml con el DTE parseado', async () => {
  const r = await leerDocumento(Buffer.from(XML_DTE, 'latin1'), 'factura.xml');
  assert.equal(r.tipo, 'xml');
  assert.equal(r.etapa, 'xml');
  assert.equal(r.dte.folio, '77');
  assert.equal(r.dte.items.length, 1);
});

test('XML sin ítems → sin_senal pero conserva el dte para el motor externo', async () => {
  const xml = XML_DTE.replace(/<Detalle>.*<\/Detalle>/s, '');
  const r = await leerDocumento(Buffer.from(xml, 'latin1'), 'factura.xml');
  assert.equal(r.tipo, 'sin_senal');
  assert.equal(r.etapa, 'xml');
  assert.equal(r.dte.folio, '77'); // folio/RUTs disponibles igual
});

test('PDF con capa de texto → propio_texto en etapa pdf_texto', async () => {
  const r = await leerDocumento(fs.readFileSync(FIXTURE_PDF), 'factura.pdf');
  assert.equal(r.tipo, 'texto');
  assert.equal(r.motor, 'propio_texto');
  assert.equal(r.etapa, 'pdf_texto');
  assert.equal(r.textoParseado.senal_suficiente, true);
});

test('PDF basura → sin_senal (etapa según binarios disponibles)', async () => {
  const r = await leerDocumento(Buffer.from('%PDF-1.4\nno soy una factura'), 'roto.pdf');
  assert.equal(r.tipo, 'sin_senal');
  // Con pdftoppm instalado alcanza a intentar el OCR del raster; sin él
  // se queda en la capa de texto. Ambas etapas son válidas según entorno.
  assert.ok(['pdf_texto', 'pdf_ocr'].includes(r.etapa), r.etapa);
});

test('imagen basura → sin_senal en etapa imagen_ocr (si hay OCR)', async (t) => {
  if (!ocrDisponible()) return t.skip('tesseract no instalado');
  const r = await leerDocumento(Buffer.from('no soy un png'), 'foto.png');
  assert.equal(r.tipo, 'sin_senal');
  assert.equal(r.etapa, 'imagen_ocr');
});

test('extensión no reconocida por la cascada → sin_senal etapa ninguna', async () => {
  const r = await leerDocumento(Buffer.from('lo que sea'), 'archivo.docx');
  assert.equal(r.tipo, 'sin_senal');
  assert.equal(r.etapa, 'ninguna');
});

test('sha256Hex es determinista y hex de 64', () => {
  const a = sha256Hex(Buffer.from('hola'));
  assert.equal(a, sha256Hex(Buffer.from('hola')));
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, sha256Hex(Buffer.from('chao')));
});

test('filaRechazo arma la fila sin el binario (minimización)', () => {
  const file = { originalname: 'Escaneo Final.PDF', buffer: Buffer.from('xx') };
  const f = filaRechazo(file, { etapa: 'pdf_ocr' }, '76.123.456-0');
  assert.equal(f.nombre_archivo, 'Escaneo Final.PDF');
  assert.equal(f.extension, 'pdf');
  assert.equal(f.tamano_bytes, 2);
  assert.match(f.sha256, /^[0-9a-f]{64}$/);
  assert.equal(f.motivo, 'sin_senal');
  assert.equal(f.etapa_alcanzada, 'pdf_ocr');
  assert.equal(f.rut_cliente, '76.123.456-0');
  assert.equal('archivo' in f || 'buffer' in f || 'binario' in f, false);
});

test('filaRechazo tolera lectura nula y archivo sin buffer', () => {
  const f = filaRechazo({ originalname: 'x.png' }, null, null);
  assert.equal(f.etapa_alcanzada, 'ninguna');
  assert.equal(f.rut_cliente, null);
  assert.match(f.sha256, /^[0-9a-f]{64}$/); // hash del buffer vacío
});

// ---------- Migración 030: auditoría por lectura ----------

test('migración 030: idempotente, sin binario, con motivos y etapas del servicio', () => {
  const sql = fs.readFileSync(MIGRACION, 'utf8');
  // Solo el cuerpo SQL (los comentarios explican la minimización y pueden
  // nombrar "contenido"/"binario" sin que eso sea una columna).
  const cuerpo = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  assert.match(cuerpo, /CREATE TABLE IF NOT EXISTS documentos_rechazados/);
  assert.match(cuerpo, /CREATE INDEX IF NOT EXISTS/);
  // Minimización: ninguna columna que retenga el documento en sí.
  assert.doesNotMatch(cuerpo, /BYTEA/i);
  assert.doesNotMatch(cuerpo, /^\s{2}(archivo|binario|contenido|buffer)\s/im);
  // Motivos y etapas que usa el código están permitidos por los CHECK.
  for (const v of ['sin_senal', 'formato_no_permitido', 'monto_fuera_de_rango']) assert.match(cuerpo, new RegExp(v));
  for (const v of ['pdf_texto', 'pdf_ocr', 'imagen_ocr', 'heic_ocr', 'xml', 'ninguna']) assert.match(cuerpo, new RegExp(v));
  // Nada en la migración promete certificaciones.
  assert.doesNotMatch(sql, /certificad|acreditad/i);
});
