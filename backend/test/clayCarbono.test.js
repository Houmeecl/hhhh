import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SII_EXCLUIDOS, MOTOR_CLAY,
  datosDeDte, admiteDte, itemsDeLineas, itemUnico, itemsDeDte,
  agruparLineas, resumirImportacion,
} from '../src/services/clayCarbono.js';

// Documento tal como lo entrega el ejemplo de la especificación de Clay.
const DTE = {
  id: '507f1f77bcf86cd799439011',
  issue_date: '2026-03-01T00:00:00Z',
  number: '1542',
  type: 'Factura Electrónica',
  sii_code: 33,
  issuer: { rut: '76570751', dv: 'K', company_name: 'Empresa Ejemplo SpA' },
  receiver: { rut: '12345678', dv: '9', company_name: 'Cliente Receptor Ltda.' },
  is_received: true,
  total: { net: 1000000, exempt: 0, vat: 190000, total: 1190000 },
};

// ---------- mapeo de cabecera ----------

test('datosDeDte arma RUT completo, folio y fecha', () => {
  const d = datosDeDte(DTE);
  assert.equal(d.rut_emisor, '76570751-K');
  assert.equal(d.rut_receptor, '12345678-9');
  assert.equal(d.numero_venta, 'F-1542');
  assert.equal(d.fecha, '2026-03-01');
  assert.equal(d.clay_id, '507f1f77bcf86cd799439011');
});

test('datosDeDte toma el NETO, no el total con IVA', () => {
  // El IVA es un impuesto, no consumo: calcular por gasto sobre el total
  // inflaría el CO2e un 19%.
  const d = datosDeDte(DTE);
  assert.equal(d.neto, 1000000);
  assert.equal(d.total, 1190000);
});

test('datosDeDte no revienta con un documento incompleto', () => {
  const d = datosDeDte({});
  assert.equal(d.rut_emisor, null);
  assert.equal(d.neto, 0);
  assert.equal(d.fecha, null);
});

// ---------- qué entra al cálculo ----------

test('una factura de compra entra', () => {
  assert.deepEqual(admiteDte(DTE), { admite: true, motivo: null });
});

test('las notas de crédito y las guías de despacho quedan fuera', () => {
  assert.deepEqual(SII_EXCLUIDOS, [61, 52]);
  assert.equal(admiteDte({ ...DTE, sii_code: 61 }).motivo, 'nota de crédito');
  assert.equal(admiteDte({ ...DTE, sii_code: 52 }).motivo, 'guía de despacho');
});

test('un documento emitido (venta) queda fuera: es emisión del cliente, no propia', () => {
  const r = admiteDte({ ...DTE, is_received: false });
  assert.equal(r.admite, false);
  assert.match(r.motivo, /venta/);
});

test('un documento sin monto queda fuera', () => {
  assert.equal(admiteDte({ ...DTE, total: { net: 0, total: 0 } }).motivo, 'sin monto');
});

// ---------- ítems ----------

test('las líneas de Clay se traducen a ítems del motor SIN unidad', () => {
  // Clay no entrega unidad de medida. Inventar una habilitaría el método
  // físico sin sustento — este test existe para que no se agregue.
  const items = itemsDeLineas([
    { line_number: 1, item_name: 'DIESEL', description: 'Petróleo diésel', quantity: 500, unit_price: 900, total_price: 450000 },
  ]);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0], { descripcion: 'Petróleo diésel', cantidad: 500, monto: 450000, unidad: null });
});

test('una línea sin descripción cae al nombre del ítem', () => {
  const [it] = itemsDeLineas([{ item_name: 'SKU-9', description: null, quantity: 1, total_price: 100 }]);
  assert.equal(it.descripcion, 'SKU-9');
});

test('las líneas sin monto se descartan', () => {
  assert.equal(itemsDeLineas([{ item_name: 'x', total_price: 0 }, { item_name: 'y', total_price: -50 }]).length, 0);
});

test('sin detalle de líneas se calcula con un ítem único por el neto', () => {
  const items = itemUnico(DTE);
  assert.equal(items.length, 1);
  assert.equal(items[0].monto, 1000000);
  assert.equal(items[0].unidad, null);
  assert.match(items[0].descripcion, /Factura Electrónica/);
});

test('itemsDeDte usa el detalle cuando existe y el ítem único cuando no', () => {
  const mapa = new Map([[DTE.id, [{ item_name: 'A', total_price: 300000 }, { item_name: 'B', total_price: 700000 }]]]);
  assert.equal(itemsDeDte(DTE, mapa).length, 2);
  assert.equal(itemsDeDte(DTE, new Map()).length, 1);
  assert.equal(itemsDeDte(DTE, null).length, 1);
});

test('la suma del detalle no puede superar al documento por un mapeo cruzado', () => {
  const mapa = agruparLineas([
    { transaction_id: DTE.id, item_name: 'A', total_price: 400000 },
    { transaction_id: 'otro-documento', item_name: 'B', total_price: 999999 },
  ]);
  const items = itemsDeDte(DTE, mapa);
  assert.equal(items.length, 1);
  assert.equal(items[0].monto, 400000);
});

// ---------- agrupación ----------

test('agruparLineas acepta las variantes de nombre del vínculo', () => {
  const m = agruparLineas([
    { transaction_id: 'a', total_price: 1 },
    { dte_id: 'b', total_price: 2 },
    { document_id: 'c', total_price: 3 },
  ]);
  assert.deepEqual([...m.keys()], ['a', 'b', 'c']);
});

test('una línea sin vínculo se descarta en vez de irse al documento equivocado', () => {
  const m = agruparLineas([{ item_name: 'huérfana', total_price: 500 }]);
  assert.equal(m.size, 0);
});

// ---------- resumen ----------

test('el resumen cuenta lo omitido por motivo y declara siempre el método', () => {
  const r = resumirImportacion({
    admitidos: [DTE, DTE],
    omitidos: [{ motivo: 'nota de crédito' }, { motivo: 'nota de crédito' }, { motivo: 'sin monto' }],
  });
  assert.equal(r.documentos, 2);
  assert.equal(r.omitidos, 3);
  assert.deepEqual(r.omitidos_por_motivo, { 'nota de crédito': 2, 'sin monto': 1 });
  assert.match(r.nota_metodo, /por gasto/);
  assert.equal(MOTOR_CLAY, 'propio_clay');
});
