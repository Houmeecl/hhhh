import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import crypto from 'crypto';
import fs from 'node:fs';
import path from 'node:path';
import { queryCorredor, cerrarCorredor, corredorDisponible } from '../src/lib/dbCorredor.js';
import { runMigrationsCorredor } from '../src/lib/migrate.js';
import { firmarTokenCorredor, corredorConfigurado } from '../src/middleware/authCorredor.js';
import corredorApi from '../src/routes/corredorApi.js';
import { EN_PRODUCCION } from './util/soloDev.js';
import { limpiarCorredorPorEmpresa, limpiarUsuariosCorredor } from './util/limpiarCorredor.js';

// ============================================================
// La pantalla del admin del Corredor.
//
// EL HUECO QUE ESTO CIERRA, visto en producción el 19-08-2026: se creó el
// primer admin, entró al panel… y no había nada. `POST /exportadores`
// estaba escrito desde la primera tanda y NINGUNA pantalla lo llamaba, ni
// existía un GET para ver el resultado. Las dos pestañas del panel
// —Cargas y Predios— filtran por `exportador_id`, que un admin no tiene,
// así que le salían vacías por diseño.
//
// Es el mismo error que ya habíamos corregido dos veces en este proyecto:
// una tabla o una ruta que existe y nadie escribe ni lee. Acá el guardián
// es doble: los casos de la API, y uno que compara las rutas del backend
// contra lo que el frontend llama.
// ============================================================

const SIN_CORREDOR = EN_PRODUCCION
  ? 'NODE_ENV=production'
  : (corredorConfigurado() ? false : 'el Corredor no está configurado en este entorno');

const suf = crypto.randomBytes(3).toString('hex').toUpperCase();
let server; let baseUrl; let tkAdmin; let tkOperador; let empresaId;

