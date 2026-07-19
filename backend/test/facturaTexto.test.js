import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsearFacturaTexto, parsearMontoChileno } from '../src/services/facturaTexto.js';
import { extraerTextoPdf, extraerTextoImagen, ocrDisponible } from '../src/services/extractorTexto.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PDF = path.join(__dirname, 'fixtures', 'factura-texto.pdf');

// Texto plano equivalente a lo que devuelve pdf-parse sobre el fixture.
const TEXTO_FACTURA = `COMERCIAL EJEMPLO SpA
R.U.T.: 76.123.456-0
FACTURA ELECTRONICA N° 4521
Señor(es): Prueba Capital SpA
R.U.T.: 11.111.111-1
Fecha emisión: 15/06/2026
Suministro eléctrico mensual planta $ 450.000
Flete distribución regional norte $ 320.000
Servicio de mantención preventiva $ 230.000
MONTO NETO $ 1.000.000
IVA (19%) $ 190.000
TOTAL $ 1.190.000
`;

// ---------- parser de montos ----------

test('parsearMontoChileno entiende miles con punto y decimales con coma', () => {
  assert.equal(parsearMontoChileno('1.190.000'), 1190000);
  assert.equal(parsearMontoChileno('$ 450.000'), 450000);
  assert.equal(parsearMontoChileno('1.190.000,50'), 1190000.5);
  assert.equal(parsearMontoChileno('4521'), 4521);
  assert.equal(parsearMontoChileno('no-numero'), 0);
  assert.equal(parsearMontoChileno(''), 0);
});

// ---------- parsing puro ----------

test('parsearFacturaTexto extrae RUTs validados: primero emisor, segundo receptor', () => {
  const p = parsearFacturaTexto(TEXTO_FACTURA);
  assert.equal(p.rut_emisor, '76123456-0');
  assert.equal(p.rut_receptor, '11111111-1');
});

test('parsearFacturaTexto descarta RUTs con dígito verificador inválido', () => {
  const p = parsearFacturaTexto('RUT: 76.123.456-9\nTOTAL $ 5.000');
  assert.equal(p.rut_emisor, null); // 76.123.456-9 no pasa módulo 11
});

test('parsearFacturaTexto extrae folio, fecha y monto total con miles chilenos', () => {
  const p = parsearFacturaTexto(TEXTO_FACTURA);
  assert.equal(p.folio, '4521');
  assert.equal(p.fecha, '2026-06-15');
  assert.equal(p.monto_total, 1190000);
  assert.equal(p.senal_suficiente, true);
});

test('parsearFacturaTexto toma el mayor TOTAL (ignora subtotales menores)', () => {
  const p = parsearFacturaTexto('SUBTOTAL $ 100.000\nTOTAL A PAGAR: $ 119.000\n');
  assert.equal(p.monto_total, 119000);
});

test('parsearFacturaTexto arma ítems desde líneas con monto final, excluyendo TOTAL/IVA/NETO', () => {
  const p = parsearFacturaTexto(TEXTO_FACTURA);
  assert.equal(p.items.length, 3);
  assert.deepEqual(p.items.map((it) => it.nombre), [
    'Suministro eléctrico mensual planta',
    'Flete distribución regional norte',
    'Servicio de mantención preventiva',
  ]);
  assert.deepEqual(p.items.map((it) => it.monto), [450000, 320000, 230000]);
  // Shape compatible con motorPropio.calcularFactura (mismo que parseDte).
  for (const it of p.items) {
    assert.equal(it.unidad, null);
    assert.equal(it.cantidad, 1);
  }
});

test('parsearFacturaTexto toma la cantidad si la línea parte con un número', () => {
  const p = parsearFacturaTexto('2 Toner láser negro $ 90.000\nTOTAL $ 107.100');
  assert.equal(p.items.length, 1);
  assert.equal(p.items[0].cantidad, 2);
  assert.equal(p.items[0].monto, 90000);
});

test('parsearFacturaTexto ignora montos menores a $1.000 y líneas sin glosa', () => {
  const p = parsearFacturaTexto('Ajuste menor $ 500\n123 456\nServicio de aseo $ 45.000\nTOTAL $ 53.550');
  assert.equal(p.items.length, 1);
  assert.equal(p.items[0].nombre, 'Servicio de aseo');
});

test('parsearFacturaTexto no confunde fechas ni dígitos verificadores con montos', () => {
  const p = parsearFacturaTexto('Fecha de emisión: 19/07/2026\nRUT cliente 76.123.456-0\nTOTAL $ 8.000');
  assert.equal(p.items.length, 1); // solo el ítem sintético por el total
  assert.equal(p.items[0].nombre, 'Documento (texto extraído)');
  assert.equal(p.items[0].monto, 8000);
});

test('parsearFacturaTexto con solo total crea un único ítem por el monto total', () => {
  const p = parsearFacturaTexto('Documento ilegible\nTOTAL $ 250.000');
  assert.equal(p.senal_suficiente, true);
  assert.equal(p.items.length, 1);
  assert.deepEqual(p.items[0], {
    nombre: 'Documento (texto extraído)',
    descripcion: null,
    cantidad: 1,
    unidad: null,
    monto: 250000,
  });
});

test('parsearFacturaTexto sin monto total NO tiene señal suficiente (nunca inventar)', () => {
  const p = parsearFacturaTexto('Estimado cliente, adjuntamos nuestro catálogo de servicios.');
  assert.equal(p.senal_suficiente, false);
  assert.equal(p.monto_total, 0);
  assert.equal(p.items.length, 0);
});

test('parsearFacturaTexto tolera entradas vacías o no-string', () => {
  for (const v of ['', null, undefined, 42]) {
    const p = parsearFacturaTexto(v);
    assert.equal(p.senal_suficiente, false);
    assert.equal(p.rut_emisor, null);
  }
});

// ---------- integración liviana: PDF real del fixture ----------

test('extraerTextoPdf + parsearFacturaTexto sobre el fixture PDF', async () => {
  const buffer = fs.readFileSync(FIXTURE_PDF);
  const texto = await extraerTextoPdf(buffer);
  assert.ok(texto.length > 0, 'el fixture debe tener capa de texto');
  const p = parsearFacturaTexto(texto);
  assert.equal(p.senal_suficiente, true);
  assert.equal(p.monto_total, 1190000);
  assert.equal(p.folio, '4521');
  assert.equal(p.rut_emisor, '76123456-0');
  assert.equal(p.rut_receptor, '11111111-1');
  assert.equal(p.items.length, 3);
});

test('extraerTextoPdf devuelve "" ante un buffer que no es PDF', async () => {
  assert.equal(await extraerTextoPdf(Buffer.from('esto no es un pdf')), '');
  assert.equal(await extraerTextoPdf(Buffer.alloc(0)), '');
  assert.equal(await extraerTextoPdf(null), '');
});

// ---------- OCR ----------

test('ocrDisponible detecta tesseract instalado (este entorno lo trae)', () => {
  assert.equal(ocrDisponible(), true);
  assert.equal(ocrDisponible(), true); // segunda llamada usa el cache
});

test('extraerTextoImagen con ruta inexistente devuelve "" sin lanzar', async () => {
  assert.equal(await extraerTextoImagen('/ruta/que/no/existe.png'), '');
  assert.equal(await extraerTextoImagen('/ruta/que/no/existe.heic'), ''); // formato fuera de alcance
  assert.equal(await extraerTextoImagen(null), '');
});
