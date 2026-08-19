import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { EN_PRODUCCION, SALTO_PROD } from './util/soloDev.js';

// ============================================================
// Que el mismo documento no entre dos veces.
//
// EL BUG QUE ESTOS CASOS IMPIDEN QUE VUELVA: `routes/public.js` calculaba
// el sha256 de cada archivo, lo guardaba y NUNCA lo consultaba. El único
// índice único de `facturas` cubría `clay_id`. Subir dos veces el mismo
// PDF creaba dos facturas, DOS eslabones en la cadena de hash, dos cargos
// en Capital Natural y doblaba el CO2e del cliente.
//
// La detección vive en la ruta (antes de la transacción, para no gastar
// un crédito en algo que ya está). Lo que se prueba acá es el contrato de
// datos del que depende: que las columnas y los índices existan, que la
// consulta de búsqueda encuentre lo que tiene que encontrar y no lo que
// no, y que el rechazo se pueda registrar.
// ============================================================

before(async () => { if (!EN_PRODUCCION) await runMigrations(); });
after(async () => { await pool.end(); });

async function sesionDePrueba() {
  const { rows } = await query(
    `INSERT INTO sesiones (rut_cliente, nombre_cliente, email_cliente)
     VALUES ('11.111.111-1', $1, 'dup@ejemplo.cl') RETURNING *`,
    [`Dup ${crypto.randomUUID().slice(0, 8)}`]
  );
  return rows[0];
}
async function limpiar(sesionId) {
  await query(`DELETE FROM line_items WHERE factura_id IN (SELECT id FROM facturas WHERE sesion_id = $1)`, [sesionId]);
  await query(`DELETE FROM facturas WHERE sesion_id = $1`, [sesionId]);
  await query(`DELETE FROM sesiones WHERE id = $1`, [sesionId]);
}
const insertarFactura = (sesionId, { sha, tipo = null, folio = null, emisor = '76.111.111-1' }) => query(
  `INSERT INTO facturas (sesion_id, numero_venta, archivo_original, rut_emisor, rut_receptor,
                         total_co2e, categoria, status, sha256, tipo_dte, folio)
   VALUES ($1, $2, 'f.xml', $3, '11.111.111-1', 0.12, 'combustible', 'procesada', $4, $5, $6)
   RETURNING id`,
  [sesionId, folio ? `F-${folio}` : 'F-1', emisor, sha, tipo, folio]
);

test('la identidad tributaria del documento se puede guardar', { skip: SALTO_PROD }, async () => {
  // Antes solo sobrevivía `numero_venta` como texto ('F-1234'), del que no
  // se puede recuperar el tipo ni comparar de forma fiable.
  const s = await sesionDePrueba();
  try {
    const { rows } = await insertarFactura(s.id, { sha: 'a'.repeat(64), tipo: 33, folio: '9001' });
    const { rows: leida } = await query(`SELECT tipo_dte, folio, sha256 FROM facturas WHERE id = $1`, [rows[0].id]);
    assert.equal(leida[0].tipo_dte, 33);
    assert.equal(leida[0].folio, '9001');
    assert.equal(leida[0].sha256, 'a'.repeat(64));
  } finally { await limpiar(s.id); }
});

test('EL CASO: la consulta encuentra un archivo ya cargado por su sha256', { skip: SALTO_PROD }, async () => {
  const s = await sesionDePrueba();
  const sha = crypto.randomBytes(32).toString('hex');
  try {
    await insertarFactura(s.id, { sha });
    // Exactamente la consulta que hace la ruta antes de la transacción.
    const { rows } = await query(
      `SELECT f.sha256, f.sesion_id FROM facturas f JOIN sesiones s ON s.id = f.sesion_id
        WHERE f.sha256 = ANY($1::text[])`,
      [[sha, crypto.randomBytes(32).toString('hex')]]
    );
    assert.equal(rows.length, 1, 'no encontró el archivo que ya estaba');
    assert.equal(rows[0].sesion_id, s.id);
  } finally { await limpiar(s.id); }
});

