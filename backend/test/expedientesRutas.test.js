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
// Los expedientes por HTTP (migración 105 + routes/expedientes.js).
//
// Lo que estos casos cuidan:
//
//  · QUE NADA SALGA DEL PROVEEDOR. Un expediente es de una empresa y de
//    nadie más. El scoping es por proveedor_id del JWT: un id ajeno no
//    aparece en el WHERE, así que "no existe" también cubre "no es tuyo".
//    Esta es la garantía que sostiene todo lo demás — sin ella, la
//    divulgación selectiva no tendría dónde apoyarse.
//  · QUE UN VÍNCULO AJENO NO SE PUEDA ENGANCHAR. Sin el chequeo, un id de
//    dte_proveedor de otra empresa entraría al expediente y el resumen
//    diría "respaldado" apoyándose en el RCV de un tercero.
//  · QUE EL RECUENTO DE UNA VENTA POR EXPEDIENTE SE DEFIENDA con un 409
//    legible, no con un 23505 crudo de Postgres.
// ============================================================

let server;
let baseUrl;
let provA;
let provB;

const sufijo = Date.now().toString().slice(-7);

function token(proveedorId) {
  return signAccess({
    id: crypto.randomUUID(), rol: 'operador', email: `exp-${proveedorId}@ejemplo.cl`,
    panel: 'proveedor', nivel_acceso: 'operador', proveedor_id: proveedorId,
  });
}

before(async () => {
  if (EN_PRODUCCION) return;
  await runMigrations();
  const { rows: a } = await query(
    `INSERT INTO proveedores (nombre_empresa, rut) VALUES ('Rutas A SpA', $1) RETURNING id, rut`,
    [`80${sufijo}K`]
  );
  const { rows: b } = await query(
    `INSERT INTO proveedores (nombre_empresa, rut) VALUES ('Rutas B SpA', $1) RETURNING id, rut`,
    [`81${sufijo}K`]
  );
  provA = a[0];
  provB = b[0];

  const app = express();
  app.use(express.json());
  app.use('/api/panel-proveedor/expedientes', expedientesRouter);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (provA) await query(`DELETE FROM proveedores WHERE id = ANY($1::uuid[])`, [[provA.id, provB.id]]);
  await pool.end();
});

