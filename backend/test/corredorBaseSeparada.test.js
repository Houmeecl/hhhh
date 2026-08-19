import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { corredorDisponible, queryCorredor, cerrarCorredor } from '../src/lib/dbCorredor.js';
import { runMigrationsCorredor } from '../src/lib/migrate.js';

// ============================================================
// La base del Corredor está SEPARADA de la de sicr3p.
//
// Lo que estos casos cuidan, en orden de importancia:
//
//  1. QUE LA AUSENCIA DEL CORREDOR NO TUMBE EL BACKEND. index.js mata el
//     proceso ante cualquier error de arranque, y `runMigrations()` corre
//     ahí adentro. El Corredor es un producto nuevo y opcional: que su
//     base no exista todavía en el servidor no puede dejar sin backend a
//     una empresa que solo usa la contabilidad de carbono. Por eso
//     runMigrationsCorredor() DEVUELVE un estado en vez de lanzar.
//  2. QUE PEDIRLE ALGO AL CORREDOR APAGADO FALLE BIEN. Un 503 con código
//     legible, no un stack trace de conexión rechazada.
//  3. QUE IMPORTAR EL MÓDULO NO ABRA CONEXIONES. Un pool creado al
//     importar dejaría un handle vivo que impide que el proceso termine, y
//     la suite entera se quedaría colgada al final.
//  4. QUE EL SECRETO DE JWT SEA OTRO. Compartirlo haría que un token del
//     Corredor verificara contra la app principal. Con secretos distintos
//     ni siquiera verifica.
//
// Ninguno de estos casos exige que la base del Corredor exista: corren
// igual en el VPS, donde hoy no está creada.
// ============================================================

after(async () => { await cerrarCorredor(); });

const CONFIGURADO = corredorDisponible();

test('sin DATABASE_URL_CORREDOR el subsistema queda apagado, no roto', () => {
  if (CONFIGURADO) return; // este entorno sí lo tiene; el caso lo cubre el de abajo
  assert.equal(corredorDisponible(), false);
});

test('la migración del Corredor DEVUELVE estado, nunca lanza', async () => {
  // Es la garantía que sostiene el arranque: index.js llama a esto dentro
  // del try que hace process.exit(1).
  const r = await runMigrationsCorredor();
  assert.ok(['ok', 'apagado', 'error'].includes(r.estado), `estado inesperado: ${r.estado}`);
});

test('una URL rota tampoco lanza: se informa el error y la app sigue', async (t) => {
  const original = config.corredor.databaseUrl;
  config.corredor.databaseUrl = 'postgresql://nadie@127.0.0.1:1/no_existe';
  await cerrarCorredor();
  try {
    const r = await runMigrationsCorredor();
    assert.equal(r.estado, 'error');
    assert.ok(r.error, 'tiene que decir qué falló');
  } finally {
    config.corredor.databaseUrl = original;
    await cerrarCorredor();
  }
});

test('consultar el Corredor apagado da 503 con código legible', async () => {
  const original = config.corredor.databaseUrl;
  config.corredor.databaseUrl = '';
  await cerrarCorredor();
  try {
    await queryCorredor('SELECT 1');
    assert.fail('debería haber fallado');
  } catch (e) {
    assert.equal(e.status, 503);
    assert.equal(e.codigo, 'corredor_no_configurado');
    assert.match(e.message, /DATABASE_URL_CORREDOR/);
  } finally {
    config.corredor.databaseUrl = original;
    await cerrarCorredor();
  }
});

test('el secreto de JWT del Corredor es otro, no el de sicr3p', () => {
  // Si algún día se configuran los dos, no pueden coincidir: un token del
  // Corredor que verifica contra la app principal es exactamente lo que la
  // separación viene a impedir.
  if (!config.corredor.jwtSecret) return; // no configurado en este entorno
  assert.notEqual(config.corredor.jwtSecret, config.jwt.accessSecret);
});

test('las migraciones del Corredor viven en su propio directorio', () => {
  const dir = path.resolve(process.cwd(), 'migrations-corredor');
  assert.ok(fs.existsSync(dir), 'falta migrations-corredor/');
  const suyas = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
  assert.ok(suyas.length > 0, 'el directorio está vacío');
  // Y no se mezclan con las de sicr3p: numeración propia desde 001.
  assert.ok(suyas.some((f) => f.startsWith('001_')), 'la numeración del Corredor parte en 001');
});

