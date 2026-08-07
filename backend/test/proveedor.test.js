import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../src/config.js';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { signAccess } from '../src/middleware/auth.js';
import { verificarCadenaCompleta } from '../src/services/cadenaHash.js';
import origenRoutes, { proveedorPanelRouter, firmaProveedorRouter } from '../src/routes/origen.js';
import accesosRoutes from '../src/routes/accesos.js';
import adminRoutes from '../src/routes/admin.js';
import { EN_PRODUCCION, SALTO_PROD } from './util/soloDev.js';

// ============================================================
// Test de integración contra una base real (mismo patrón que
// trazador.test.js): runMigrations() en `before`, servidor express con
// los routers reales — origenRoutes (admin, requireHomePanel('sicrep')),
// proveedorPanelRouter (el camino NUEVO, login FIDO2 sobre una entidad
// persistente) y firmaProveedorRouter (el camino VIEJO, serial+clave de
// un solo uso, migración 038) para probar explícitamente que esta ronda
// no lo rompió. Todas las filas son fixtures propias con sufijo
// aleatorio, creadas y eliminadas aquí mismo.
// ============================================================

const sufijo = crypto.randomBytes(4).toString('hex');

// ---------- RUT chileno válido (módulo 11), aleatorio por fixture ----------
function dv(cuerpo) {
  let suma = 0, mult = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * mult;
    mult = mult === 7 ? 2 : mult + 1;
  }
  const resto = 11 - (suma % 11);
  return resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
}
function rutAleatorio() {
  const cuerpo = String(crypto.randomInt(10000000, 24999999));
  return `${cuerpo}${dv(cuerpo)}`; // normalizado: sin puntos ni guión
}

let server;
let baseUrl;

let adminToken;
let proveedorATokenPayload;
let proveedorBTokenPayload;
let proveedorA;
let proveedorB;
let loteProducto;
let loteProducto2;
let loteDocumental;
let loteParaCerrar;
let loteCompat;
let asignacionId;
let asignacionBId;
let proveedorCreadoPorAdminId;

