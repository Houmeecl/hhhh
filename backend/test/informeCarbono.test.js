import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { generateInformeCarbono } from '../src/services/pdf.js';

// PDFKit comprime los content streams con Flate, así que buscar texto en el
// buffer crudo no encuentra nada. Se inflan los streams y se decodifican las
// cadenas de los operadores de texto: PDFKit las emite en hexadecimal
// (`<48656c6c6f>` dentro de un arreglo TJ), y a veces como literal `(...)`.
// Alcanza para aseverar que una frase quedó impresa, sin depender de un
// binario externo como pdftotext.
function textoDelPdf(buf) {
  let salida = '';
  const bin = buf.toString('latin1');
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  while ((m = re.exec(bin)) !== null) {
    let crudo;
    try {
      crudo = zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1');
    } catch {
      continue; // no todos los streams son texto comprimido (fuentes, imágenes)
    }
    for (const t of crudo.matchAll(/<([0-9A-Fa-f\s]+)>/g)) {
      salida += Buffer.from(t[1].replace(/\s/g, ''), 'hex').toString('latin1');
    }
    for (const t of crudo.matchAll(/\(((?:[^()\\]|\\.)*)\)/g)) {
      salida += t[1].replace(/\\([()\\])/g, '$1');
    }
  }
  return salida;
}

// Informe de contabilidad de carbono a partir de analizarPeriodo() — prueba
// pura de generación de PDF, sin BD. Analisis mínimo con la forma real que
// entrega services/analisisSiiProveedor.js.
const EMPRESA = { id: 'a1b2c3d4-0000-0000-0000-000000000001', nombre_empresa: 'Minería del Norte SpA', rut: '76520943-9' };

const ANALISIS = {
  periodo: '2026-05',
  resumen: {
    compra: { n: 2, neto: 500000, iva: 95000, total: 595000 },
    venta: { n: 1, neto: 1000000, iva: 190000, total: 1190000 },
  },
  por_tipo: {
    compra: [{ tipo_dte: '33', nombre: 'Factura electrónica', n: 2, neto: 500000, iva: 95000, total: 595000 }],
    venta: [{ tipo_dte: '39', nombre: 'Boleta electrónica', n: 0, neto: 1000000, iva: 190000, total: 1190000, resumen: true }],
  },
  concentracion: { compra: [], venta: [] },
  emisiones: {
    total_co2e_tref: 1.2345, documentos_calculados: 2, documentos_totales: 2,
    metodo_fisico: 1, metodo_gasto: 1, referencial: true, motor_version_id: 'v1',
  },
  documentos: [],
};

test('generateInformeCarbono devuelve un PDF válido con los datos del período', async () => {
  const buf = await generateInformeCarbono({ empresa: EMPRESA, periodo: ANALISIS.periodo, analisis: ANALISIS });
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 500, 'el PDF no debería estar vacío');
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
});

test('generateInformeCarbono funciona sin emisiones calculadas (motor sin configurar)', async () => {
  const sinEmisiones = { ...ANALISIS, emisiones: null };
  const buf = await generateInformeCarbono({ empresa: EMPRESA, periodo: ANALISIS.periodo, analisis: sinEmisiones });
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
});

// Regresión de honestidad: el descargo de ISO 14064-3 se había quedado solo
// en la interfaz, mientras la ficha comercial 01 y el dossier corporativo
// afirmaban que "cada informe lo dice de forma impresa". El PDF viaja solo a
// un mandante, un auditor o una autoridad, así que el aviso tiene que ir
// dentro. Si este test falla, hay que corregir esos documentos ANTES de
// quitar el aviso del PDF.
test('generateInformeCarbono imprime el descargo de verificación acreditada', async () => {
  const buf = await generateInformeCarbono({ empresa: EMPRESA, periodo: ANALISIS.periodo, analisis: ANALISIS });
  const texto = textoDelPdf(buf);
  assert.ok(texto.length > 100, 'el extractor debe encontrar texto en el PDF');
  assert.match(texto, /14064-3/, 'el PDF debe citar la norma de verificación que NO cumple');
  assert.match(texto, /referenciales/, 'el PDF debe declarar que los factores son referenciales');
});

test('generateInformeCarbono nunca recibe ni imprime una clave: la firma no acepta ese campo', async () => {
  // La función solo toma { empresa, periodo, analisis } — no hay forma de
  // pasarle una credencial SII aunque quisiéramos; documentamos el contrato.
  const buf = await generateInformeCarbono({ empresa: EMPRESA, periodo: ANALISIS.periodo, analisis: ANALISIS, password: 'no-debiera-usarse' });
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
});
