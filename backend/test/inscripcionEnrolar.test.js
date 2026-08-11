import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { prospectoDesdeInscripcion } from '../src/services/inscripcion.js';
import { EN_PRODUCCION, SALTO_PROD } from './util/soloDev.js';

// ============================================================
// Invariantes de BD que sostienen POST /admin/solicitudes-inscripcion/:id/enrolar
// (routes/admin.js): la solicitud se resuelve, la empresa se crea o
// reutiliza por RUT, y el acceso web queda 1:1 por proveedor — exactamente
// el mismo patrón que crearCuentaEntidad usa para los otros paneles.
// No se levanta el servidor HTTP (no hay ese patrón en este archivo);
// se ejercen las mismas sentencias SQL que la ruta usa dentro de la
// transacción, contra la BD real.
// ============================================================

const RUT = '78345120-4'; // sintético válido (módulo 11), normalizado sin puntos/guión

after(async () => {
  if (!EN_PRODUCCION) {
    await query(`DELETE FROM usuarios WHERE proveedor_id IN (SELECT id FROM proveedores WHERE rut = $1)`, [RUT]);
    await query(`DELETE FROM proveedores WHERE rut = $1`, [RUT]);
    await query(`DELETE FROM solicitudes_inscripcion WHERE rut = $1`, ['78.345.120-4']);
    await query(`DELETE FROM prospectos WHERE rut = $1`, ['78.345.120-4']);
  }
  await pool.end();
});

test('enrolar desde inscripción: crea la empresa y su acceso, uno solo por proveedor', { skip: SALTO_PROD }, async () => {
  await runMigrations();
  await query(`DELETE FROM usuarios WHERE proveedor_id IN (SELECT id FROM proveedores WHERE rut = $1)`, [RUT]);
  await query(`DELETE FROM proveedores WHERE rut = $1`, [RUT]);
  await query(`DELETE FROM solicitudes_inscripcion WHERE rut = $1`, ['78.345.120-4']);

  // Empresa nueva por RUT (mismo criterio que la ruta: SELECT primero, INSERT si no existe).
  let { rows: existentes } = await query(`SELECT * FROM proveedores WHERE rut = $1`, [RUT]);
  assert.equal(existentes.length, 0);
  const { rows: nueva } = await query(
    `INSERT INTO proveedores (nombre_empresa, rut) VALUES ($1,$2) RETURNING *`,
    ['Fábrica de Prueba Ltda.', RUT]
  );
  const empresa = nueva[0];
  assert.equal(empresa.rut, RUT);

  // Acceso web: panel='proveedor', proveedor_id = la empresa recién creada.
  const { rows: usuario } = await query(
    `INSERT INTO usuarios (email, nombre, rol, panel, proveedor_id, nivel_acceso, estado, password_hash, must_reset_password)
     VALUES ($1,$2,'operador','proveedor',$3,'operador','activo','hash-de-prueba',true)
     RETURNING id`,
    ['ana@fabrica-prueba.cl', 'Ana Prueba', empresa.id]
  );
  assert.equal(usuario.length, 1);

  // Reintentar sobre la misma empresa: la ruta detecta que ya tiene cuenta
  // (SELECT id FROM usuarios WHERE proveedor_id = $1) y no crea una segunda.
  const { rows: yaTiene } = await query(`SELECT id FROM usuarios WHERE proveedor_id = $1`, [empresa.id]);
  assert.equal(yaTiene.length, 1, 'ya existe exactamente un acceso para esta empresa');

  // Reenrolar el mismo RUT reutiliza la empresa, no la duplica.
  ({ rows: existentes } = await query(`SELECT * FROM proveedores WHERE rut = $1`, [RUT]));
  assert.equal(existentes.length, 1);
  assert.equal(existentes[0].id, empresa.id);
});

test('enrolar desde inscripción: crea el prospecto etapa "ganado" y lo vincula (antes desaparecía del pipeline)', { skip: SALTO_PROD }, async () => {
  await runMigrations();
  await query(`DELETE FROM prospectos WHERE rut = $1`, ['78.345.120-4']);
  await query(`DELETE FROM solicitudes_inscripcion WHERE rut = $1`, ['78.345.120-4']);

  const { rows: solRows } = await query(
    `INSERT INTO solicitudes_inscripcion
       (rut, nombre_empresa, contacto_nombre, contacto_email, intereses)
     VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING *`,
    ['78.345.120-4', 'Fábrica de Prueba Ltda.', 'Ana Prueba', 'ana@fabrica-prueba.cl', JSON.stringify(['carbono'])]
  );
  const sol = solRows[0];

  // Mismo SQL que la ruta usa dentro de la transacción de enrolar.
  const base = prospectoDesdeInscripcion(sol);
  const { rows: pRows } = await query(
    `INSERT INTO prospectos (nombre_empresa, rut, contacto, etapa, origen, notas)
     VALUES ($1,$2,$3,'ganado',$4,$5) RETURNING id, etapa`,
    [base.nombre_empresa, base.rut, base.contacto, base.origen, base.notas]
  );
  assert.equal(pRows[0].etapa, 'ganado');

  await query(
    `UPDATE solicitudes_inscripcion SET estado = 'convertida', prospecto_id = $2 WHERE id = $1`,
    [sol.id, pRows[0].id]
  );

  const { rows: check } = await query(
    `SELECT s.prospecto_id, p.etapa, p.rut FROM solicitudes_inscripcion s
     JOIN prospectos p ON p.id = s.prospecto_id WHERE s.id = $1`,
    [sol.id]
  );
  assert.equal(check[0].prospecto_id, pRows[0].id);
  assert.equal(check[0].etapa, 'ganado');
  assert.equal(check[0].rut, '78.345.120-4');
});
