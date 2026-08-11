import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import crypto from 'crypto';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import mandanteRoutes from '../src/routes/mandante.js';
import { hashApiKey } from '../src/services/mandante.js';
import { EN_PRODUCCION, SALTO_PROD } from './util/soloDev.js';

// ============================================================
// GET /api/mandante/export/alcance3 — el CSV que el mandante pega en su
// memoria anual bajo NCG 461 / IFRS S2.
//
// Lo que se prueba es la regla que motivó la migración 077: cuando ninguna
// palabra clave calza con la glosa de los ítems, el motor devuelve su
// catch-all `servicios`, que el catálogo mapea a 'Alcance 3 · Cat. 1'. Ese
// documento NO puede salir en el export como una fila Cat. 1 con su fuente
// metodológica citada — sería indistinguible de una atribución calculada en
// un documento de cierre contable.
// ============================================================

const sufijo = crypto.randomBytes(4).toString('hex');
const RUT_MANDANTE = '91000001';
const RUT_PROVEEDOR = '91000002';
const API_KEY = `smk_test_${sufijo}`;

let server, baseUrl, mandanteId, sesionId;

const get = async (ruta) => {
  const res = await fetch(`${baseUrl}${ruta}`, { headers: { 'X-Api-Key': API_KEY } });
  return { status: res.status, texto: await res.text() };
};

before(async () => {
  if (EN_PRODUCCION && SALTO_PROD) return;
  await runMigrations();

  await query(`DELETE FROM mandantes WHERE rut = $1`, [RUT_MANDANTE]);
  const { rows: m } = await query(
    `INSERT INTO mandantes (nombre_empresa, rut, token_hash, activo)
     VALUES ($1, $2, $3, true) RETURNING id`,
    [`Mandante Alcance3 ${sufijo}`, RUT_MANDANTE, hashApiKey(API_KEY)]
  );
  mandanteId = m[0].id;

  const { rows: s } = await query(
    `INSERT INTO sesiones (rut_cliente, nombre_cliente, email_cliente) VALUES ($1,$2,$3) RETURNING id`,
    [RUT_MANDANTE, `Mandante Alcance3 ${sufijo}`, `alcance3.${sufijo}@ejemplo.invalido`]
  );
  sesionId = s[0].id;

  // Nombre y código reales del catálogo, para que el JOIN calce igual que en
  // producción. `servicios` mapea a 'Alcance 3 · Cat. 1' (migración 017).
  const { rows: cat } = await query(`SELECT codigo, nombre FROM motor_categorias WHERE codigo = 'servicios'`);
  const nombreServicios = cat[0].nombre;

  const insertar = (co2e, origen) => query(
    `INSERT INTO facturas
       (sesion_id, rut_emisor, rut_receptor, total_co2e, categoria, categoria_codigo, categoria_origen, status, motor)
     VALUES ($1,$2,$3,$4,$5,'servicios',$6,'procesada','propio')`,
    [sesionId, RUT_PROVEEDOR, RUT_MANDANTE, co2e, nombreServicios, origen]
  );
  await insertar(5, 'glosa');            // clasificado de verdad → sí va al export
  await insertar(3, 'sin_coincidencia'); // catch-all del motor    → NO va al export
  await insertar(2, null);               // anterior a la migración 077 → NO va al export

  // Catch-all del motor cuya categoría mapea FUERA de Alcance 3 (energía
  // eléctrica → Alcance 2). Con el filtro 'Alcance 3%' en el WHERE, este
  // documento desaparecía de la consulta antes de que se calculara el saldo
  // no atribuido: ni salía en el export ni se contaba como excluido.
  const { rows: cat2 } = await query(
    `SELECT codigo, nombre FROM motor_categorias WHERE alcance_ghg LIKE 'Alcance 2%' ORDER BY codigo LIMIT 1`
  );
  await query(
    `INSERT INTO facturas
       (sesion_id, rut_emisor, rut_receptor, total_co2e, categoria, categoria_codigo, categoria_origen, status, motor)
     VALUES ($1,$2,$3,7,$4,$5,'sin_coincidencia','procesada','propio')`,
    [sesionId, RUT_PROVEEDOR, RUT_MANDANTE, cat2[0].nombre, cat2[0].codigo]
  );
  // Clasificado de verdad, pero con un código que ya no existe en el catálogo
  // (categoría borrada del panel). El JOIN interno lo hacía desaparecer.
  await query(
    `INSERT INTO facturas
       (sesion_id, rut_emisor, rut_receptor, total_co2e, categoria, categoria_codigo, categoria_origen, status, motor)
     VALUES ($1,$2,$3,4,'Categoría borrada','no_existe_en_el_catalogo','glosa','procesada','propio')`,
    [sesionId, RUT_PROVEEDOR, RUT_MANDANTE]
  );

  const app = express();
  app.use(express.json());
  app.use('/api/mandante', mandanteRoutes);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (sesionId) await query(`DELETE FROM sesiones WHERE id = $1`, [sesionId]);
  if (mandanteId) await query(`DELETE FROM mandantes WHERE id = $1`, [mandanteId]);
  await pool.end();
});

