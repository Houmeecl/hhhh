import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  validarAcuerdo, validarMeta, evidenciaDisponible, resumenMetas,
  ESTADOS_ACUERDO, ESTADOS_META, TIPOS_META, FUENTES_EVIDENCIA,
} from '../src/services/apl.js';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';

// RUT sintético válido (módulo 11), mismo criterio que inscripcion.test.js.
const RUT_TEST = '78.345.120-4';

// ---------- validadores puros ----------

test('validarAcuerdo: caso feliz y rechazos', () => {
  assert.equal(validarAcuerdo({ nombre: 'APL Logístico de Prueba', plazo_meses: 24 }).ok, true);
  assert.equal(validarAcuerdo({ nombre: '' }).ok, false);
  assert.equal(validarAcuerdo({}).ok, false);
  assert.equal(validarAcuerdo({ nombre: 'x', estado: 'volando' }).ok, false);
  assert.equal(validarAcuerdo({ nombre: 'x', plazo_meses: -3 }).ok, false);
  assert.equal(validarAcuerdo({ nombre: 'x', plazo_meses: 999 }).ok, false);
  assert.equal(validarAcuerdo({ nombre: 'x', fecha_adhesion: 'ayer' }).ok, false);
  for (const e of ESTADOS_ACUERDO) assert.equal(validarAcuerdo({ nombre: 'x', estado: e }).ok, true);
});

test('validarMeta: caso feliz y rechazos', () => {
  assert.equal(validarMeta({ descripcion: 'Cuantificar emisiones GEI anuales' }).ok, true);
  assert.equal(validarMeta({ descripcion: '' }).ok, false);
  assert.equal(validarMeta({}).ok, false);
  assert.equal(validarMeta({ descripcion: 'x', tipo: 'magia' }).ok, false);
  assert.equal(validarMeta({ descripcion: 'x', estado: 'casi' }).ok, false);
  assert.equal(validarMeta({ descripcion: 'x', fuente_evidencia: 'blockchain' }).ok, false);
  for (const t of TIPOS_META) assert.equal(validarMeta({ descripcion: 'x', tipo: t }).ok, true);
  for (const e of ESTADOS_META) assert.equal(validarMeta({ descripcion: 'x', estado: e }).ok, true);
  for (const f of FUENTES_EVIDENCIA) assert.equal(validarMeta({ descripcion: 'x', fuente_evidencia: f }).ok, true);
});

test('validarMeta: no lanza con cuerpo nulo', () => {
  assert.equal(validarMeta(null).ok, false);
  assert.equal(validarAcuerdo(undefined).ok, false);
});

// ============================================================
// Integración contra BD real: migración 065, CHECKs, resumen y
// evidencia agregada. Limpieza total en after().
// ============================================================

let clienteId;

after(async () => {
  if (clienteId) await query('DELETE FROM clientes WHERE id = $1', [clienteId]); // CASCADE limpia acuerdos y metas
  await query(`DELETE FROM sesiones WHERE rut_cliente = $1 AND nombre_cliente = 'APL Test SpA'`, [RUT_TEST]);
  await pool.end();
});

test('migración 065: crea acuerdo + metas, CHECKs activos, resumen correcto', async () => {
  await runMigrations();
  await runMigrations(); // idempotencia

  await query(`DELETE FROM clientes WHERE rut = $1`, [RUT_TEST]);
  const { rows: [cliente] } = await query(
    `INSERT INTO clientes (rut, nombre_empresa) VALUES ($1, 'APL Test SpA') RETURNING id`,
    [RUT_TEST]
  );
  clienteId = cliente.id;

  const { rows: [acuerdo] } = await query(
    `INSERT INTO apl_acuerdos (cliente_id, nombre, sector, plazo_meses)
     VALUES ($1, 'APL de Prueba Sectorial', 'logística', 24) RETURNING *`,
    [clienteId]
  );
  assert.equal(acuerdo.estado, 'adherido', 'estado por defecto');

  // CHECK de estado inválido
  await assert.rejects(
    query(`UPDATE apl_acuerdos SET estado = 'inventado' WHERE id = $1`, [acuerdo.id]),
    /check/i
  );

  await query(
    `INSERT INTO apl_metas (acuerdo_id, numero, descripcion, tipo, estado) VALUES
     ($1, '1.1', 'Cuantificar emisiones GEI', 'emisiones', 'cumplida'),
     ($1, '1.2', 'Plan de gestión de residuos', 'residuos', 'en_avance'),
     ($1, '2.1', 'Capacitar al personal', 'capacitacion', 'pendiente')`,
    [acuerdo.id]
  );

  const r = await resumenMetas(acuerdo.id);
  assert.equal(r.total, 3);
  assert.equal(r.cumplida, 1);
  assert.equal(r.en_avance, 1);
  assert.equal(r.pendiente, 1);
  assert.equal(r.no_aplica, 0);

  // CHECK de fuente_evidencia inválida
  await assert.rejects(
    query(`INSERT INTO apl_metas (acuerdo_id, descripcion, fuente_evidencia) VALUES ($1, 'x', 'humo')`, [acuerdo.id]),
    /check/i
  );

  // Borrar el acuerdo arrastra sus metas (CASCADE)
  const { rows: [otro] } = await query(
    `INSERT INTO apl_acuerdos (cliente_id, nombre) VALUES ($1, 'APL Efímero') RETURNING id`, [clienteId]
  );
  await query(`INSERT INTO apl_metas (acuerdo_id, descripcion) VALUES ($1, 'meta huérfana')`, [otro.id]);
  await query(`DELETE FROM apl_acuerdos WHERE id = $1`, [otro.id]);
  const { rows: huerfanas } = await query(`SELECT 1 FROM apl_metas WHERE acuerdo_id = $1`, [otro.id]);
  assert.equal(huerfanas.length, 0, 'las metas caen con su acuerdo');
});

test('evidenciaDisponible: agrega documentos, CO2e y declaraciones del RUT', async () => {
  const vacia = await evidenciaDisponible('99.999.999-9');
  assert.equal(vacia.documentos, 0);
  assert.equal(vacia.co2e_total_kg, 0);
  assert.equal(vacia.declaraciones_rep, 0);

  const { rows: [sesion] } = await query(
    `INSERT INTO sesiones (rut_cliente, nombre_cliente) VALUES ($1, 'APL Test SpA') RETURNING id`,
    [RUT_TEST]
  );
  await query(
    `INSERT INTO facturas (sesion_id, total_co2e) VALUES ($1, 12.5), ($1, 7.5)`,
    [sesion.id]
  );
  const ev = await evidenciaDisponible(RUT_TEST);
  assert.equal(ev.documentos, 2);
  assert.equal(ev.co2e_total_kg, 20);
  assert.ok(ev.desde && ev.hasta, 'ventana de tiempo presente');

  // La limpieza de sesiones queda en after(); las facturas caen por CASCADE.
});
