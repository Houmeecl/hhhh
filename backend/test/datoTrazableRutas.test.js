import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import crypto from 'crypto';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { signAccess } from '../src/middleware/auth.js';
import expedientesRouter from '../src/routes/expedientes.js';
import { EN_PRODUCCION, SALTO_PROD } from './util/soloDev.js';

// ============================================================
// El dato trazable por HTTP (migración 106 + routes/expedientes.js).
//
// Lo que estos casos cuidan, en orden de importancia:
//
//  1. QUE EL NIVEL DE CONFIANZA NO SE PUEDA AUTO-OTORGAR. La columna es
//     una caché de lo que calcula resumenDato(); si el body pudiera
//     fijarla, cualquiera se pondría en 5 —el nivel que el código NO
//     emite por diseño, porque exige un auditor que no existe— con un
//     curl, y la escalera entera dejaría de significar algo.
//  2. QUE EL HISTORIAL NO SE PIERDA. Corregir «50» por «48» sin dejar
//     constancia borra que alguna vez dijo 50, y el desacuerdo registrado
//     es el producto.
//  3. QUE NADA SALGA DEL PROVEEDOR. El scoping es por proveedor_id del
//     JWT: un expediente ajeno no aparece en el WHERE, así que «no
//     existe» también cubre «no es tuyo».
//  4. QUE UN PUT PARCIAL NO ROMPA EL ESQUEMA. Cambiar la dirección a
//     'arriba' dejando una etapa vieja pasa la validación de los campos
//     enviados y choca contra el CHECK de la migración.
// ============================================================

let server; let baseUrl; let provA; let provB; let expA;
let usuarioA; let usuarioB;
const sufijo = crypto.randomBytes(4).toString('hex');

// El usuario del token tiene que EXISTIR en `usuarios`: el historial lo
// referencia con una FK, y esa FK es correcta — si el cambio no se puede
// registrar, el cambio no debe ocurrir. Un token con un UUID inventado
// pasaba la autenticación y reventaba recién al escribir el historial,
// que es justo lo que en producción no pasa nunca (el `sub` del JWT sale
// de una fila real al hacer login).
const token = (proveedorId) => signAccess({
  id: proveedorId === provA ? usuarioA : usuarioB,
  rol: 'operador', email: `dato-${proveedorId}@ejemplo.cl`,
  panel: 'proveedor', nivel_acceso: 'operador', proveedor_id: proveedorId,
});

