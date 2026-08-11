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

import { leerDocumento, filaRechazo, sha256Hex, rutReceptorNoCalza } from '../src/services/lecturaDocumento.js';
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

// ---------- F5: fixtures y cobertura del comportamiento vigente ----------

const FIXTURE_NC = path.join(__dirname, 'fixtures', 'nota-credito.xml');
const FIXTURE_NC_POSITIVA = path.join(__dirname, 'fixtures', 'nota-credito-positiva.xml');

test('nota de crédito (DTE 61): rechazada por tipo ANTES de mirar sus ítems', async () => {
  const r = await leerDocumento(fs.readFileSync(FIXTURE_NC), 'nota-credito.xml');
  assert.equal(r.tipo, 'rechazo');
  assert.equal(r.motivo, 'tipo_documento_no_calculable');
  assert.equal(r.etapa, 'xml');
  // El dte parseado se conserva (folio/RUTs para el motor externo).
  assert.equal(r.dte.tipo_dte, 61);
  assert.equal(r.dte.folio, '889');
});

test('nota de crédito con montos POSITIVOS (formato real del SII): también rechazada, nunca sumada como factura nueva', async () => {
  // Hallazgo de auditoría: una NC real trae montos positivos (el signo lo
  // da el TipoDTE, no el ítem) — sin el chequeo de tipo, este documento
  // habría sumado 0,42 t CO2e nuevos en vez de anular la factura F-4521
  // que reversa. Verificamos que el rechazo NO depende de que los montos
  // sean negativos.
  const r = await leerDocumento(fs.readFileSync(FIXTURE_NC_POSITIVA), 'nota-credito-positiva.xml');
  assert.equal(r.tipo, 'rechazo');
  assert.equal(r.motivo, 'tipo_documento_no_calculable');
  assert.equal(r.dte.tipo_dte, 61);
  assert.equal(Number(r.dte.items[0].monto), 300000); // confirma que el monto SÍ es positivo en este fixture
});

test('guía de despacho (DTE 52) y nota de débito (DTE 56): rechazadas por tipo, igual que la nota de crédito', async () => {
  for (const [tipo, folio] of [[52, '901'], [56, '902']]) {
    const xml = XML_DTE.replace('<TipoDTE>33</TipoDTE>', `<TipoDTE>${tipo}</TipoDTE>`).replace('<Folio>77</Folio>', `<Folio>${folio}</Folio>`);
    const r = await leerDocumento(Buffer.from(xml, 'latin1'), `doc-${tipo}.xml`);
    assert.equal(r.tipo, 'rechazo', `DTE ${tipo} debe rechazarse`);
    assert.equal(r.motivo, 'tipo_documento_no_calculable');
    assert.equal(r.dte.tipo_dte, tipo);
  }
});

test('lote mixto: cada archivo se lee de forma independiente (XML + PDF texto + basura)', async () => {
  const archivos = [
    { buffer: Buffer.from(XML_DTE, 'latin1'), nombre: 'factura.xml' },
    { buffer: fs.readFileSync(FIXTURE_PDF), nombre: 'factura.pdf' },
    { buffer: Buffer.from('%PDF-1.4\nno soy una factura'), nombre: 'roto.pdf' },
  ];
  const lecturas = [];
  for (const a of archivos) lecturas.push(await leerDocumento(a.buffer, a.nombre));
  assert.equal(lecturas[0].tipo, 'xml');
  assert.equal(lecturas[1].tipo, 'texto');
  assert.equal(lecturas[1].motor, 'propio_texto');
  // El ilegible del lote no contamina a los legibles: sin_senal aislado.
  assert.equal(lecturas[2].tipo, 'sin_senal');
});

// ---------- Orden de compra / guía / cotización en PDF real (sin XML,
// sin TipoDTE): mismo rechazo por tipo, esta vez detectado en el texto
// extraído del PDF con pdf-parse (no un mock — un PDF real generado con
// pdfkit, igual que los PDFs que produce la propia app). ----------
async function pdfConTexto(lineas) {
  const { default: PDFDocument } = await import('pdfkit');
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    for (const linea of lineas) doc.text(linea);
    doc.end();
  });
}

test('orden de compra en PDF real (sin TipoDTE): rechazada por tipo, no se calcula como factura', async () => {
  const buffer = await pdfConTexto([
    'ACME SpA', 'R.U.T.: 76.123.456-0', 'ORDEN DE COMPRA N° 445',
    'Proveedor: Comercial Ejemplo SpA', 'Suministro electrico mensual planta $ 450.000',
  ]);
  const r = await leerDocumento(buffer, 'orden-compra.pdf');
  assert.equal(r.tipo, 'rechazo');
  assert.equal(r.motivo, 'tipo_documento_no_calculable');
  assert.equal(r.tipo_detectado, 'Orden de compra');
  assert.equal(r.etapa, 'pdf_texto');
});

