import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateInformeCarbono } from '../src/services/pdf.js';

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

test('generateInformeCarbono nunca recibe ni imprime una clave: la firma no acepta ese campo', async () => {
  // La función solo toma { empresa, periodo, analisis } — no hay forma de
  // pasarle una credencial SII aunque quisiéramos; documentamos el contrato.
  const buf = await generateInformeCarbono({ empresa: EMPRESA, periodo: ANALISIS.periodo, analisis: ANALISIS, password: 'no-debiera-usarse' });
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
});
