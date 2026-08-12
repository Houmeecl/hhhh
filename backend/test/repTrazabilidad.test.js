import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateReporteRepTrazabilidad } from '../src/services/pdf.js';

// ============================================================
// PDF de trazabilidad 360 (Ley REP): composición declarada → ventas del
// período → validación RCV → evidencia fotográfica + hashes de
// integridad. Un solo documento con las cuatro perspectivas.
// ============================================================

// JPEG mínimo válido (1×1 px blanco) — PDFKit necesita poder decodificarlo
// de verdad para probar la sección de fotos embebidas, a diferencia de
// repFotoEmbalaje.test.js (que solo verifica que el binario se guarda y se
// sirve intacto, sin necesitar que sea una imagen real).
const JPEG_1PX = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=',
  'base64'
);

const EMPRESA = { nombre_empresa: 'Envases del Norte SpA', rut: '76.570.751-K' };

const PRODUCTO_BASE = {
  nombre: 'Botella 1L', codigo: 'B-1', componentes: [{ material: 'plasticos', peso_gr: 30, cantidad: 1, reciclable: true }],
  peso_total_gr: 35, peso_reciclable_gr: 30, porcentaje: 85.7, nivel: 'Alto', activo: true,
  foto_embalaje: null, foto_sha256: null,
};

const VENTA_BASE = {
  id: 'v1', numero_documento: 'F-123', fecha_documento: '2026-06-15', periodo: '2026-06',
  kg_envases: 3.5, kg_reciclables: 3.0, sha256: 'a'.repeat(64),
  items: [{ producto_id: 'p1', nombre: 'Botella 1L', unidades: 100, peso_total_gr: 35, peso_reciclable_gr: 30, componentes: PRODUCTO_BASE.componentes }],
  consta_en_rcv: true,
};

const RESUMEN_VACIO = { por_material: [], por_periodo: [], total: { kg_envases: 0, kg_reciclables: 0, n_ventas: 0, n_unidades: 0 } };
const RESUMEN_CON_DATOS = {
  por_material: [{ material: 'plasticos', nombre: 'Plásticos', kg: 3.5, kg_reciclables: 3.0 }],
  por_periodo: [{ periodo: '2026-06', kg_envases: 3.5, kg_reciclables: 3.0, n_ventas: 1 }],
  total: { kg_envases: 3.5, kg_reciclables: 3.0, n_ventas: 1, n_unidades: 100 },
};

test('genera un PDF válido con catálogo, ventas y foto embebida', async () => {
  const buf = await generateReporteRepTrazabilidad({
    empresa: EMPRESA, periodo: '2026-06',
    productos: [{ ...PRODUCTO_BASE, foto_embalaje: JPEG_1PX, foto_sha256: 'b'.repeat(64) }],
    ventas: [VENTA_BASE],
    resumen: RESUMEN_CON_DATOS,
  });
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 500, 'el PDF no debería estar vacío');
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
});

test('funciona sin ventas ni fotos (catálogo recién creado, sin período con datos)', async () => {
  const buf = await generateReporteRepTrazabilidad({
    empresa: EMPRESA, periodo: '2026-07',
    productos: [PRODUCTO_BASE],
    ventas: [],
    resumen: RESUMEN_VACIO,
  });
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
});

test('funciona con catálogo vacío (proveedor sin productos aún)', async () => {
  const buf = await generateReporteRepTrazabilidad({
    empresa: EMPRESA, periodo: '2026-07',
    productos: [],
    ventas: [],
    resumen: RESUMEN_VACIO,
  });
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
});

test('una foto con bytes que no son una imagen real no revienta el PDF (fallback visual)', async () => {
  const buf = await generateReporteRepTrazabilidad({
    empresa: EMPRESA, periodo: '2026-06',
    productos: [{ ...PRODUCTO_BASE, foto_embalaje: Buffer.from('no soy una imagen de verdad'), foto_sha256: 'c'.repeat(64) }],
    ventas: [],
    resumen: RESUMEN_VACIO,
  });
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
});

test('consta_en_rcv=false y null se distinguen en el PDF (no revienta con ninguno de los tres estados)', async () => {
  for (const estado of [true, false, null]) {
    const buf = await generateReporteRepTrazabilidad({
      empresa: EMPRESA, periodo: '2026-06',
      productos: [PRODUCTO_BASE],
      ventas: [{ ...VENTA_BASE, consta_en_rcv: estado }],
      resumen: RESUMEN_CON_DATOS,
    });
    assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-', `estado ${estado} no debería reventar`);
  }
});