const pedir = (metodo, path, tk, body) => fetch(`${baseUrl}${path}`, {
  method: metodo,
  headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

test('abrir un expediente devuelve su resumen con las brechas ya calculadas',
  { skip: SALTO_PROD }, async () => {
    const res = await pedir('POST', '/api/panel-proveedor/expedientes', token(provA.id), {
      // RUT de ejemplo (77.777.777-7), NO el de una empresa real: el
      // dígito verificador es válido para que pase la validación, y el
      // número es obviamente ficticio para que nadie lo confunda con el
      // identificador de un tercero.
      cliente_nombre: 'Minera de Ejemplo', cliente_rut: '77.777.777-7',
      orden_compra: 'OC 12345', faena: 'Escondida', periodo: '2026-07', tipo: 'suministro',
    });
    assert.equal(res.status, 201);
    const d = await res.json();
    // El RUT se guarda normalizado, para que el cruce sea por igualdad.
    assert.equal(d.expediente.cliente_rut, '777777777');
    assert.equal(d.resumen.cobertura_documental, 0);
    assert.equal(d.resumen.semaforo, 'rojo');
    // Sin ningún documento, los 5 roles esperados de 'suministro' son brechas.
    assert.equal(d.resumen.pendientes.filter((p) => p.codigo.startsWith('falta_')).length, 5);
    assert.ok(d.resumen.no_acredita.length >= 6);
  });

test('un expediente de otra empresa no existe para mí', { skip: SALTO_PROD }, async () => {
  const crear = await pedir('POST', '/api/panel-proveedor/expedientes', token(provA.id),
    { cliente_nombre: 'Cliente de A' });
  const { expediente } = await crear.json();

  assert.equal((await pedir('GET', `/api/panel-proveedor/expedientes/${expediente.id}`, token(provB.id))).status, 404);
  assert.equal((await pedir('PUT', `/api/panel-proveedor/expedientes/${expediente.id}`, token(provB.id),
    { cliente_nombre: 'Secuestrado' })).status, 404);
  assert.equal((await pedir('DELETE', `/api/panel-proveedor/expedientes/${expediente.id}`, token(provB.id))).status, 404);

  // Y no aparece en la lista de B.
  const lista = await (await pedir('GET', '/api/panel-proveedor/expedientes', token(provB.id))).json();
  assert.equal(lista.expedientes.filter((e) => e.id === expediente.id).length, 0);
});

test('un documento del RCV ajeno no se puede enganchar', { skip: SALTO_PROD }, async () => {
  const crear = await pedir('POST', '/api/panel-proveedor/expedientes', token(provA.id),
    { cliente_nombre: 'Cliente', tipo: 'suministro' });
  const { expediente } = await crear.json();

  // Una compra que pertenece a la OTRA empresa.
  const { rows: dteB } = await query(
    `INSERT INTO dte_proveedor (proveedor_id, periodo, tipo, tipo_dte, folio, total)
     VALUES ($1, '2026-07', 'compra', '33', $2, 100000) RETURNING id`,
    [provB.id, `f${sufijo}`]
  );

  const res = await pedir('POST', `/api/panel-proveedor/expedientes/${expediente.id}/documentos`,
    token(provA.id),
    { rol: 'compra_relacionada', descripcion: 'Diésel ajeno', dte_proveedor_id: dteB[0].id });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /no es tuyo/i);
});

test('una compra del RCV propio sí se engancha y sube la cobertura',
  { skip: SALTO_PROD }, async () => {
    const crear = await pedir('POST', '/api/panel-proveedor/expedientes', token(provA.id),
      { cliente_nombre: 'Cliente', tipo: 'suministro', periodo: '2026-08' });
    const { expediente } = await crear.json();

    const { rows: dteA } = await query(
      `INSERT INTO dte_proveedor (proveedor_id, periodo, tipo, tipo_dte, folio, total, fecha)
       VALUES ($1, '2026-08', 'compra', '33', $2, 250000, '2026-08-04') RETURNING id`,
      [provA.id, `g${sufijo}`]
    );

    // Aparece entre los candidatos del período.
    const cand = await (await pedir('GET',
      `/api/panel-proveedor/expedientes/${expediente.id}/candidatos`, token(provA.id))).json();
    assert.ok(cand.candidatos.find((c) => c.id === dteA[0].id));

    const res = await pedir('POST', `/api/panel-proveedor/expedientes/${expediente.id}/documentos`,
      token(provA.id), {
        rol: 'compra_relacionada', descripcion: 'Diésel de la faena',
        dte_proveedor_id: dteA[0].id, asociacion: 'confirmada', porcentaje: 70,
        base_prorrateo: 'por consumo de la faena',
      });
    assert.equal(res.status, 201);
    const d = await res.json();
    assert.equal(Number(d.documento.porcentaje), 70);
    // 0,70 sobre 5 roles esperados = 14%. NO 20%: el prorrateo no cuenta entero.
    assert.equal(d.resumen.cobertura_documental, 14);
    assert.equal(d.resumen.documentos_respaldados, 1);

    // Y ya no vuelve a ofrecerse como candidato.
    const cand2 = await (await pedir('GET',
      `/api/panel-proveedor/expedientes/${expediente.id}/candidatos`, token(provA.id))).json();
    assert.equal(cand2.candidatos.filter((c) => c.id === dteA[0].id).length, 0);
  });

test('un expediente no admite dos facturas de venta, y lo dice en español',
  { skip: SALTO_PROD }, async () => {
    const crear = await pedir('POST', '/api/panel-proveedor/expedientes', token(provA.id),
      { cliente_nombre: 'Cliente', tipo: 'servicio' });
    const { expediente } = await crear.json();
    const doc = { rol: 'venta_principal', descripcion: 'Factura 1234' };

    assert.equal((await pedir('POST', `/api/panel-proveedor/expedientes/${expediente.id}/documentos`,
      token(provA.id), doc)).status, 201);

    const res = await pedir('POST', `/api/panel-proveedor/expedientes/${expediente.id}/documentos`,
      token(provA.id), { rol: 'venta_principal', descripcion: 'Factura 5678' });
    assert.equal(res.status, 409);
    const err = (await res.json()).error;
    assert.match(err, /abre otro expediente/i);
    assert.doesNotMatch(err, /duplicate key|constraint/i);
  });

test('soltar un documento recalcula el resumen', { skip: SALTO_PROD }, async () => {
  const crear = await pedir('POST', '/api/panel-proveedor/expedientes', token(provA.id),
    { cliente_nombre: 'Cliente', tipo: 'transporte' });
  const { expediente } = await crear.json();
  const alta = await pedir('POST', `/api/panel-proveedor/expedientes/${expediente.id}/documentos`,
    token(provA.id), { rol: 'guia', descripcion: 'Guía 88' });
  const { documento, resumen } = await alta.json();
  assert.equal(resumen.cobertura_documental, 25);   // 1 de 4 esperados

  const baja = await pedir('DELETE',
    `/api/panel-proveedor/expedientes/${expediente.id}/documentos/${documento.id}`, token(provA.id));
  assert.equal(baja.status, 200);
  assert.equal((await baja.json()).resumen.cobertura_documental, 0);
});

test('un expediente con documentos se cierra, no se borra', { skip: SALTO_PROD }, async () => {
  const crear = await pedir('POST', '/api/panel-proveedor/expedientes', token(provA.id),
    { cliente_nombre: 'Cliente' });
  const { expediente } = await crear.json();
  await pedir('POST', `/api/panel-proveedor/expedientes/${expediente.id}/documentos`,
    token(provA.id), { rol: 'guia', descripcion: 'Guía' });

  const res = await pedir('DELETE', `/api/panel-proveedor/expedientes/${expediente.id}`, token(provA.id));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /Ciérralo/i);
});