before(async () => {
  if (EN_PRODUCCION) return; // los tests de BD quedan skipped: no montar nada

  await runMigrations(); // idempotente: valida además el punto de la migración 062

  adminToken = signAccess({ id: crypto.randomUUID(), rol: 'admin', email: `admin-${sufijo}@ejemplo.cl`, panel: 'sicrep' });

  const { rows: provRows } = await query(
    `INSERT INTO proveedores (nombre_empresa, rut) VALUES ($1,$2),($3,$4) RETURNING id, nombre_empresa, rut`,
    [`Proveedor Test A ${sufijo}`, rutAleatorio(), `Proveedor Test B ${sufijo}`, rutAleatorio()]
  );
  proveedorA = provRows[0];
  proveedorB = provRows[1];

  proveedorATokenPayload = signAccess({
    id: crypto.randomUUID(), rol: 'operador', email: `prov-a-${sufijo}@ejemplo.cl`,
    panel: 'proveedor', proveedor_id: proveedorA.id,
  });
  proveedorBTokenPayload = signAccess({
    id: crypto.randomUUID(), rol: 'operador', email: `prov-b-${sufijo}@ejemplo.cl`,
    panel: 'proveedor', proveedor_id: proveedorB.id,
  });

  const nuevoLote = async (tipo, material) => {
    const codigo = `LM-TEST-${sufijo}-${crypto.randomBytes(3).toString('hex')}`;
    const { rows } = await query(
      `INSERT INTO lotes_minerales (codigo, tipo, material, cantidad, unidad, pais_origen, estado)
       VALUES ($1,$2,$3,10,'t','CL','abierto') RETURNING *`,
      [codigo, tipo, material]
    );
    return rows[0];
  };
  loteProducto = await nuevoLote('producto', 'alimentos');
  loteProducto2 = await nuevoLote('producto', 'alimentos');
  loteDocumental = await nuevoLote('documental', 'carga_general');
  loteParaCerrar = await nuevoLote('producto', 'alimentos');
  loteCompat = await nuevoLote('producto', 'alimentos');

  const app = express();
  app.use(express.json());
  app.use('/api/admin/origen', origenRoutes);
  app.use('/api/admin/accesos', accesosRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/panel-proveedor', proveedorPanelRouter);
  app.use('/api/firma-proveedor', firmaProveedorRouter);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!EN_PRODUCCION) {
    const loteIds = [loteProducto, loteProducto2, loteDocumental, loteParaCerrar, loteCompat]
      .filter(Boolean).map((l) => l.id);
    // Cascada: borrar los lotes se lleva lote_eslabones, proveedor_lotes y
    // credenciales_proveedor de esos lotes (todas ON DELETE CASCADE).
    if (loteIds.length) await query(`DELETE FROM lotes_minerales WHERE id = ANY($1::uuid[])`, [loteIds]);
    if (proveedorCreadoPorAdminId) await query(`DELETE FROM proveedores WHERE id = $1`, [proveedorCreadoPorAdminId]);
    const provIds = [proveedorA, proveedorB].filter(Boolean).map((p) => p.id);
    // Cascada: borrar los proveedores se lleva sus usuarios (si quedara alguno).
    if (provIds.length) await query(`DELETE FROM proveedores WHERE id = ANY($1::uuid[])`, [provIds]);
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.end(); // SIEMPRE: sin esto node:test se cuelga con el pool abierto
});

test('runMigrations es idempotente: correr dos veces seguidas no falla', { skip: SALTO_PROD }, async () => {
  await assert.doesNotReject(runMigrations());
});

test('POST /api/admin/accesos/proveedores con el body real del formulario ({nombre_empresa, rut}) crea el proveedor', { skip: SALTO_PROD }, async () => {
  // Regresión: el formulario de Accesos.jsx manda `rut` (mismo campo que
  // usan Mandantes/Agencias/Trazadores en ese archivo), no `rut_empresa`
  // — validarIdentidadProveedor espera `rut_empresa` porque se escribió
  // para credenciales_proveedor. Sin este test, un desalineamiento entre
  // el nombre de campo del form y el que lee el endpoint pasa 100% en
  // verde (los demás tests insertan proveedores directo por SQL) pero
  // rompe el botón "Crear proveedor" del admin en producción.
  const res = await fetch(`${baseUrl}/api/admin/accesos/proveedores`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre_empresa: `Proveedor Form ${sufijo}`, rut: rutAleatorio() }),
  });
  const body = await res.json();
  assert.equal(res.status, 201, JSON.stringify(body));
  assert.equal(body.proveedor.nombre_empresa, `Proveedor Form ${sufijo}`);
  proveedorCreadoPorAdminId = body.proveedor.id;
});

test('GET /api/panel-proveedor/lotes sin sesión responde 401', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/panel-proveedor/lotes`);
  assert.equal(res.status, 401);
});

test('GET /api/panel-proveedor/lotes con sesión de otro panel (sicrep) responde 403', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/panel-proveedor/lotes`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(res.status, 403);
});

test('POST /api/admin/origen/lotes/:id/proveedores-asignados asigna un proveedor a un lote producto abierto', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/origen/lotes/${loteProducto.id}/proveedores-asignados`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ proveedor_id: proveedorA.id }),
  });
  const body = await res.json();
  assert.equal(res.status, 201);
  assert.equal(body.asignacion.proveedor_id, proveedorA.id);
  assert.equal(body.asignacion.lote_id, loteProducto.id);
  assert.equal(body.asignacion.firmado_at, null);
  asignacionId = body.asignacion.id;
});

test('reintentar la misma asignación no la duplica (idempotente vía ON CONFLICT)', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/origen/lotes/${loteProducto.id}/proveedores-asignados`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ proveedor_id: proveedorA.id }),
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.asignacion.id, asignacionId);
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM proveedor_lotes WHERE proveedor_id = $1 AND lote_id = $2`,
    [proveedorA.id, loteProducto.id]
  );
  assert.equal(rows[0].n, 1);
});

test('asignar un proveedor a un lote documental responde 400 (rol no admitido en su cadena de custodia)', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/origen/lotes/${loteDocumental.id}/proveedores-asignados`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ proveedor_id: proveedorA.id }),
  });
  assert.equal(res.status, 400);
});