test('el mismo DOCUMENTO se detecta aunque el archivo sea otro', { skip: SALTO_PROD }, async () => {
  // Un documento re-escaneado o convertido tiene otro sha256 pero el mismo
  // folio. El folio es correlativo por emisor y tipo: los tres juntos son
  // la identidad real de un DTE en Chile.
  const s = await sesionDePrueba();
  try {
    await insertarFactura(s.id, { sha: crypto.randomBytes(32).toString('hex'), tipo: 33, folio: '9002' });
    const { rows } = await query(
      `SELECT f.folio FROM facturas f JOIN sesiones s ON s.id = f.sesion_id
        WHERE (regexp_replace(f.rut_emisor, '[^0-9kK]', '', 'g'), f.tipo_dte, f.folio) IN (($1,$2,$3))`,
      ['761111111', 33, '9002']
    );
    assert.equal(rows.length, 1, 'no detectó el mismo documento con otro archivo');
  } finally { await limpiar(s.id); }
});

test('un folio igual de OTRO emisor NO es duplicado', { skip: SALTO_PROD }, async () => {
  // El folio es correlativo POR EMISOR: dos empresas distintas emiten su
  // folio 9003 el mismo día, y son documentos distintos. Sin el RUT en la
  // clave, esto sería un falso positivo que bloquearía cargas legítimas.
  const s = await sesionDePrueba();
  try {
    await insertarFactura(s.id, { sha: crypto.randomBytes(32).toString('hex'), tipo: 33, folio: '9003', emisor: '76.111.111-1' });
    const { rows } = await query(
      `SELECT f.folio FROM facturas f
        WHERE (regexp_replace(f.rut_emisor, '[^0-9kK]', '', 'g'), f.tipo_dte, f.folio) IN (($1,$2,$3))`,
      ['762222222', 33, '9003']
    );
    assert.equal(rows.length, 0, 'confundió el folio de dos emisores distintos');
  } finally { await limpiar(s.id); }
});

test('el mismo folio con distinto TIPO tampoco es duplicado', { skip: SALTO_PROD }, async () => {
  // Una factura 33 y una boleta 39 llevan correlativos independientes.
  const s = await sesionDePrueba();
  try {
    await insertarFactura(s.id, { sha: crypto.randomBytes(32).toString('hex'), tipo: 33, folio: '9004' });
    const { rows } = await query(
      `SELECT f.folio FROM facturas f
        WHERE (regexp_replace(f.rut_emisor, '[^0-9kK]', '', 'g'), f.tipo_dte, f.folio) IN (($1,$2,$3))`,
      ['761111111', 39, '9004']
    );
    assert.equal(rows.length, 0);
  } finally { await limpiar(s.id); }
});

test('el rechazo por duplicado se puede registrar en la bitácora', { skip: SALTO_PROD }, async () => {
  // Si el motivo no estuviera en el CHECK, el rechazo reventaría y el
  // cliente vería desaparecer su documento sin explicación.
  const ref = `dup-test-${crypto.randomUUID().slice(0, 8)}`;
  await query(
    `INSERT INTO documentos_rechazados (nombre_archivo, extension, tamano_bytes, sha256, motivo, etapa_alcanzada, rut_cliente)
     VALUES ($1, 'xml', 100, $2, 'duplicado', 'xml', '11.111.111-1')`,
    [ref, crypto.randomBytes(32).toString('hex')]
  );
  const { rows } = await query(`SELECT motivo FROM documentos_rechazados WHERE nombre_archivo = $1`, [ref]);
  assert.equal(rows[0].motivo, 'duplicado');
  await query(`DELETE FROM documentos_rechazados WHERE nombre_archivo = $1`, [ref]);
});

test('los índices de búsqueda de duplicados existen', { skip: SALTO_PROD }, async () => {
  // No son UNIQUE a propósito: crearlos así falló contra datos reales
  // —ya había duplicados— y `migrate.js` corre al ARRANCAR, así que un
  // índice único habría dejado el backend sin levantar. La unicidad la
  // hace cumplir la ruta; estos índices solo la hacen barata.
  const { rows } = await query(
    `SELECT indexname, indexdef FROM pg_indexes
      WHERE tablename = 'facturas' AND indexname IN ('idx_facturas_sha256', 'idx_facturas_dte')`
  );
  assert.equal(rows.length, 2, 'faltan los índices de la migración 104');
  for (const r of rows) {
    assert.ok(/WHERE/i.test(r.indexdef), `${r.indexname} tiene que ser parcial`);
    assert.equal(/UNIQUE/i.test(r.indexdef), false,
      `${r.indexname} NO puede ser único: rompería el arranque contra una base con duplicados`);
  }
});
