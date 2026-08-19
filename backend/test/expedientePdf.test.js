import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateExpedienteEvidencia } from '../src/services/pdf.js';
import { resumenExpediente, resumenDato, NO_ACREDITA } from '../src/services/expediente.js';

// ============================================================
// El expediente de evidencia en PDF — el documento que el proveedor le
// entrega a su cliente cuando le preguntan con qué respalda un dato.
//
// Es el hermano del expediente de lote del Corredor
// (generateExpedienteLote) y comparte su lenguaje visual, pero con tres
// diferencias que estos casos fijan porque son decisiones, no detalles:
//
//  1. NO lleva QR de verificación pública. El de lote apunta a /lote/:codigo,
//     que existe y es público; un expediente de evidencia NO sale de la
//     empresa que lo arma. Un QR ahí no llevaría a ninguna parte.
//  2. SÍ lleva el bloque de lo que no acredita. Va a un cliente que podría
//     leerlo como una certificación.
//  3. El alcance se imprime como POTENCIAL, o no se imprime.
//
// Además cuidan un defecto que apareció en la primera muestra impresa: las
// fuentes base de pdfkit (WinAnsi) no tienen subíndices, así que "tCO₂e"
// salía como "tCO ,e" en un documento que va a un tercero.
// ============================================================

const EXPEDIENTE = {
  cliente_nombre: 'Minera de Ejemplo', orden_compra: 'OC 12345', contrato: 'CTR-2026-88',
  faena: 'Faena Norte', periodo: '2026-07', tipo: 'suministro',
  glosa: '50 filtros industriales para correas transportadoras',
};
const DOCS = [
  { rol: 'venta_principal', descripcion: 'Factura 1234', factura_id: 'f1', cantidad: 50,
    unidad: 'unidad', asociacion: 'directa', porcentaje: 100, fecha: '2026-07-15' },
  { rol: 'guia', descripcion: 'Guía de despacho 4567', dte_proveedor_id: 'd1', cantidad: 50,
    unidad: 'unidad', asociacion: 'directa', porcentaje: 100, fecha: '2026-07-14' },
  { rol: 'ficha_tecnica', descripcion: 'Ficha técnica del filtro FT-900', asociacion: 'directa', porcentaje: 100 },
];

async function textoDe(pdf) {
  const { PDFParse } = await import('pdf-parse');
  const r = await new PDFParse({ data: pdf }).getText();
  return r.text.replace(/\s+/g, ' ');
}

const armar = (exp = EXPEDIENTE, docs = DOCS, extra = {}) => generateExpedienteEvidencia({
  expediente: exp,
  documentos: docs,
  resumen: resumenExpediente(exp, docs),
  datos: [resumenDato({ producto: 'Filtros industriales FT-900', cantidad: 50, unidad: 'unidad' }, docs, exp)],
  sellos: [],
  ...extra,
});

test('el expediente imprime su carátula, sus documentos y sus brechas', async () => {
  const t = await textoDe(await armar());
  assert.match(t, /EXPEDIENTE DE EVIDENCIA/);
  assert.match(t, /OC 12345/);
  assert.match(t, /Minera de Ejemplo/);
  assert.match(t, /DOCUMENTOS QUE LO RESPALDAN/);
  assert.match(t, /Factura 1234/);
  // Las brechas van con el mismo peso que los documentos: son la mitad del
  // valor del expediente, no letra chica.
  assert.match(t, /QUÉ LE FALTA/);
});

test('distingue "En sicr3p" de "Declarado" — la distinción que sostiene todo', async () => {
  const t = await textoDe(await armar());
  assert.match(t, /En sicr3p/);
  assert.match(t, /Declarado/);
});

test('SIEMPRE lleva el bloque de lo que no acredita', async () => {
  // Incluso vacío, incluso completo: es la línea entre ordenar evidencia y
  // certificar, y va en el cuerpo del documento, no en un pie de 6 puntos.
  for (const docs of [[], DOCS]) {
    const t = await textoDe(await armar(EXPEDIENTE, docs));
    assert.match(t, /LO QUE ESTE EXPEDIENTE NO ACREDITA/);
    assert.match(t, /No es una certificación/);
    assert.match(t, /no demuestra por sí sola entrega, uso ni desempeño/);
  }
  assert.ok(NO_ACREDITA.length >= 6);
});