test('el catch-all del motor NO se informa como Alcance 3 Cat. 1', { skip: EN_PRODUCCION && SALTO_PROD }, async () => {
  const { status, texto } = await get('/api/mandante/export/alcance3');
  assert.equal(status, 200);
  const cuerpo = JSON.parse(texto);
  assert.equal(cuerpo.filas.length, 1, 'solo la factura con categoría de verdad');
  assert.equal(cuerpo.filas[0].categoria_numero, 1);
  assert.equal(cuerpo.filas[0].n_documentos, 1);
  assert.equal(cuerpo.filas[0].total_tco2e, 5, 'los 3 tCO2e del catch-all no entran a Cat. 1');
});

test('lo excluido no se esconde: se informa aparte, con su CO2e y su motivo', { skip: EN_PRODUCCION && SALTO_PROD }, async () => {
  const { texto } = await get('/api/mandante/export/alcance3');
  const { no_atribuido: na } = JSON.parse(texto);
  assert.equal(na.n_documentos, 4, 'los dos catch-all, el de procedencia sin registrar y el de código huérfano');
  assert.equal(na.total_tco2e, 16); // 3 + 2 + 7 (Alcance 2) + 4 (código huérfano)
  assert.equal(na.sin_coincidencia, 2);
  assert.equal(na.procedencia_no_registrada, 1);
  assert.equal(na.alcance_no_legible, 1);
});

// El filtro `mc.alcance_ghg LIKE 'Alcance 3%'` estaba en el WHERE, o sea que
// se aplicaba ANTES de separar lo atribuible: un documento cuyo catch-all cae
// fuera de Alcance 3 no salía en el export NI en el saldo excluido. El pie del
// CSV prometía declarar justo eso.
test('el catch-all que cae fuera de Alcance 3 tampoco desaparece del saldo', { skip: EN_PRODUCCION && SALTO_PROD }, async () => {
  const { texto } = await get('/api/mandante/export/alcance3');
  const { no_atribuido: na } = JSON.parse(texto);
  assert.equal(na.sin_coincidencia, 2, 'el catch-all de Alcance 2 se cuenta igual que el de Alcance 3');
  assert.equal(na.total_tco2e >= 7, true, 'sus tCO2e están en el saldo, no perdidos');
});

// El JOIN interno descartaba en silencio un documento cuyo `categoria_codigo`
// ya no está en el catálogo (categoría borrada del panel del motor).
test('un código de categoría huérfano se informa, no se descarta', { skip: EN_PRODUCCION && SALTO_PROD }, async () => {
  const { texto } = await get('/api/mandante/export/alcance3');
  const { no_atribuido: na } = JSON.parse(texto);
  assert.equal(na.alcance_no_legible, 1);
});

// Alcance 1 y 2 quedan fuera del informe por definición, no por falta de dato:
// contarlos como "sin clasificar" le diría al mandante que le falta trabajo
// donde no le falta.
test('lo atribuido a Alcance 1 o 2 se informa aparte, no como saldo sin clasificar', { skip: EN_PRODUCCION && SALTO_PROD }, async () => {
  const { rows } = await query(
    `SELECT codigo, nombre FROM motor_categorias WHERE alcance_ghg LIKE 'Alcance 2%' ORDER BY codigo LIMIT 1`
  );
  const { rows: f } = await query(
    `INSERT INTO facturas
       (sesion_id, rut_emisor, rut_receptor, total_co2e, categoria, categoria_codigo, categoria_origen, status, motor)
     VALUES ($1,$2,$3,9,$4,$5,'glosa','procesada','propio') RETURNING id`,
    [sesionId, RUT_PROVEEDOR, RUT_MANDANTE, rows[0].nombre, rows[0].codigo]
  );
  try {
    const { texto } = await get('/api/mandante/export/alcance3');
    const cuerpo = JSON.parse(texto);
    assert.equal(cuerpo.otros_alcances.n_documentos, 1);
    assert.equal(cuerpo.otros_alcances.total_tco2e, 9);
    assert.equal(cuerpo.no_atribuido.n_documentos, 4, 'no engorda el saldo sin clasificar');
    assert.equal(cuerpo.filas.length, 1, 'ni entra al export de Alcance 3');
  } finally {
    await query(`DELETE FROM facturas WHERE id = $1`, [f[0].id]);
  }
});