test('factura real en PDF que cita su Orden de Compra como referencia: SÍ se calcula (no es una OC)', async () => {
  const buffer = await pdfConTexto([
    'COMERCIAL EJEMPLO SpA', 'R.U.T.: 76.123.456-0', 'FACTURA ELECTRONICA N° 4521',
    'Su Orden de Compra: OC-445', 'Señor(es): Prueba Capital SpA', 'R.U.T.: 11.111.111-1',
    'Suministro electrico mensual planta $ 450.000', 'TOTAL $ 450.000',
  ]);
  const r = await leerDocumento(buffer, 'factura-con-oc.pdf');
  assert.equal(r.tipo, 'texto');
  assert.equal(r.motor, 'propio_texto');
  assert.equal(r.textoParseado.senal_suficiente, true);
});

// ---------- Integración con IA (stub inyectado, sin red) ----------
// La IA real (analisisIA.analizarTexto) llama a la API de Anthropic — no
// se puede ni se debe probar contra la red en la suite. Se inyecta un
// stub vía la opción `analizarIA` (dependency injection) para probar la
// cascada completa: IA primero, reglas como respaldo, mismas guardias.

test('con IA disponible: una factura calculable se lee vía analisisIA (motor propio_ia)', async () => {
  const analizarIA = async () => ({
    tipo_no_calculable: null,
    folio: '4521',
    rut_emisor: '76123456-0',
    rut_receptor: '11111111-1',
    fecha: '2026-06-15',
    monto_total: 450000,
    items: [{ nombre: 'Suministro eléctrico', descripcion: null, cantidad: 500, unidad: 'kWh', monto: 450000 }],
    senal_suficiente: true,
    verificaciones: null,
  });
  const r = await leerDocumento(fs.readFileSync(FIXTURE_PDF), 'factura.pdf', { analizarIA });
  assert.equal(r.tipo, 'texto');
  assert.equal(r.motor, 'propio_ia');
  assert.equal(r.etapa, 'pdf_texto');
  assert.equal(r.textoParseado.monto_total, 450000);
});

test('con IA disponible: un tipo no calculable se rechaza igual que con el parser de reglas', async () => {
  const analizarIA = async () => ({ tipo_no_calculable: 'Orden de compra' });
  const r = await leerDocumento(fs.readFileSync(FIXTURE_PDF), 'orden.pdf', { analizarIA });
  assert.equal(r.tipo, 'rechazo');
  assert.equal(r.motivo, 'tipo_documento_no_calculable');
  assert.equal(r.tipo_detectado, 'Orden de compra');
});

test('si la IA falla o no responde: cae al parser de reglas sin rechazar el documento', async () => {
  const analizarIA = async () => { throw new Error('timeout simulado'); };
  const r = await leerDocumento(fs.readFileSync(FIXTURE_PDF), 'factura.pdf', { analizarIA });
  // Mismo resultado que sin IA en absoluto (ver test de más arriba con FIXTURE_PDF).
  assert.equal(r.tipo, 'texto');
  assert.equal(r.motor, 'propio_texto');
});

test('si la IA no logra confianza (tipo "desconocido" ya filtrado a null): cae al parser de reglas', async () => {
  // analisisIA.analizarTexto ya traduce tipo_documento:'desconocido' a null
  // internamente — el stub simula exactamente ese contrato.
  const analizarIA = async () => null;
  const r = await leerDocumento(fs.readFileSync(FIXTURE_PDF), 'factura.pdf', { analizarIA });
  assert.equal(r.tipo, 'texto');
  assert.equal(r.motor, 'propio_texto');
});

test('con IA disponible: un ítem con monto absurdo sigue disparando el tope (misma guardia, cualquier origen)', async () => {
  const { MONTO_MAX_CLP_ITEM } = await import('../src/services/motorPropio.js');
  const analizarIA = async () => ({
    tipo_no_calculable: null,
    monto_total: MONTO_MAX_CLP_ITEM + 1,
    items: [{ nombre: 'Lectura corrupta', descripcion: null, cantidad: 1, unidad: null, monto: MONTO_MAX_CLP_ITEM + 1 }],
    senal_suficiente: true,
    verificaciones: null,
  });
  const r = await leerDocumento(fs.readFileSync(FIXTURE_PDF), 'factura.pdf', { analizarIA });
  assert.equal(r.tipo, 'rechazo');
  assert.equal(r.motivo, 'monto_fuera_de_rango');
});

// ---------- rutReceptorNoCalza (migración 086) ----------
// El documento emitido a OTRO RUT se rechaza SOLO con evidencia firme:
// receptor propio del documento, que pasa módulo 11 y no calza con el
// titular. Todo lo demás es beneficio de la duda (se asimila como hoy).

