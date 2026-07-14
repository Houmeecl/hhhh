import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowFactura, rowLineItem, rowDocumentoCorredor, bigquery } from '../src/services/bigquery.js';

test('rowFactura normaliza RUT y tipos para el warehouse', () => {
  const r = rowFactura(
    { id: 'f1', sesion_id: 's1', numero_venta: 'F-1234', archivo_original: 'dte.xml',
      rut_emisor: '76.123.456-0', rut_receptor: '11.111.111-1', categoria: 'Agua',
      total_co2e: '0.582', created_at: '2026-07-14T00:00:00Z' },
    { rut_cliente: '11.111.111-1', nombre_cliente: 'Prueba SpA' }
  );
  assert.equal(r.rut_emisor, '761234560');       // sin puntos ni guión
  assert.equal(r.rut_receptor, '111111111');
  assert.equal(r.rut_cliente, '111111111');
  assert.equal(r.total_co2e, 0.582);              // numérico
  assert.equal(r.origen, 'flujo_publico');
  assert.ok(r.created_at.endsWith('Z'));
});

test('rowLineItem y rowDocumentoCorredor son numéricos y completos', () => {
  const li = rowLineItem({ descripcion: 'kWh', cantidad: '2', co2e: '1.5', porcentaje_total: '50' }, 'f1');
  assert.deepEqual(li, { factura_id: 'f1', descripcion: 'kWh', cantidad: 2, co2e: 1.5, porcentaje_total: 50 });

  const dc = rowDocumentoCorredor({ id: 'd1', pais_origen: 'BR', pais_destino: 'CL',
    tipo_documento: 'mic_dta', numero_documento: 'MIC-1', rut_emisor: '78.222.333-K',
    estado: 'traza', total_co2e: 0, created_at: '2026-07-14T00:00:00Z' });
  assert.equal(dc.rut_emisor, '78222333K');
  assert.equal(dc.origen, 'corredor');
  assert.equal(dc.tipo_documento, 'mic_dta');
});

test('con BIGQUERY_EXPORT apagado el export es un no-op silencioso', async () => {
  assert.equal(bigquery.enabled, false);
  const res = await bigquery.exportSesion({ sesion: {}, facturas: [{ id: 'x', items: [] }] });
  assert.deepEqual(res, [false, false]); // no exporta, no lanza
});