test('el listado nunca opina sobre un expediente tipo "otro"', { skip: SALTO_PROD }, async () => {
  const crear = await pedir('POST', '/api/panel-proveedor/expedientes', token(provB.id),
    { cliente_nombre: 'Cliente de B', tipo: 'otro' });
  const { expediente } = await crear.json();
  await pedir('POST', `/api/panel-proveedor/expedientes/${expediente.id}/documentos`,
    token(provB.id), { rol: 'venta_principal', descripcion: 'Factura' });

  const lista = await (await pedir('GET', '/api/panel-proveedor/expedientes', token(provB.id))).json();
  const e = lista.expedientes.find((x) => x.id === expediente.id);
  assert.equal(e.cobertura_documental, null);
  assert.equal(e.semaforo, 'gris');
  assert.equal(e.documentos_total, 1);
});

test('un tipo o un período inventados se rechazan con mensaje, no con un 500',
  { skip: SALTO_PROD }, async () => {
    const malTipo = await pedir('POST', '/api/panel-proveedor/expedientes', token(provA.id),
      { cliente_nombre: 'X', tipo: 'inventado' });
    assert.equal(malTipo.status, 400);
    const malPeriodo = await pedir('POST', '/api/panel-proveedor/expedientes', token(provA.id),
      { cliente_nombre: 'X', periodo: 'julio 2026' });
    assert.equal(malPeriodo.status, 400);
    const sinCliente = await pedir('POST', '/api/panel-proveedor/expedientes', token(provA.id), {});
    assert.equal(sinCliente.status, 400);
  });

test('el listado trae el vocabulario y el bloque de no-afirmaciones',
  { skip: SALTO_PROD }, async () => {
    const d = await (await pedir('GET', '/api/panel-proveedor/expedientes', token(provA.id))).json();
    assert.ok(d.vocabulario.tipos.includes('suministro'));
    assert.ok(d.vocabulario.roles.find((r) => r.codigo === 'venta_principal'));
    assert.deepEqual(d.vocabulario.roles_esperados_por_tipo.otro, []);
    assert.match(d.no_acredita.join(' '), /No es una certificación/);
    assert.match(d.nota_scope, /no calcula las tCO₂e del cliente/);
  });

test('una cuenta que NO es del panel proveedor no entra', { skip: SALTO_PROD }, async () => {
  const ajeno = signAccess({
    id: crypto.randomUUID(), rol: 'admin', email: 'admin@ejemplo.cl', panel: 'sicrep',
  });
  assert.equal((await pedir('GET', '/api/panel-proveedor/expedientes', ajeno)).status, 403);
});

test('una cuenta de solo lectura mira pero no muta', { skip: SALTO_PROD }, async () => {
  const lectura = signAccess({
    id: crypto.randomUUID(), rol: 'operador', email: 'lectura@ejemplo.cl',
    panel: 'proveedor', nivel_acceso: 'lectura', proveedor_id: provA.id,
  });
  assert.equal((await pedir('GET', '/api/panel-proveedor/expedientes', lectura)).status, 200);
  assert.equal((await pedir('POST', '/api/panel-proveedor/expedientes', lectura,
    { cliente_nombre: 'X' })).status, 403);
});