test('ninguna migración del Corredor referencia tablas de sicr3p', () => {
  // Postgres no permite FK entre bases distintas, así que esto no
  // compilaría — pero fallaría en el arranque del servidor y no acá.
  // Mejor cazarlo antes: nombres de tabla que solo existen del otro lado.
  const dir = path.resolve(process.cwd(), 'migrations-corredor');
  const ajenas = ['facturas', 'proveedores(', 'lotes_minerales', 'expedientes', 'datos_trazables'];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql'))) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const refs = sql.match(/REFERENCES\s+(\w+)/gi) || [];
    for (const r of refs) {
      const tabla = r.split(/\s+/)[1].toLowerCase();
      assert.ok(
        !ajenas.some((a) => tabla === a.replace('(', '')),
        `${f} referencia ${tabla}, que vive en la base de sicr3p`,
      );
    }
  }
});

// ---- Los que sí necesitan la base creada ----
const SIN_BASE = CONFIGURADO ? false : 'la base del Corredor no está configurada en este entorno';

test('el esquema del Corredor tiene su propio mundo completo',
  { skip: SIN_BASE }, async () => {
    await runMigrationsCorredor();
    const { rows } = await queryCorredor(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    );
    const tablas = rows.map((r) => r.tablename);
    for (const t of ['exportadores', 'usuarios_corredor', 'cargas', 'parcelas', 'carga_pasos']) {
      assert.ok(tablas.includes(t), `falta ${t}`);
    }
  });

test('el Corredor no ve ninguna tabla de sicr3p',
  { skip: SIN_BASE }, async () => {
    const { rows } = await queryCorredor(
      `SELECT count(*)::int AS n FROM pg_tables
        WHERE tablename IN ('facturas','proveedores','expedientes','datos_trazables')`
    );
    assert.equal(rows[0].n, 0);
  });

test('carga_pasos no guarda posición del vehículo, y no debe tenerla nunca',
  { skip: SIN_BASE }, async () => {
    // La carga cruza cuatro países: un rastro en vivo es el mapa que
    // necesita quien la quiera interceptar. Se registra el hito en un punto
    // de control conocido, no dónde va el móvil.
    const { rows } = await queryCorredor(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'carga_pasos'`
    );
    const cols = rows.map((r) => r.column_name);
    for (const prohibida of ['lat', 'lng', 'latitud', 'longitud', 'posicion', 'accuracy']) {
      assert.ok(!cols.includes(prohibida), `carga_pasos no puede tener ${prohibida}`);
    }
  });

test('una parcela sin ubicación no entra',
  { skip: SIN_BASE }, async () => {
    const { rows } = await queryCorredor(
      `INSERT INTO exportadores (nombre_empresa, rut) VALUES ('Prueba Esquema SpA', $1) RETURNING id`,
      [`98${Date.now().toString().slice(-7)}K`]
    );
    const exp = rows[0].id;
    try {
      await queryCorredor(
        `INSERT INTO parcelas (exportador_id, nombre, pais) VALUES ($1,'Sin ubicación','BR')`, [exp]
      );
      assert.fail('debería haber rechazado una parcela sin punto ni polígono');
    } catch (e) {
      assert.match(e.message, /parcelas_con_ubicacion/);
    } finally {
      await queryCorredor('DELETE FROM exportadores WHERE id = $1', [exp]);
    }
  });

test('el nivel 4 exige quién, contra qué y cuándo',
  { skip: SIN_BASE }, async () => {
    const { rows } = await queryCorredor(
      `INSERT INTO exportadores (nombre_empresa, rut) VALUES ('Prueba Nivel SpA', $1) RETURNING id`,
      [`97${Date.now().toString().slice(-7)}K`]
    );
    const exp = rows[0].id;
    try {
      await queryCorredor(
        `INSERT INTO parcelas (exportador_id, nombre, pais, lat, lng, nivel_confianza)
         VALUES ($1,'Sin validador','BR',-15.1,-56.2,4)`, [exp]
      );
      assert.fail('un nivel 4 sin validador no puede entrar');
    } catch (e) {
      assert.match(e.message, /nivel4_exige_validador/);
    } finally {
      await queryCorredor('DELETE FROM exportadores WHERE id = $1', [exp]);
    }
  });
