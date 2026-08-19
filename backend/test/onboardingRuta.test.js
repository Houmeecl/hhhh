import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import crypto from 'crypto';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { signAccess } from '../src/middleware/auth.js';
import adminRouter from '../src/routes/admin.js';
import { EN_PRODUCCION, SALTO_PROD } from './util/soloDev.js';

// ============================================================
// GET /api/admin/onboarding/empresas — la cola de empresas a medio enrolar.
//
// Lo que estos casos cuidan:
//
//  · QUE EL SQL SIGA CALZANDO CON EL GATE REAL DEL PANEL. El test puro
//    (onboarding.test.js) prueba la clasificación; acá se prueba lo que él
//    no puede: que `con_contrato` se calcule con el MISMO criterio que
//    GET /panel-proveedor/perfil (`estado <> 'anulado'`, borrador incluido)
//    y que el LEFT JOIN LATERAL no invente ni pierda filas.
//  · QUE UNA EMPRESA TERMINADA DESAPAREZCA. Si las 'listo' salieran, la
//    cola se llenaría de empresas sanas y el aviso del Dashboard dejaría
//    de significar algo.
//  · QUE EL RBAC NO SE AFLOJE. La cola muestra correos de contacto de
//    todas las empresas: exige 'enrolar' o 'proveedores', y nada más.
// ============================================================

const sufijo = crypto.randomBytes(4).toString('hex').toUpperCase();
let server;
let baseUrl;
const creados = { proveedores: [], usuarios: [] };

const tokenCon = (...secciones) => signAccess({
  id: crypto.randomUUID(), rol: 'admin', email: `onb-${sufijo}@ejemplo.cl`,
  panel: 'sicrep', secciones_admin: secciones,
});

const get = (token) => fetch(`${baseUrl}/api/admin/onboarding/empresas`, {
  headers: { Authorization: `Bearer ${token}` },
});

// RUT ficticio con dígito verificador 'K' para no chocar con ninguno real.
const rutFicticio = (n) => `9${n}${sufijo.slice(0, 5)}K`.slice(0, 12);

async function crearEmpresa(nombre, n) {
  const { rows } = await query(
    `INSERT INTO proveedores (nombre_empresa, rut) VALUES ($1,$2) RETURNING id`,
    [nombre, rutFicticio(n)]
  );
  creados.proveedores.push(rows[0].id);
  return rows[0].id;
}

before(async () => {
  if (EN_PRODUCCION) return;
  await runMigrations();
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (creados.usuarios.length) {
    await query(`DELETE FROM usuarios WHERE id = ANY($1::uuid[])`, [creados.usuarios]);
  }
  if (creados.proveedores.length) {
    await query(`DELETE FROM contratos WHERE proveedor_id = ANY($1::uuid[])`, [creados.proveedores]);
    await query(`DELETE FROM proveedores WHERE id = ANY($1::uuid[])`, [creados.proveedores]);
  }
  await pool.end();
});

test('sin la sección no se ve la cola; con cualquiera de las dos, sí',
  { skip: SALTO_PROD }, async () => {
    assert.equal((await get(tokenCon('clientes'))).status, 403);
    assert.equal((await get(tokenCon('enrolar'))).status, 200);
    assert.equal((await get(tokenCon('proveedores'))).status, 200);
  });

test('una empresa recién creada sale como "sin acceso web"',
  { skip: SALTO_PROD }, async () => {
    const id = await crearEmpresa(`Onboarding Nueva ${sufijo}`, 1);
    const d = await (await get(tokenCon('enrolar'))).json();
    const fila = d.empresas.find((e) => e.id === id);
    assert.ok(fila, 'la empresa nueva tiene que estar en la cola');
    assert.equal(fila.etapa, 'sin_cuenta');
    assert.equal(fila.bloqueado_por, 'sicr3p');
    assert.equal(fila.usuario_id, null);
    assert.equal(fila.con_contrato, false);
  });

test('con cuenta activada y datos completos, el pendiente es el contrato',
  { skip: SALTO_PROD }, async () => {
    const id = await crearEmpresa(`Onboarding Con Datos ${sufijo}`, 2);
    const { rows } = await query(
      `INSERT INTO usuarios (email, nombre, rol, panel, proveedor_id, nivel_acceso, estado, password_hash, must_reset_password)
       VALUES ($1,'Contacto','operador','proveedor',$2,'operador','activo','x',false) RETURNING id`,
      [`onb-datos-${sufijo}@ejemplo.cl`, id]
    );
    creados.usuarios.push(rows[0].id);
    await query(`UPDATE proveedores SET onboarding_completado_at = now() WHERE id = $1`, [id]);

    const d = await (await get(tokenCon('enrolar'))).json();
    const fila = d.empresas.find((e) => e.id === id);
    assert.equal(fila.etapa, 'sin_contrato');
    assert.equal(fila.accion, 'emitir_contrato');
    assert.ok(d.esperando_por_nosotros >= 1);
  });

test('con contrato en BORRADOR la empresa sale de la cola, igual que en el panel',
  { skip: SALTO_PROD }, async () => {
    // Esta es la regresión que importa: el gate de GET /panel-proveedor/perfil
    // acepta cualquier estado salvo 'anulado'. Si el SQL de la cola exigiera
    // 'aceptado', se pediría emitir un contrato que ya existe — y emitirlo
    // choca con uq_contratos_vigente_proveedor.
    const id = await crearEmpresa(`Onboarding Completa ${sufijo}`, 3);
    const { rows } = await query(
      `INSERT INTO usuarios (email, nombre, rol, panel, proveedor_id, nivel_acceso, estado, password_hash, must_reset_password)
       VALUES ($1,'Contacto','operador','proveedor',$2,'operador','activo','x',false) RETURNING id`,
      [`onb-lista-${sufijo}@ejemplo.cl`, id]
    );
    creados.usuarios.push(rows[0].id);
    await query(`UPDATE proveedores SET onboarding_completado_at = now() WHERE id = $1`, [id]);
    await query(
      `INSERT INTO contratos (proveedor_id, numero, plantilla_version, tipo, estado, datos, hash_documento)
       VALUES ($1,$2,'test','asesoria','borrador','{}','hash-de-prueba')`,
      [id, `ONB-${sufijo}`]
    );

    const d = await (await get(tokenCon('enrolar'))).json();
    assert.equal(d.empresas.some((e) => e.id === id), false);
  });

test('una empresa desactivada no es un pendiente',
  { skip: SALTO_PROD }, async () => {
    const id = await crearEmpresa(`Onboarding Baja ${sufijo}`, 4);
    await query(`UPDATE proveedores SET activo = false WHERE id = $1`, [id]);
    const d = await (await get(tokenCon('enrolar'))).json();
    assert.equal(d.empresas.some((e) => e.id === id), false);
  });

test('la cola no filtra por contrato en el SQL: cada empresa aparece una sola vez',
  { skip: SALTO_PROD }, async () => {
    // El LEFT JOIN LATERAL tiene LIMIT 1 justamente para esto. Sin él, una
    // empresa con dos contratos (uno anulado y uno vigente) saldría dos veces.
    const d = await (await get(tokenCon('enrolar'))).json();
    const ids = d.empresas.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length);
  });