test('admin asigna un segundo proveedor a un segundo lote', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/admin/origen/lotes/${loteProducto2.id}/proveedores-asignados`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ proveedor_id: proveedorB.id }),
  });
  const body = await res.json();
  assert.equal(res.status, 201);
  asignacionBId = body.asignacion.id;
});

test('GET /api/panel-proveedor/lotes del proveedor A solo muestra SUS asignaciones (no las del proveedor B)', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/panel-proveedor/lotes`, {
    headers: { Authorization: `Bearer ${proveedorATokenPayload}` },
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  const idsLote = [...body.pendientes, ...body.firmadas].map((a) => a.lote_id);
  assert.ok(idsLote.includes(loteProducto.id));
  assert.ok(!idsLote.includes(loteProducto2.id));
  assert.equal(body.pendientes.length, 1);
  assert.equal(body.firmadas.length, 0);
});

test('un proveedor no puede firmar la asignación de otro proveedor (404: no se cruzan identidades)', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/panel-proveedor/lotes/${asignacionBId}/firmar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${proveedorATokenPayload}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(res.status, 404);
});

test('caso crítico: un token de VISTA de superadmin NO puede firmar el lote suplantando al proveedor', { skip: SALTO_PROD }, async () => {
  // El token que emite POST /api/admin/entrar-a-panel satisface a
  // propósito requireHomePanel('proveedor') — así funciona el acceso
  // multi-panel. Lo que NO debe poder hacer es escribir: firmar sellaría
  // un eslabón con el RUT y la razón social del proveedor real, sin dejar
  // rastro en el propio eslabón de que lo firmó otra persona, y dejaría la
  // asignación marcada como firmada (el proveedor real recibiría 409).
  const tokenVista = jwt.sign(
    {
      sub: `imp:${crypto.randomUUID()}:proveedor`, imp: true, imp_by: crypto.randomUUID(),
      rol: 'operador', email: `super-${sufijo}@ejemplo.cl`, panel: 'proveedor',
      nivel_acceso: 'lectura', proveedor_id: proveedorB.id,
    },
    config.jwt.accessSecret,
    { expiresIn: '5m' }
  );
  const res = await fetch(`${baseUrl}/api/panel-proveedor/lotes/${asignacionBId}/firmar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenVista}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(res.status, 403);

  // Y la asignación sigue sin firmar: el proveedor real conserva su turno.
  const { rows } = await query(`SELECT firmado_at FROM proveedor_lotes WHERE id = $1`, [asignacionBId]);
  assert.equal(rows[0].firmado_at, null);
});

test('el token de vista SÍ puede leer (es una vista, no un bloqueo total)', { skip: SALTO_PROD }, async () => {
  const tokenVista = jwt.sign(
    {
      sub: `imp:${crypto.randomUUID()}:proveedor`, imp: true, imp_by: crypto.randomUUID(),
      rol: 'operador', email: `super-${sufijo}@ejemplo.cl`, panel: 'proveedor',
      nivel_acceso: 'lectura', proveedor_id: proveedorB.id,
    },
    config.jwt.accessSecret,
    { expiresIn: '5m' }
  );
  const res = await fetch(`${baseUrl}/api/panel-proveedor/lotes`, {
    headers: { Authorization: `Bearer ${tokenVista}` },
  });
  assert.equal(res.status, 200);
});

test('una cuenta con nivel_acceso="lectura" recibe 403 antes de llegar a la lógica de negocio (migración 070)', { skip: SALTO_PROD }, async () => {
  const tokenSoloLectura = signAccess({
    id: crypto.randomUUID(), rol: 'operador', email: `prov-b-lectura-${sufijo}@ejemplo.cl`,
    panel: 'proveedor', proveedor_id: proveedorB.id, nivel_acceso: 'lectura',
  });
  const res = await fetch(`${baseUrl}/api/panel-proveedor/lotes/${asignacionBId}/firmar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenSoloLectura}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(res.status, 403);
});