const pedir = (metodo, path, tk, body) => fetch(`${baseUrl}${path}`, {
  method: metodo,
  headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const json = async (r) => ({ status: r.status, d: await r.json().catch(() => null) });

const DATO = { producto: 'Filtros industriales', cantidad: 50, unidad: 'unidades' };

before(async () => {
  if (EN_PRODUCCION) return;
  await runMigrations();
  const { rows: a } = await query(
    `INSERT INTO proveedores (nombre_empresa, rut) VALUES ('Datos A SpA', $1) RETURNING id`, [`84${sufijo}K`.slice(0, 12)]);
  const { rows: b } = await query(
    `INSERT INTO proveedores (nombre_empresa, rut) VALUES ('Datos B SpA', $1) RETURNING id`, [`85${sufijo}K`.slice(0, 12)]);
  provA = a[0].id; provB = b[0].id;

  const cuenta = async (proveedorId, marca) => (await query(
    `INSERT INTO usuarios (email, nombre, rol, panel, proveedor_id, nivel_acceso, estado, password_hash, must_reset_password)
     VALUES ($1,'Operador de Prueba','operador','proveedor',$2,'operador','activo','x',false) RETURNING id`,
    [`dato-${marca}-${sufijo}@ejemplo.cl`, proveedorId]
  )).rows[0].id;
  usuarioA = await cuenta(provA, 'a');
  usuarioB = await cuenta(provB, 'b');

  const app = express();
  app.use(express.json());
  app.use('/api/panel-proveedor/expedientes', expedientesRouter);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const { d } = await json(await pedir('POST', '/api/panel-proveedor/expedientes', token(provA), {
    cliente_nombre: 'Minera de Ejemplo', cliente_rut: '77.777.777-7',
    orden_compra: 'OC 12345', periodo: '2026-07', tipo: 'suministro',
  }));
  expA = d.expediente.id;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (usuarioA) await query('DELETE FROM usuarios WHERE id = ANY($1::uuid[])', [[usuarioA, usuarioB]]);
  if (provA) await query('DELETE FROM proveedores WHERE id = ANY($1::uuid[])', [[provA, provB]]);
  await pool.end();
});

const crear = async (cuerpo = DATO, tk = token(provA), exp = expA) =>
  json(await pedir('POST', `/api/panel-proveedor/expedientes/${exp}/datos`, tk, cuerpo));

// ---------- 1. El nivel se calcula, no se recibe ----------

test('un dato nace en nivel 1: lo declaró el proveedor y nada lo respalda',
  { skip: SALTO_PROD }, async () => {
    const { status, d } = await crear();
    assert.equal(status, 201);
    assert.equal(d.dato.nivel_confianza, 1);
    assert.equal(d.dato.nombre_nivel, 'Declarado');
    assert.equal(d.dato.procedencia, 'declarada_por_el_proveedor');
  });

test('mandar nivel_confianza:5 en el body no sirve de nada',
  { skip: SALTO_PROD }, async () => {
    // El 5 es "revisado externamente" y el código NO lo emite: exige un rol
    // de auditor que no existe. Poder fijarlo por HTTP sería declarar una
    // revisión que nadie hizo.
    const { d } = await crear({ ...DATO, nivel_confianza: 5 });
    assert.equal(d.dato.nivel_confianza, 1);
  });

test('un proveedor no puede certificarse a sí mismo "validado en fuente"',
  { skip: SALTO_PROD }, async () => {
    const { d } = await crear({
      ...DATO, validado_por: 'yo mismo', validado_fuente: 'sii', validado_at: '2026-01-01',
    });
    assert.equal(d.dato.validado_por, null);
    assert.equal(d.dato.validado_fuente, null);
    assert.notEqual(d.dato.nivel_confianza, 4);
  });

// ---------- 2. El historial ----------

test('corregir la cantidad deja constancia de la anterior',
  { skip: SALTO_PROD }, async () => {
    const { d } = await crear({ ...DATO, cantidad: 50 });
    const editado = await json(await pedir('PUT',
      `/api/panel-proveedor/expedientes/${expA}/datos/${d.dato.id}`, token(provA), { cantidad: 48 }));
    assert.equal(editado.status, 200);

    const h = await json(await pedir('GET',
      `/api/panel-proveedor/expedientes/${expA}/datos/${d.dato.id}/historial`, token(provA)));
    const cambio = h.d.historial.find((x) => x.campo === 'cantidad');
    assert.ok(cambio, 'el cambio de cantidad tiene que constar');
    assert.match(String(cambio.valor_anterior), /^50/);
    assert.match(String(cambio.valor_nuevo), /^48/);
  });

test('un PUT que no cambia nada no ensucia el historial',
  { skip: SALTO_PROD }, async () => {
    // NUMERIC vuelve de pg como string: comparar 50 contra '50.0000'
    // marcaría un cambio que no ocurrió y llenaría el historial de ruido.
    const { d } = await crear({ ...DATO, cantidad: 50 });
    await pedir('PUT', `/api/panel-proveedor/expedientes/${expA}/datos/${d.dato.id}`, token(provA), { cantidad: 50 });
    const h = await json(await pedir('GET',
      `/api/panel-proveedor/expedientes/${expA}/datos/${d.dato.id}/historial`, token(provA)));
    assert.equal(h.d.historial.length, 0);
  });

// ---------- 3. Nada sale del proveedor ----------

test('el expediente de otra empresa responde 404, no 403',
  { skip: SALTO_PROD }, async () => {
    const r = await json(await pedir('GET', `/api/panel-proveedor/expedientes/${expA}/datos`, token(provB)));
    assert.equal(r.status, 404);
  });

test('no se puede crear un dato en el expediente de otra empresa',
  { skip: SALTO_PROD }, async () => {
    const r = await crear(DATO, token(provB));
    assert.equal(r.status, 404);
  });

test('el historial de un dato ajeno tampoco se alcanza acertando el UUID',
  { skip: SALTO_PROD }, async () => {
    const { d } = await crear();
    const r = await json(await pedir('GET',
      `/api/panel-proveedor/expedientes/${expA}/datos/${d.dato.id}/historial`, token(provB)));
    assert.equal(r.status, 404);
  });

// ---------- 4. Validación ----------

test('una etapa aguas ARRIBA se rechaza con un mensaje legible, no con un CHECK crudo',
  { skip: SALTO_PROD }, async () => {
    const r = await crear({ ...DATO, direccion: 'arriba', etapa: 'procesamiento' });
    assert.equal(r.status, 400);
    assert.match(r.d.error, /aguas abajo/);
  });

test('un PUT parcial que dejaría el dato inválido se rechaza',
  { skip: SALTO_PROD }, async () => {
    // Se valida el dato COMPLETO, no solo lo enviado: cambiar la dirección
    // a 'arriba' dejando la etapa vieja pasaría una validación por campos.
    const { d } = await crear({ ...DATO, direccion: 'abajo', etapa: 'procesamiento' });
    const r = await json(await pedir('PUT',
      `/api/panel-proveedor/expedientes/${expA}/datos/${d.dato.id}`, token(provA), { direccion: 'arriba' }));
    assert.equal(r.status, 400);
    assert.match(r.d.error, /aguas abajo/);
  });

test('sin unidad no entra: "50" solo no se puede comparar con nada',
  { skip: SALTO_PROD }, async () => {
    const r = await crear({ producto: 'Filtros', cantidad: 50 });
    assert.equal(r.status, 400);
    assert.match(r.d.error, /unidad/i);
  });

test('una cantidad de 0 no es un dato',
  { skip: SALTO_PROD }, async () => {
    const r = await crear({ ...DATO, cantidad: 0 });
    assert.equal(r.status, 400);
  });

// ---------- Borrado ----------

test('borrar un dato NO borra los documentos que lo respaldaban',
  { skip: SALTO_PROD }, async () => {
    // Un documento no deja de existir porque se corrija el dato que
    // respaldaba: queda en el expediente con dato_id en NULL.
    const { d } = await crear();
    const doc = await json(await pedir('POST', `/api/panel-proveedor/expedientes/${expA}/documentos`, token(provA), {
      rol: 'venta_principal', descripcion: 'Factura de la venta', emisor_rut: '77.777.777-7',
      dato_id: d.dato.id, cantidad: 50, unidad: 'unidades',
    }));
    assert.equal(doc.status, 201);

    const del = await json(await pedir('DELETE',
      `/api/panel-proveedor/expedientes/${expA}/datos/${d.dato.id}`, token(provA)));
    assert.equal(del.status, 200);

    const { rows } = await query(
      'SELECT dato_id FROM expediente_documentos WHERE expediente_id = $1 AND descripcion = $2',
      [expA, 'Factura de la venta']);
    assert.equal(rows.length, 1, 'el documento sigue en el expediente');
    assert.equal(rows[0].dato_id, null, 'y su dato_id quedó en NULL');
  });

test('el vocabulario del formulario sale del servidor, no del JSX',
  { skip: SALTO_PROD }, async () => {
    const r = await json(await pedir('GET', '/api/panel-proveedor/expedientes/vocabulario/datos', token(provA)));
    assert.equal(r.status, 200);
    assert.deepEqual(r.d.direcciones, ['arriba', 'abajo']);
    assert.ok(r.d.etapas_aguas_abajo.length > 0);
    // El 5 existe en el vocabulario porque el CHECK lo permite, pero
    // ningún camino lo emite — eso lo cubre el test de arriba.
    assert.equal(r.d.niveles['1'], 'Declarado');
  });