test('el subíndice de tCO2e no se imprime como basura', async () => {
  // EL DEFECTO QUE ESTE CASO IMPIDE QUE VUELVA: las fuentes base de pdfkit
  // no tienen "₂" (U+2082), así que NOTA_SCOPE —que en pantalla se ve
  // perfecta— salía impresa como "tCO ,e" en un documento que va a un
  // cliente. Se sanea al entrar al papel, no en el servicio.
  const t = await textoDe(await armar());
  assert.match(t, /tCO2e/, 'el subíndice no se convirtió a texto plano');
  assert.doesNotMatch(t, /₂/, 'quedó un subíndice crudo que la fuente no puede dibujar');
  assert.doesNotMatch(t, /tCO ,e/, 'volvió la basura de la primera muestra');
});

test('no promete una verificación pública que no existe', async () => {
  // El expediente de lote dice "Escanee para verificar en línea" porque
  // /lote/:codigo es público. Este NO sale de la empresa, así que no puede
  // ofrecer lo mismo.
  const t = await textoDe(await armar());
  assert.doesNotMatch(t, /Escanee para verificar/i);
  assert.doesNotMatch(t, /sicr3p\.cl\/lote/);
});

test('sin categoría de alcance, lo dice en vez de inventar la 1', async () => {
  const otro = { ...EXPEDIENTE, tipo: 'otro' };
  const t = await textoDe(await armar(otro, DOCS));
  assert.match(t, /Sin categoría/);
  assert.doesNotMatch(t, /Categoría 1 —/);
  // Y la cobertura tampoco se inventa.
  assert.match(t, /SIN EVALUAR — NO SE OPINA/);
});

test('con categoría, la imprime como POTENCIAL y con su nota', async () => {
  const t = await textoDe(await armar());
  assert.match(t, /CLASIFICACIÓN DE ALCANCE POTENCIAL/);
  assert.match(t, /Alcance 3 · Categoría 1/);
  assert.match(t, /confirmarla es del cliente/i);
});

test('sin documentos encadenados, el sello lo dice en vez de fingir uno', async () => {
  const t = await textoDe(await armar(EXPEDIENTE, DOCS, { sellos: [] }));
  assert.match(t, /SELLO DE INTEGRIDAD/);
  assert.match(t, /Ningún documento de este expediente está encadenado/);
});

test('con documentos encadenados, imprime el hash real', async () => {
  const hash = 'a3f5c9e21b7d84f06c1e5a9d3b8027fe4c6a1d9b8e2f70534c8a6b1d9e0f3a72';
  const t = await textoDe(await armar(EXPEDIENTE, DOCS, {
    sellos: [{ descripcion: 'Factura 1234', hash_cadena: hash }],
  }));
  assert.match(t, new RegExp(hash));
});

test('un expediente vacío no revienta y sigue siendo honesto', async () => {
  const t = await textoDe(await armar(EXPEDIENTE, []));
  assert.match(t, /Sin documentos enganchados todavía/);
  assert.match(t, /SIN RESPALDO — 0% DE COBERTURA/);
  assert.match(t, /LO QUE ESTE EXPEDIENTE NO ACREDITA/);
});

test('un texto largo se corta con elipsis, no a mitad de palabra', async () => {
  // En la primera muestra salía "Fabricante del Repuesto SpA — foli", que
  // parece un dato truncado por error y no por falta de espacio.
  const largo = [{ ...DOCS[0], descripcion: 'Fabricante del Repuesto Industrial SpA — folio 8754' }];
  const t = await textoDe(await armar(EXPEDIENTE, largo));
  assert.doesNotMatch(t, /— foli /, 'volvió el corte a mitad de palabra');
  assert.match(t, /…/, 'un texto que no cabe tiene que marcarse como recortado');
});