test('POST /api/panel-proveedor/lotes/:id/firmar crea el eslabón con la identidad de `proveedores`, NUNCA la del body', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/panel-proveedor/lotes/${asignacionId}/firmar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${proveedorATokenPayload}`, 'Content-Type': 'application/json' },
    // rut_empresa/nombre_empresa en el body son ignorados por completo: el
    // endpoint ni siquiera los lee. Se envían para probar justamente eso.
    body: JSON.stringify({ cantidad: 5, rut_empresa: '11.111.111-1', nombre_empresa: 'Empresa Falsa' }),
  });
  const body = await res.json();
  assert.equal(res.status, 201);
  assert.equal(body.eslabon.rol, 'proveedor');
  assert.equal(body.eslabon.rut_empresa, proveedorA.rut.toLowerCase());
  assert.equal(body.eslabon.nombre_empresa, proveedorA.nombre_empresa);

  const { rows: asigRows } = await query(
    `SELECT firmado_at, eslabon_id FROM proveedor_lotes WHERE id = $1`, [asignacionId]
  );
  assert.ok(asigRows[0].firmado_at);
  assert.equal(asigRows[0].eslabon_id, body.eslabon.id);

  const { rows: provRows } = await query(`SELECT ultimo_uso FROM proveedores WHERE id = $1`, [proveedorA.id]);
  assert.ok(provRows[0].ultimo_uso);

  const { rows: eslabones } = await query(
    `SELECT id, eslabon, hash_documento, hash_anterior, hash_cadena FROM lote_eslabones WHERE lote_id = $1 ORDER BY eslabon`,
    [loteProducto.id]
  );
  const integridad = verificarCadenaCompleta(eslabones);
  assert.equal(integridad.valido, true);
});

test('firmar la misma asignación una segunda vez responde 409', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/panel-proveedor/lotes/${asignacionId}/firmar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${proveedorATokenPayload}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const body = await res.json();
  assert.equal(res.status, 409);
  assert.match(body.error, /ya firmaste/i);
});

test('firmar con el lote cerrado responde 409', { skip: SALTO_PROD }, async () => {
  const resAsignar = await fetch(`${baseUrl}/api/admin/origen/lotes/${loteParaCerrar.id}/proveedores-asignados`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ proveedor_id: proveedorA.id }),
  });
  const bodyAsignar = await resAsignar.json();
  assert.equal(resAsignar.status, 201);
  const asignacionCerrarId = bodyAsignar.asignacion.id;

  await query(`UPDATE lotes_minerales SET estado = 'cerrado' WHERE id = $1`, [loteParaCerrar.id]);

  const res = await fetch(`${baseUrl}/api/panel-proveedor/lotes/${asignacionCerrarId}/firmar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${proveedorATokenPayload}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(res.status, 409);
});

test('UNIQUE (proveedor_id, lote_id) rechaza una fila duplicada insertada directo por SQL', { skip: SALTO_PROD }, async () => {
  await assert.rejects(
    query(`INSERT INTO proveedor_lotes (proveedor_id, lote_id) VALUES ($1,$2)`, [proveedorA.id, loteProducto.id]),
    (err) => err.code === '23505'
  );
});