test('rutReceptorNoCalza: receptor del XML igual al titular (con puntos/guión) → calza', () => {
  const lectura = { tipo: 'xml', dte: { rut_receptor: '11111111-1' } };
  assert.equal(rutReceptorNoCalza(lectura, '11.111.111-1'), false);
});

test('rutReceptorNoCalza: receptor del XML distinto del titular → no calza', () => {
  const lectura = { tipo: 'xml', dte: { rut_receptor: '11111111-1' } };
  assert.equal(rutReceptorNoCalza(lectura, '76.123.456-0'), true);
});

test('rutReceptorNoCalza: receptor de texto distinto del titular → no calza', () => {
  const lectura = { tipo: 'texto', textoParseado: { rut_receptor: '76520943-9' } };
  assert.equal(rutReceptorNoCalza(lectura, '78345120-4'), true);
});

test('rutReceptorNoCalza: K mayúscula/minúscula y formato no importan', () => {
  const lectura = { tipo: 'texto', textoParseado: { rut_receptor: '76.222.089-k' } };
  assert.equal(rutReceptorNoCalza(lectura, '76222089K'), false);
});

test('rutReceptorNoCalza: sin receptor detectable → beneficio de la duda', () => {
  assert.equal(rutReceptorNoCalza({ tipo: 'xml', dte: { rut_receptor: null } }, '11111111-1'), false);
  assert.equal(rutReceptorNoCalza({ tipo: 'texto', textoParseado: {} }, '11111111-1'), false);
  assert.equal(rutReceptorNoCalza({ tipo: 'sin_senal', etapa: 'pdf_ocr' }, '11111111-1'), false);
  assert.equal(rutReceptorNoCalza(null, '11111111-1'), false);
});

test('rutReceptorNoCalza: receptor que no pasa módulo 11 (basura de OCR) → beneficio de la duda', () => {
  const lectura = { tipo: 'texto', textoParseado: { rut_receptor: '11111111-2' } };
  assert.equal(rutReceptorNoCalza(lectura, '76123456-0'), false);
  // Muy corto o muy largo tampoco cuenta como evidencia.
  assert.equal(rutReceptorNoCalza({ tipo: 'texto', textoParseado: { rut_receptor: '12-4' } }, '76123456-0'), false);
});

test('rutReceptorNoCalza: sin RUT titular no hay con qué comparar → false', () => {
  const lectura = { tipo: 'xml', dte: { rut_receptor: '11111111-1' } };
  assert.equal(rutReceptorNoCalza(lectura, ''), false);
  assert.equal(rutReceptorNoCalza(lectura, null), false);
});

test('rutReceptorNoCalza: titular como EMISOR en camino de texto → posible swap de la IA, no rechaza', () => {
  // La IA no recibe el anclaje del RUT esperado: puede invertir emisor y
  // receptor en una factura legítima. Si el titular figura en CUALQUIERA
  // de los dos campos, el documento calza.
  const lectura = { tipo: 'texto', textoParseado: { rut_emisor: '78345120-4', rut_receptor: '76123456-0' } };
  assert.equal(rutReceptorNoCalza(lectura, '78.345.120-4'), false);
  // Pero si el titular no aparece en ninguno, sí se rechaza.
  assert.equal(rutReceptorNoCalza(lectura, '76520943-9'), true);
});

test('rutReceptorNoCalza: XML sin ítems (sin_senal con dte) conserva la evidencia del receptor', () => {
  // Un XML ajeno sin ítems iba al motor externo y se asimilaba igual:
  // la lectura es 'sin_senal' pero el dte trae RUTRecep — evidencia firme.
  const lectura = { tipo: 'sin_senal', etapa: 'xml', dte: { rut_receptor: '76520943-9' } };
  assert.equal(rutReceptorNoCalza(lectura, '78345120-4'), true);
  assert.equal(rutReceptorNoCalza(lectura, '76.520.943-9'), false); // el propio titular calza
  // sin_senal SIN dte (PDF ilegible): sin evidencia, no se rechaza.
  assert.equal(rutReceptorNoCalza({ tipo: 'sin_senal', etapa: 'pdf_ocr' }, '78345120-4'), false);
});

test('rutReceptorNoCalza: en XML el emisor NO da beneficio de la duda (campos estructurados)', () => {
  // RUTEmisor/RUTRecep son tags del DTE, no una adivinanza posicional: si
  // el receptor del XML es otro, el documento es ajeno aunque el titular
  // figure como emisor (una venta propia no es un gasto del titular).
  const lectura = { tipo: 'xml', dte: { rut_emisor: '78345120-4', rut_receptor: '76520943-9' } };
  assert.equal(rutReceptorNoCalza(lectura, '78345120-4'), true);
});