const pedir = async (m, p, tk, body) => {
  const r = await fetch(baseUrl + p, {
    method: m,
    headers: { ...(tk ? { Authorization: `Bearer ${tk}` } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, d: await r.json().catch(() => null) };
};

before(async () => {
  if (SIN_CORREDOR) return;
  await runMigrationsCorredor();
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/corredor', corredorApi);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const { rows } = await queryCorredor(
    `INSERT INTO usuarios_corredor (email,nombre,password_hash,rol,must_reset_password)
     VALUES ($1,'Admin de Prueba','x','admin',false) RETURNING *`, [`admin-emp-${suf}@ejemplo.cl`]);
  tkAdmin = firmarTokenCorredor(rows[0]);

  const alta = await pedir('POST', '/api/corredor/exportadores', tkAdmin,
    { nombre_empresa: `Empresa Emp ${suf}`, rut: `98${suf}111`, pais: 'BR', contacto_email: `emp-${suf}@ejemplo.cl` });
  empresaId = alta.d.exportador.id;
  const login = await pedir('POST', '/api/corredor/auth/login', null,
    { email: `emp-${suf}@ejemplo.cl`, password: alta.d.password_temporal });
  const cambio = await pedir('POST', '/api/corredor/auth/cambiar-password', login.d.access,
    { password: 'ClaveDePrueba1' });
  tkOperador = cambio.d.access;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (corredorDisponible()) {
    await queryCorredor(`DELETE FROM actividad_corredor WHERE email LIKE $1`, [`%-${suf}@ejemplo.cl`]).catch(() => {});
    // Las cargas ANTES que el exportador: `cargas → exportadores` es la
    // única llave RESTRICT del Corredor. Ver test/util/limpiarCorredor.js.
    await limpiarCorredorPorEmpresa(`Empresa Emp ${suf}`);
    await limpiarUsuariosCorredor(`%-${suf}@ejemplo.cl`);
  }
  await cerrarCorredor();
});

test('el admin ve la lista de empresas que enroló', { skip: SIN_CORREDOR }, async () => {
  const r = await pedir('GET', '/api/corredor/exportadores', tkAdmin);
  assert.equal(r.status, 200);
  const mia = r.d.exportadores.find((e) => e.id === empresaId);
  assert.ok(mia, 'la empresa recién creada tiene que estar en la lista');
  // Los conteos son lo único que dice si la empresa ya empezó a trabajar.
  assert.equal(mia.n_cargas, 0);
  assert.equal(mia.n_parcelas, 0);
  // El backend normaliza el correo a minúsculas al crear la cuenta.
  assert.equal(mia.usuario_email, `emp-${suf}@ejemplo.cl`.toLowerCase());
});

test('la lista distingue "nunca entró" de "entró y ya definió su clave"', { skip: SIN_CORREDOR }, async () => {
  const r = await pedir('GET', '/api/corredor/exportadores', tkAdmin);
  const mia = r.d.exportadores.find((e) => e.id === empresaId);
  // Este operador ya entró y cambió la clave en el `before`.
  assert.equal(mia.must_reset_password, false);
  assert.ok(mia.ultimo_acceso, 'quedó registrado su acceso');
});

test('un operador NO puede listar las empresas', { skip: SIN_CORREDOR }, async () => {
  const r = await pedir('GET', '/api/corredor/exportadores', tkOperador);
  assert.equal(r.status, 403);
});

test('sin sesión tampoco', { skip: SIN_CORREDOR }, async () => {
  assert.equal((await pedir('GET', '/api/corredor/exportadores', null)).status, 401);
});

test('el admin mirando la carga de una empresa queda REGISTRADO', { skip: SIN_CORREDOR }, async () => {
  // Un permiso que no deja rastro es indistinguible de uno que nadie usó.
  // Mismo criterio que los cruces auditados de sicr3p (routes/buscar.js).
  const antes = await queryCorredor(
    `SELECT count(*)::int AS n FROM actividad_corredor WHERE accion = 'mirar_como_exportador' AND entidad_id = $1`,
    [empresaId]
  );
  const r = await pedir('GET', `/api/corredor/cargas?exportador_id=${empresaId}`, tkAdmin);
  assert.equal(r.status, 200);
  const despues = await queryCorredor(
    `SELECT count(*)::int AS n, max(detalle::text) AS ultimo FROM actividad_corredor
      WHERE accion = 'mirar_como_exportador' AND entidad_id = $1`,
    [empresaId]
  );
  assert.ok(despues.rows[0].n > antes.rows[0].n, 'la mirada del admin tiene que dejar traza');
  assert.match(despues.rows[0].ultimo, /cargas/, 'y decir qué ruta miró');
});

test('un operador NO puede mirar la carga de otra empresa por query', { skip: SIN_CORREDOR }, async () => {
  // Su empresa sale del token, no del request: el query param se ignora.
  const otra = await pedir('POST', '/api/corredor/exportadores', tkAdmin,
    { nombre_empresa: `Empresa Emp ${suf}`, rut: `98${suf}999`, pais: 'CL', contacto_email: `otra-${suf}@ejemplo.cl` });
  const r = await pedir('GET', `/api/corredor/cargas?exportador_id=${otra.d.exportador.id}`, tkOperador);
  assert.equal(r.status, 200);
  assert.deepEqual(r.d.cargas, [], 've las suyas (ninguna), no las de la otra empresa');
});

// ---------- El guardián estructural ----------

test('toda ruta del Corredor tiene quien la llame en el panel', () => {
  // Es el error que ya se corrigió dos veces acá: una ruta o una tabla que
  // existe y nadie usa. Se lee el código, no se ejecuta.
  const raiz = path.join(import.meta.dirname, '..');
  const rutas = fs.readFileSync(path.join(raiz, 'src/routes/corredorApi.js'), 'utf8');
  const cliente = fs.readFileSync(path.join(raiz, '../frontend/src/panel-corredor/api.js'), 'utf8');

  const declaradas = [...rutas.matchAll(/router\.(get|post|put|delete)\(\s*'([^']+)'/g)]
    .map((m) => m[2])
    // El primer segmento basta: el cliente arma el resto con plantillas.
    .map((r) => r.split('/').filter(Boolean)[0])
    .filter(Boolean);

  const sinCliente = [...new Set(declaradas)].filter((seg) => !cliente.includes(`/${seg}`));
  assert.deepEqual(
    sinCliente, [],
    `estas rutas del Corredor no las llama nadie desde el panel: ${sinCliente.join(', ')}. `
    + 'O se usan, o se borran — una ruta sin pantalla es una promesa que no existe.'
  );
});

test('el panel muestra pestañas distintas según el rol', () => {
  const shell = fs.readFileSync(
    path.join(import.meta.dirname, '..', '../frontend/src/panel-corredor/CorredorApp.jsx'), 'utf8'
  );
  assert.match(shell, /TABS_ADMIN/);
  assert.match(shell, /TABS_OPERADOR/);
  assert.match(shell, /rol === 'admin'/);
  // Un admin no puede terminar en Cargas/Predios: filtran por una empresa
  // que no tiene y le saldrían siempre vacías.
  assert.match(shell, /Empresas/);
});