test('ON DELETE CASCADE: borrar `usuarios` con proveedor_id no borra `proveedores`; borrar `proveedores` sí borra usuarios y proveedor_lotes', { skip: SALTO_PROD }, async () => {
  const { rows: pRows } = await query(
    `INSERT INTO proveedores (nombre_empresa, rut) VALUES ($1,$2) RETURNING id`,
    [`Proveedor Cascada ${sufijo}`, rutAleatorio()]
  );
  const proveedorCascadaId = pRows[0].id;

  const { rows: uRows } = await query(
    `INSERT INTO usuarios (email, nombre, rol, panel, proveedor_id, estado, password_hash)
     VALUES ($1,'Usuario Cascada','operador','proveedor',$2,'activo','x') RETURNING id`,
    [`cascada-${sufijo}@ejemplo.cl`, proveedorCascadaId]
  );
  const usuarioCascadaId = uRows[0].id;

  const { rows: alRows } = await query(
    `INSERT INTO proveedor_lotes (proveedor_id, lote_id) VALUES ($1,$2) RETURNING id`,
    [proveedorCascadaId, loteCompat.id]
  );
  const asignacionCascadaId = alRows[0].id;

  // Borrar el usuario NO borra el proveedor (la FK es usuarios.proveedor_id
  // -> proveedores.id, no al revés).
  await query(`DELETE FROM usuarios WHERE id = $1`, [usuarioCascadaId]);
  const { rows: provAunExiste } = await query(`SELECT id FROM proveedores WHERE id = $1`, [proveedorCascadaId]);
  assert.equal(provAunExiste.length, 1);

  // Se recrea el login para probar la cascada en el sentido inverso.
  const { rows: uRows2 } = await query(
    `INSERT INTO usuarios (email, nombre, rol, panel, proveedor_id, estado, password_hash)
     VALUES ($1,'Usuario Cascada 2','operador','proveedor',$2,'activo','x') RETURNING id`,
    [`cascada2-${sufijo}@ejemplo.cl`, proveedorCascadaId]
  );
  const usuarioCascadaId2 = uRows2[0].id;

  // Borrar el proveedor SÍ borra su usuario y su(s) asignación(es).
  await query(`DELETE FROM proveedores WHERE id = $1`, [proveedorCascadaId]);
  const { rows: usuarioTrasBorrar } = await query(`SELECT id FROM usuarios WHERE id = $1`, [usuarioCascadaId2]);
  assert.equal(usuarioTrasBorrar.length, 0);
  const { rows: asignacionTrasBorrar } = await query(`SELECT id FROM proveedor_lotes WHERE id = $1`, [asignacionCascadaId]);
  assert.equal(asignacionTrasBorrar.length, 0);
});

// ---------- Caso crítico: compatibilidad retro con credenciales_proveedor ----------
// Simula una credencial FP-XXXX emitida ANTES de esta migración (fila
// insertada directo por SQL, como quedaría en un stock ya impreso) y
// confirma que /api/firma-proveedor/auth + /firmar la resuelven exactamente
// igual que siempre — la migración 062 no tocó esa tabla ni sus rutas.
test('caso crítico: una credencial credenciales_proveedor (rol=proveedor) de ANTES de esta migración sigue firmando sin cambios', { skip: SALTO_PROD }, async () => {
  const serial = `FP-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const clave = 'clave-compat-retro-123';
  const claveHash = await bcrypt.hash(clave, 10);
  const rutCompat = rutAleatorio();
  const nombreCompat = `Empresa Compat ${sufijo}`;

  const { rows } = await query(
    `INSERT INTO credenciales_proveedor (serial, lote_id, rol, rut_empresa, nombre_empresa, clave_hash)
     VALUES ($1,$2,'proveedor',$3,$4,$5) RETURNING id`,
    [serial, loteCompat.id, rutCompat, nombreCompat, claveHash]
  );
  const credencialId = rows[0].id;

  const resAuth = await fetch(`${baseUrl}/api/firma-proveedor/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serial, clave }),
  });
  const bodyAuth = await resAuth.json();
  assert.equal(resAuth.status, 200);
  assert.ok(bodyAuth.token);
  assert.equal(bodyAuth.credencial.serial, serial);

  const resFirmar = await fetch(`${baseUrl}/api/firma-proveedor/firmar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bodyAuth.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ cantidad: 3 }),
  });
  const bodyFirmar = await resFirmar.json();
  assert.equal(resFirmar.status, 201);
  assert.equal(bodyFirmar.eslabon.rol, 'proveedor');
  assert.equal(bodyFirmar.eslabon.rut_empresa, rutCompat.toLowerCase());
  assert.equal(bodyFirmar.eslabon.nombre_empresa, nombreCompat);

  const { rows: credTrasFirmar } = await query(
    `SELECT firmado_at, eslabon_id FROM credenciales_proveedor WHERE id = $1`, [credencialId]
  );
  assert.ok(credTrasFirmar[0].firmado_at);
  assert.equal(credTrasFirmar[0].eslabon_id, bodyFirmar.eslabon.id);

  // Repetir /auth ahora debe rechazar: la credencial ya firmó (de un solo uso).
  const resAuthOtraVez = await fetch(`${baseUrl}/api/firma-proveedor/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serial, clave }),
  });
  assert.equal(resAuthOtraVez.status, 409);
});

