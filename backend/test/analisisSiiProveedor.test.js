import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { descargarYCalcular, analizarPeriodo } from '../src/services/analisisSiiProveedor.js';
import { query, pool, withTx } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { EN_PRODUCCION, SALTO_PROD } from './util/soloDev.js';

// Descarga + cálculo + UPSERT contra la BD real de test, con la red al SII
// completamente simulada (fetcher inyectado). Verifica el camino completo
// que usan el panel del proveedor y la sección admin "SII".

const CFG = { enabled: true, key: 'clave_api_servidor_no_real', base: 'https://baseapi.invalido', timeoutMs: 2000 };
const RUT_SII = '78345120-4';      // persona que se autentica (módulo 11 ok)
const RUT_EMPRESA = '783451204';   // proveedores.rut va normalizado
const CLAVE = 'clave_sii_de_prueba_no_real';
const PERIODO = '2025-03';

const DTE_RECIBIDO = {
  tipo_dte: 33, folio: 501, fecha: '2025-03-10', rut_emisor: '77.000.000-0',
  razon_social_emisor: 'COMBUSTIBLES BETA SPA', monto_total: 595000,
};
const FILA_VENTA = {
  'Tipo Doc': '33', 'RUT Cliente': '76.543.210-3', 'Razon Social': 'CLIENTE GAMA LTDA',
  'Folio': '900', 'Fecha Docto': '12/03/2025', 'Monto Neto': '1000000', 'Monto IVA': '190000', 'Monto total': '1190000',
};

// Fetcher según URL: validar → ok; DTE recibidos → 1 compra; RCV venta → 1 venta.
const fetcher = async (url) => {
  let body = { success: true };
  if (/\/dte\/recibidos\//.test(url)) body = { success: true, data: { documentos: [DTE_RECIBIDO] } };
  else if (/\/rcv\//.test(url)) body = { success: true, data: { datos: [FILA_VENTA] } };
  return { ok: true, status: 200, json: async () => body };
};

test('descargarYCalcular: descarga simulada, calcula y persiste idempotente', { skip: EN_PRODUCCION && SALTO_PROD }, async () => {
  await runMigrations();
  await query(`DELETE FROM proveedores WHERE rut = $1`, [RUT_EMPRESA]);
  const { rows } = await query(
    `INSERT INTO proveedores (nombre_empresa, rut) VALUES ('Empresa Test SII', $1) RETURNING id`,
    [RUT_EMPRESA]
  );
  const proveedorId = rows[0].id;

  const r1 = await descargarYCalcular(
    { query, withTx, proveedorId, rutEmpresa: RUT_EMPRESA, rutSii: RUT_SII, password: CLAVE, periodo: PERIODO },
    { fetcher, cfg: CFG }
  );
  assert.equal(r1.documentos, 2); // 1 compra + 1 venta
  assert.equal(r1.analisis.resumen.compra.n, 1);
  assert.equal(r1.analisis.resumen.venta.n, 1);
  assert.equal(r1.analisis.resumen.venta.total, 1190000);
  // La compra sin XML cae a método por gasto; si el motor está sembrado, hay co2e.
  const compra = r1.analisis.documentos.find((d) => d.tipo === 'compra');
  assert.equal(compra.folio, '501');
  assert.ok(compra.co2e === null || Number(compra.co2e) >= 0);

  // Re-descargar el mismo período NO duplica (UPSERT idempotente).
  const r2 = await descargarYCalcular(
    { query, withTx, proveedorId, rutEmpresa: RUT_EMPRESA, rutSii: RUT_SII, password: CLAVE, periodo: PERIODO },
    { fetcher, cfg: CFG }
  );
  assert.equal(r2.analisis.documentos.length, 2);

  // La clave JAMÁS queda en lo persistido.
  const { rows: crudos } = await query(`SELECT * FROM dte_proveedor WHERE proveedor_id = $1`, [proveedorId]);
  assert.ok(!JSON.stringify(crudos).includes(CLAVE), 'la clave no puede aparecer en dte_proveedor');

  // analizarPeriodo directo devuelve lo mismo que el análisis embebido.
  const a = await analizarPeriodo(query, proveedorId, PERIODO);
  assert.equal(a.documentos.length, 2);

  await query(`DELETE FROM proveedores WHERE id = $1`, [proveedorId]); // CASCADE limpia dte_proveedor
});

after(async () => { await pool.end(); });