// `motor_categorias.nombre` no es único y se edita libre desde el panel del
// motor. El respaldo por nombre —el camino de TODO el histórico anterior a la
// migración 077, que no tiene `categoria_codigo`— calzaba entonces con dos
// filas del catálogo y duplicaba el documento en el export: Alcance 3
// sobredeclarado en una memoria anual.
test('dos categorías con el mismo nombre no duplican el documento', { skip: EN_PRODUCCION && SALTO_PROD }, async () => {
  const { rows: orig } = await query(`SELECT codigo, nombre FROM motor_categorias WHERE codigo = 'servicios'`);
  const gemela = `zz_gemela_${sufijo}`;
  const { rows: base } = await query(
    `SELECT alcance_ghg, factor_gasto_kgco2e_clp1000 AS factor FROM motor_categorias WHERE codigo = 'servicios'`
  );
  await query(
    `INSERT INTO motor_categorias (codigo, nombre, alcance_ghg, factor_gasto_kgco2e_clp1000, activo)
     VALUES ($1, $2, $3, $4, true)`,
    [gemela, orig[0].nombre, base[0].alcance_ghg, base[0].factor]
  );
  // El documento tiene que resolverse POR NOMBRE (categoria_codigo NULL) —
  // es el caso del histórico anterior a la migración 077, y el único donde
  // la rama ambigua del JOIN se activa.
  const { rows: f } = await query(
    `INSERT INTO facturas
       (sesion_id, rut_emisor, rut_receptor, total_co2e, categoria, categoria_codigo, categoria_origen, status, motor)
     VALUES ($1,$2,$3,6,$4,NULL,'glosa','procesada','propio') RETURNING id`,
    [sesionId, RUT_PROVEEDOR, RUT_MANDANTE, orig[0].nombre]
  );
  try {
    const { texto } = await get('/api/mandante/export/alcance3');
    const cuerpo = JSON.parse(texto);
    assert.equal(cuerpo.filas.length, 1);
    assert.equal(cuerpo.filas[0].n_documentos, 2, 'el histórico entra una sola vez, no una por categoría homónima');
    assert.equal(cuerpo.filas[0].total_tco2e, 11, '5 + 6: ningún CO2e se cuenta dos veces');
  } finally {
    await query(`DELETE FROM facturas WHERE id = $1`, [f[0].id]);
    await query(`DELETE FROM motor_categorias WHERE codigo = $1`, [gemela]);
  }
});

// El invariante que sostiene todo lo anterior: nada del gasto del proveedor
// se pierde entre los tres montones. Es lo que hace que el mandante pueda
// cuadrar este export contra lo que ve en la pantalla de proveedores.
test('el export cuadra: filas + otros alcances + no atribuido = todo el proveedor', { skip: EN_PRODUCCION && SALTO_PROD }, async () => {
  const { texto } = await get('/api/mandante/export/alcance3');
  const cuerpo = JSON.parse(texto);
  const totalInformado = cuerpo.filas.reduce((a, f) => a + f.total_tco2e, 0)
    + cuerpo.no_atribuido.total_tco2e + cuerpo.otros_alcances.total_tco2e;
  assert.equal(totalInformado, 21, '5 + 3 + 2 + 7 + 4');
});

test('el CSV declara al pie el saldo sin categoría atribuible', { skip: EN_PRODUCCION && SALTO_PROD }, async () => {
  const { texto } = await get('/api/mandante/export/alcance3?formato=csv');
  assert.match(texto, /sin categoría GHG atribuible/);
  assert.match(texto, /no incluidos arriba/);
  assert.match(texto, /con categoría sin alcance legible/);
  // La fila que sí corresponde sigue estando, con su cifra.
  assert.match(texto, /5\.0000/);
});

// La categoría se identifica por su CÓDIGO estable, no por el nombre editable
// desde el panel del motor: antes el JOIN era por nombre, así que renombrar una
// categoría sacaba del export —sin aviso— todo el histórico de esa categoría,
// bajando el Alcance 3 que el mandante informa.
test('renombrar la categoría en el panel del motor no saca documentos del export', { skip: EN_PRODUCCION && SALTO_PROD }, async () => {
  const { rows } = await query(`SELECT nombre FROM motor_categorias WHERE codigo = 'servicios'`);
  const original = rows[0].nombre;
  try {
    await query(`UPDATE motor_categorias SET nombre = $1 WHERE codigo = 'servicios'`, [`${original} (renombrada)`]);
    const { texto } = await get('/api/mandante/export/alcance3');
    const cuerpo = JSON.parse(texto);
    assert.equal(cuerpo.filas.length, 1, 'el documento sigue en el export tras el renombre');
    assert.equal(cuerpo.filas[0].total_tco2e, 5);
  } finally {
    await query(`UPDATE motor_categorias SET nombre = $1 WHERE codigo = 'servicios'`, [original]);
  }
});