// ---------- Activación de cuenta gatillada por el contrato ----------
// La empresa completa sus datos y entra a su panel, pero el SII (y la
// contabilidad de carbono) queda bloqueado hasta que el admin le emite el
// contrato. `proveedorB` todavía no tiene contrato en este punto del archivo.

test('GET /api/panel-proveedor/perfil devuelve contrato_vigente=false antes de que el admin emita el contrato', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/panel-proveedor/perfil`, {
    headers: { Authorization: `Bearer ${proveedorBTokenPayload}` },
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.contrato_vigente, false);
});

test('sin contrato vigente, GET /api/panel-proveedor/sii/estado responde 403 (cuenta no activada)', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/panel-proveedor/sii/estado`, {
    headers: { Authorization: `Bearer ${proveedorBTokenPayload}` },
  });
  const body = await res.json();
  assert.equal(res.status, 403);
  assert.match(body.error, /contrato/i);
});

test('sin contrato vigente, GET /api/panel-proveedor/lotes SÍ funciona (el gate es solo del SII)', { skip: SALTO_PROD }, async () => {
  const res = await fetch(`${baseUrl}/api/panel-proveedor/lotes`, {
    headers: { Authorization: `Bearer ${proveedorBTokenPayload}` },
  });
  assert.equal(res.status, 200);
});

test('el admin emite el contrato de proveedorB → la cuenta queda activada', { skip: SALTO_PROD }, async () => {
  const resContrato = await fetch(`${baseUrl}/api/admin/sii/${proveedorB.id}/contrato`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const bodyContrato = await resContrato.json();
  assert.equal(resContrato.status, 201, JSON.stringify(bodyContrato));

  const resPerfil = await fetch(`${baseUrl}/api/panel-proveedor/perfil`, {
    headers: { Authorization: `Bearer ${proveedorBTokenPayload}` },
  });
  const bodyPerfil = await resPerfil.json();
  assert.equal(bodyPerfil.contrato_vigente, true);

  const resEstado = await fetch(`${baseUrl}/api/panel-proveedor/sii/estado`, {
    headers: { Authorization: `Bearer ${proveedorBTokenPayload}` },
  });
  assert.equal(resEstado.status, 200);
});

test('con contrato vigente, una cuenta nivel_acceso="lectura" SÍ puede leer /sii/estado y /sii/analisis (solo bloquea escribir, no leer)', { skip: SALTO_PROD }, async () => {
  const tokenLectura = signAccess({
    id: crypto.randomUUID(), rol: 'operador', email: `prov-b-lectura-sii-${sufijo}@ejemplo.cl`,
    panel: 'proveedor', proveedor_id: proveedorB.id, nivel_acceso: 'lectura',
  });

  const resEstado = await fetch(`${baseUrl}/api/panel-proveedor/sii/estado`, {
    headers: { Authorization: `Bearer ${tokenLectura}` },
  });
  assert.equal(resEstado.status, 200);

  const resAnalisis = await fetch(`${baseUrl}/api/panel-proveedor/sii/analisis/2026-01`, {
    headers: { Authorization: `Bearer ${tokenLectura}` },
  });
  assert.equal(resAnalisis.status, 200);

  // Pero sigue sin poder escribir: requireNivelOperador no quedó pisado por el gate nuevo.
  const resDescargar = await fetch(`${baseUrl}/api/panel-proveedor/sii/descargar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenLectura}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ periodo: '2026-01' }),
  });
  assert.equal(resDescargar.status, 403);
});
