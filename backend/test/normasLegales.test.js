import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { EN_PRODUCCION, SALTO_PROD } from './util/soloDev.js';

// ============================================================
// Migración 098 — normas legales en el registro citable.
//
// El punto de todo esto: sicr3p SELLA cálculos que se apoyan en reglas,
// y una regla "aprobada" puede no entrar nunca en vigencia (marzo 2026:
// 43 decretos ambientales retirados de Contraloría, incluido el que
// habría hecho obligatorio el reporte de GEI). El registro tiene que
// poder decir que algo NO está vigente.
// ============================================================

before(async () => { if (!EN_PRODUCCION) await runMigrations(); });
after(async () => { await pool.end(); });

test('las 11 fuentes metodológicas previas siguen intactas y marcadas como metodología', { skip: SALTO_PROD }, async () => {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM fuentes_metodologicas WHERE tipo = 'metodologia'`
  );
  // La migración no debe reclasificar ni borrar nada de lo que ya había.
  assert.ok(rows[0].n >= 11, `esperaba al menos las 11 originales, hay ${rows[0].n}`);

  const { rows: gh } = await query(
    `SELECT tipo, estado FROM fuentes_metodologicas WHERE codigo = 'ghg_protocol_2004'`
  );
  assert.equal(gh[0].tipo, 'metodologia');
  assert.equal(gh[0].estado, 'validada_oficial'); // no se tocó
});

test('el reglamento del RETC queda registrado como RETIRADO, no como vigente', { skip: SALTO_PROD }, async () => {
  const { rows } = await query(
    `SELECT estado, notas FROM fuentes_metodologicas WHERE codigo = 'reglamento_retc_2025'`
  );
  assert.equal(rows[0].estado, 'retirada');
  // La consecuencia práctica queda escrita donde se lee, no solo en un commit.
  assert.match(rows[0].notas, /VOLUNTARIO/);
});

test('D.S. 22/2025 (pilas y AEE) está promulgado con vigencia futura, no vigente', { skip: SALTO_PROD }, async () => {
  const { rows } = await query(
    `SELECT estado, fecha_publicacion, fecha_vigencia FROM fuentes_metodologicas WHERE codigo = 'ds_22_2025_pilas_aee'`
  );
  assert.equal(rows[0].estado, 'promulgada');
  // Publicado ya, pero las metas rigen después: el sistema no debe
  // exigirlas todavía.
  assert.ok(rows[0].fecha_vigencia > rows[0].fecha_publicacion);
});

test('toda norma legal trae URL citable y las que faltan validar lo dicen', { skip: SALTO_PROD }, async () => {
  const { rows } = await query(
    `SELECT codigo, url, notas FROM fuentes_metodologicas WHERE tipo = 'norma_legal'`
  );
  assert.ok(rows.length >= 5);
  for (const r of rows) {
    assert.ok(r.url && r.url.startsWith('http'), `${r.codigo} sin URL citable`);
  }
  // Las dos con cifras sin verificar contra el texto oficial deben decirlo
  // explícitamente: es la diferencia entre un dato y una suposición.
  const pendientes = rows.filter((r) => /PENDIENTE DE VALIDAR/.test(r.notas || ''));
  assert.ok(
    pendientes.some((r) => r.codigo === 'ds_12_2020_envases'),
    'el D.S. 12 debe declarar qué cifras faltan validar'
  );
  assert.ok(
    pendientes.some((r) => r.codigo === 'ds_22_2025_pilas_aee'),
    'el D.S. 22 debe declarar qué cifras faltan validar'
  );
});

test('el CHECK de estado acepta el ciclo legal y rechaza un estado inventado', { skip: SALTO_PROD }, async () => {
  for (const estado of ['vigente', 'promulgada', 'en_tramitacion', 'retirada', 'derogada']) {
    const codigo = `prueba_estado_${estado}`;
    await query(
      `INSERT INTO fuentes_metodologicas (codigo, tipo, organismo, documento, estado)
       VALUES ($1,'norma_legal','Prueba','Documento de prueba',$2)`,
      [codigo, estado]
    );
    await query(`DELETE FROM fuentes_metodologicas WHERE codigo = $1`, [codigo]);
  }
  await assert.rejects(
    query(
      `INSERT INTO fuentes_metodologicas (codigo, tipo, organismo, documento, estado)
       VALUES ('prueba_estado_malo','norma_legal','Prueba','Doc','casi_vigente')`
    ),
    /estado_check/
  );
});

test('el CHECK de tipo rechaza una categoría inventada', { skip: SALTO_PROD }, async () => {
  await assert.rejects(
    query(
      `INSERT INTO fuentes_metodologicas (codigo, tipo, organismo, documento)
       VALUES ('prueba_tipo_malo','recomendacion','Prueba','Doc')`
    ),
    /tipo_check/
  );
});
