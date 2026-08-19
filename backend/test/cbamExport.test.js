import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filaCbamCsv, resumenNormativo } from '../src/services/pasaporteOrigen.js';

// ============================================================
// Mapeo de columnas del export CBAM para mandantes (mandante.js
// GET /export/cbam) — mismo espíritu que alcanceGhg.test.js: probar la
// función pura de transformación sin BD ni HTTP.
// ============================================================

const LOTE_ACERO = {
  codigo: 'LM-2026-000010',
  pais_origen: 'BR',
  material: 'otro',
  codigo_nc: '720610',
  emisiones_directas_tco2e_t: 1.234,
  emisiones_indirectas_tco2e_t: 0.5,
  metodo_emisiones: 'valores_reales',
  faena_origen: 'Planta Carajás',
};

const LOTE_COBRE = {
  codigo: 'LM-2026-000011',
  pais_origen: 'CL',
  material: 'cobre_catodo',
  codigo_nc: '740311',
  emisiones_directas_tco2e_t: null,
  emisiones_indirectas_tco2e_t: null,
  metodo_emisiones: null,
  faena_origen: null,
};

function anotarCbam(lote) {
  return { ...lote, cbam: resumenNormativo(lote, []).cbam };
}

test('filaCbamCsv: lote de acero (Brasil) aplicable y completo', () => {
  const fila = filaCbamCsv(anotarCbam(LOTE_ACERO));
  assert.deepEqual(fila, {
    codigo: 'LM-2026-000010',
    pais_origen: 'BR',
    material: 'otro',
    codigo_nc: '720610',
    cbam_aplicable: 'si',
    metodo_emisiones: 'valores_reales',
    emisiones_directas_tco2e_t: 1.234,
    emisiones_indirectas_tco2e_t: 0.5,
    cbam_listo: 'si',
    cbam_faltantes: '',
  });
});

test('filaCbamCsv: lote de cobre fuera del Anexo I — no aplicable, sin romper el export', () => {
  const fila = filaCbamCsv(anotarCbam(LOTE_COBRE));
  assert.equal(fila.cbam_aplicable, 'no');
  assert.equal(fila.codigo, 'LM-2026-000011');
  assert.equal(fila.emisiones_directas_tco2e_t, '');
  assert.equal(fila.metodo_emisiones, '');
});

test('filaCbamCsv: lote incompleto (falta código NC) lista los faltantes separados por ;', () => {
  const lote = { ...LOTE_ACERO, codigo_nc: null };
  const fila = filaCbamCsv(anotarCbam(lote));
  assert.equal(fila.cbam_aplicable, 'no'); // sin NC válido, cbamAplicable() es false
  assert.equal(fila.cbam_listo, 'no');
  assert.ok(fila.cbam_faltantes.split(';').includes('codigo_nc'));
});

// ============================================================
// El PDF que se adjunta a una declaración ante la UE.
//
// EL HUECO QUE ESTOS CASOS CIERRAN: `generateReporteCbam` terminaba en
// `return bufferDoc(doc)` justo después de la tabla de lotes, sin una sola
// línea de descargo. El texto existía en la rama CSV de GET /export/cbam
// (routes/mandante.js) —otro endpoint, no este: el PDF se sirve desde
// GET /export/cbam.pdf—, así que el mandante que descargaba el PDF, el
// formato que de verdad se adjunta y se reenvía, recibía una tabla de
// emisiones sin advertencia de ningún tipo. De los tres informes con
// destinatario externo era el único sin bloque de límites, y el de
// destinatario más exigente. La rama JSON tenía el mismo hueco y se cerró
// junto con este.
// ============================================================

async function textoDelPdf(buffer) {
  const { PDFParse } = await import('pdf-parse');
  const r = await new PDFParse({ data: buffer }).getText();
  // pdfkit corta las líneas al ancho de la caja: para buscar frases hay
  // que volver a unir el texto en un solo renglón.
  return r.text.replace(/\s+/g, ' ');
}

test('el reporte CBAM sale con su bloque de límites, no solo con la tabla', async () => {
  const { generateReporteCbam } = await import('../src/services/pdf.js');
  const pdf = await generateReporteCbam({
    mandante: { nombre_empresa: 'Exportadora del Norte SpA' },
    lotes: [anotarCbam(LOTE_ACERO), anotarCbam(LOTE_COBRE)],
  });
  const texto = await textoDelPdf(pdf);

  assert.match(texto, /Límites y exclusiones declaradas/);
  // Lo esencial: quién declara ante la UE, y que no es sicr3p.
  assert.match(texto, /NO es la declaración CBAM/i);
  assert.match(texto, /nunca sicr3p ni a través de sicr3p/i);
  // La misma frase que ya usa la rama CSV — una sola redacción del mismo dato.
  assert.match(texto, /datos de apoyo, no sustituye verificación acreditada/i);
  assert.match(texto, /Reglamento \(UE\) 2023\/956/);
  // Y el descargo común a todos los informes.
  assert.match(texto, /NO constituye una verificación de tercera parte acreditada/i);
});

test('un reporte CBAM sin lotes igual lleva el descargo', async () => {
  // El caso vacío es el que más fácil se escapa: sin filas la función
  // saltaba directo al return.
  const { generateReporteCbam } = await import('../src/services/pdf.js');
  const texto = await textoDelPdf(await generateReporteCbam({
    mandante: { nombre_empresa: 'Sin Lotes SpA' }, lotes: [],
  }));
  assert.match(texto, /Sin lotes en el período consultado/);
  assert.match(texto, /Límites y exclusiones declaradas/);
  assert.match(texto, /NO constituye una verificación de tercera parte acreditada/i);
});

test('el reporte no promete que el proceso declarado sea el ejecutado', async () => {
  const { generateReporteCbam } = await import('../src/services/pdf.js');
  const texto = await textoDelPdf(await generateReporteCbam({
    mandante: { nombre_empresa: 'X SpA' }, lotes: [anotarCbam(LOTE_ACERO)],
  }));
  assert.match(texto, /No acredita que el proceso productivo declarado sea el efectivamente ejecutado/i);
  // Y que "Incompleto"/"No aplica" no se lean como un juicio de cumplimiento.
  assert.match(texto, /Ninguno de los dos estados es un juicio sobre el cumplimiento/i);
});
