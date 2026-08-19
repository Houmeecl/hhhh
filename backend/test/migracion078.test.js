import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '../src/lib/db.js';
import { SALTO_PROD } from './util/soloDev.js';

// ============================================================
// Migración 078 — dos valores más para `facturas.categoria_origen`.
//
// El CHECK de la 077 solo admitía 'glosa' | 'sin_coincidencia' | NULL, y
// faltaban dos casos:
//
//  · 'sin_categoria' — el motor no tuvo QUÉ clasificar (nota de crédito, todos
//    los ítems descartados). Hoy caía en 'sin_coincidencia', y el panel del
//    mandante le respondía al cliente "sin coincidencia en el motor", cuyo
//    remedio documentado es agregar la palabra clave que falta: consejo falso.
//
//  · 'operador' — la asignó una persona en la bandeja de revisión manual.
//    Nadie lo escribe todavía; el CHECK se amplía para que pueda existir.
//
// LOS DOS ÚLTIMOS CASOS TOCAN LA BASE Y POR ESO SE SALTAN EN PRODUCCIÓN.
// `deploy/actualizar.sh` corre `npm test` en el VPS ANTES de reiniciar, con
// backend/.env apuntando a la base REAL: sin esta guarda, cada despliegue
// insertaba una sesión «Prueba 078» y sus facturas en producción y después
// las borraba. `facturas` está encadenada por hash — crear y borrar filas
// ahí en cada deploy no es un detalle cosmético. Los dos primeros casos
// leen el .sql y siguen corriendo en todas partes.
// ============================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRACION = path.join(__dirname, '../migrations/078_categoria_origen_ampliado.sql');
const sql = fs.readFileSync(MIGRACION, 'utf8');

test('078: es idempotente por construcción (DROP IF EXISTS antes del ADD)', () => {
  assert.match(sql, /DROP CONSTRAINT IF EXISTS facturas_categoria_origen_check/);
  const adds = sql.match(/ADD CONSTRAINT facturas_categoria_origen_check/g) || [];
  assert.equal(adds.length, 1, 'un solo ADD, o correrla dos veces falla');
});

test('078: no hace backfill (no hay forma de saber hacia atrás cuál era cuál)', () => {
  assert.ok(!/UPDATE\s+facturas/i.test(sql), 'reinterpretar filas ya guardadas sería inventar');
});

test('078: el CHECK vigente en la base admite los cuatro valores y rechaza el resto', { skip: SALTO_PROD }, async () => {
  const { rows } = await query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conname = 'facturas_categoria_origen_check'`
  );
  assert.ok(rows[0], 'la migración corrió en el arranque de la suite');
  for (const v of ['glosa', 'sin_coincidencia', 'sin_categoria', 'operador']) {
    assert.ok(rows[0].def.includes(`'${v}'`), `falta ${v} en el CHECK`);
  }
  assert.ok(!rows[0].def.includes("'razon_social'"), 'ese vocabulario es de dte_proveedor, no de facturas');
});

test('078: la base acepta un INSERT con los valores nuevos y rechaza uno inventado', { skip: SALTO_PROD }, async () => {
  const { rows: sRows } = await query(
    `INSERT INTO sesiones (nombre_cliente, rut_cliente) VALUES ('Prueba 078', '11.111.111-1') RETURNING id`
  );
  const sesionId = sRows[0].id;
  try {
    for (const origen of ['sin_categoria', 'operador']) {
      await query(
        `INSERT INTO facturas (sesion_id, archivo_original, total_co2e, categoria_origen, status)
         VALUES ($1, $2, 0, $3, 'procesada')`,
        [sesionId, `f-${origen}.pdf`, origen]
      );
    }
    await assert.rejects(
      () => query(
        `INSERT INTO facturas (sesion_id, archivo_original, total_co2e, categoria_origen, status)
         VALUES ($1, 'f-malo.pdf', 0, 'inventado', 'procesada')`,
        [sesionId]
      ),
      /categoria_origen/,
      'el CHECK sigue cerrado a valores fuera del vocabulario'
    );
  } finally {
    // Solo las filas de esta prueba: el DELETE va por la sesión recién creada.
    await query(`DELETE FROM facturas WHERE sesion_id = $1`, [sesionId]);
    await query(`DELETE FROM sesiones WHERE id = $1`, [sesionId]);
  }
});
