import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowFactura, rowLineItem, rowDocumentoCorredor, rowDeclaracionEmbalaje, rowCompensacion, bigquery } from '../src/services/bigquery.js';

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

test('rowFactura incluye la cadena de hash cuando la factura la trae', () => {
  const r = rowFactura(
    { id: 'f1', sesion_id: 's1', hash_documento: 'abc', hash_anterior: '0'.repeat(64), hash_cadena: 'def', eslabon: '3' },
    {}
  );
  assert.equal(r.hash_documento, 'abc');
  assert.equal(r.hash_anterior, '0'.repeat(64));
  assert.equal(r.hash_cadena, 'def');
  assert.equal(r.eslabon, 3);
});

test('rowFactura sin cadena de hash usa null (no revienta con facturas antiguas)', () => {
  const r = rowFactura({ id: 'f1', sesion_id: 's1' }, {});
  assert.equal(r.hash_documento, null);
  assert.equal(r.hash_cadena, null);
  assert.equal(r.eslabon, null);
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

// ---------- rowDeclaracionEmbalaje ----------

test('rowDeclaracionEmbalaje mapea la declaración completa', () => {
  const decl = {
    id: 'd1', sesion_id: 's1',
    componentes: [{ material: 'plasticos', peso_gr: 500, cantidad: 2, reciclable: true }],
    peso_total_gr: '1000', peso_reciclable_gr: '1000', porcentaje: '100.0', nivel: 'Alto',
    created_at: '2026-07-15T00:00:00Z',
  };
  const row = rowDeclaracionEmbalaje(decl, { rut_cliente: '11.111.111-1' });
  assert.equal(row.id, 'd1');
  assert.equal(row.sesion_id, 's1');
  assert.equal(row.rut_cliente, '111111111'); // normalizado sin puntos ni guión
  assert.equal(row.n_componentes, 1);
  assert.equal(JSON.parse(row.componentes)[0].material, 'plasticos');
  assert.equal(row.peso_total_gr, 1000);
  assert.equal(row.porcentaje, 100);
  assert.equal(row.nivel, 'Alto');
  assert.equal(row.created_at, '2026-07-15T00:00:00.000Z');
});

test('rowDeclaracionEmbalaje tolera campos ausentes sin lanzar', () => {
  const row = rowDeclaracionEmbalaje({ id: 'd2', sesion_id: 's2' }, null);
  assert.equal(row.rut_cliente, null);
  assert.equal(row.n_componentes, 0);
  assert.equal(row.componentes, '[]');
  assert.equal(row.peso_total_gr, 0);
  assert.equal(row.nivel, null);
});

test('exportDeclaracionEmbalaje apagado es no-op silencioso', async () => {
  const res = await bigquery.exportDeclaracionEmbalaje({ id: 'd3', sesion_id: 's3' }, {});
  assert.equal(res, false);
});

// ---------- rowCompensacion (POS Aduana Verde) ----------

test('rowCompensacion mapea el cobro completo con RUT normalizado', () => {
  const comp = {
    id: 'c1', sesion_id: 's1', terminal_id: 't1',
    t_co2e: '0.582', tarifa_clp_tco2e: '5000', monto_clp: '2910',
    metodo: 'tarjeta', estado: 'simulado', created_at: '2026-07-19T00:00:00Z',
  };
  const row = rowCompensacion(comp, { rut_cliente: '11.111.111-1' });
  assert.equal(row.id, 'c1');
  assert.equal(row.sesion_id, 's1');
  assert.equal(row.rut_cliente, '111111111');  // sin puntos ni guión
  assert.equal(row.terminal_id, 't1');
  assert.equal(row.t_co2e, 0.582);             // NUMERIC de pg (string) → Number
  assert.equal(row.tarifa_clp_tco2e, 5000);
  assert.equal(row.monto_clp, 2910);
  assert.equal(row.metodo, 'tarjeta');
  assert.equal(row.estado, 'simulado');
  assert.equal(row.created_at, '2026-07-19T00:00:00.000Z');
});

test('rowCompensacion tolera campos ausentes sin lanzar (omitido sin terminal)', () => {
  const row = rowCompensacion({ id: 'c2', sesion_id: 's2', estado: 'omitido' }, null);
  assert.equal(row.rut_cliente, null);
  assert.equal(row.terminal_id, null);
  assert.equal(row.t_co2e, 0);
  assert.equal(row.monto_clp, 0);
  assert.equal(row.metodo, null);
  assert.equal(row.estado, 'omitido');
  assert.ok(row.created_at.endsWith('Z'));
});

test('exportCompensacion apagado es no-op silencioso', async () => {
  const res = await bigquery.exportCompensacion({ id: 'c3', sesion_id: 's3' }, {});
  assert.equal(res, false);
});
