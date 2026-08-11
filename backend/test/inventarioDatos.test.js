import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  INVENTARIO, PERSONAL, NO_PERSONAL, CADENA,
  tablasConDatosDe, retenidoPorLey,
} from '../src/services/inventarioDatos.js';

const MIGRACIONES = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

// Nombres de columna que delatan un dato de persona. Deliberadamente
// amplio: prefiere marcar de más y obligar a decidir, antes que dejar
// pasar una tabla sin clasificar. Las coordenadas GPS entran acá: la
// ubicación puntual de una persona (reciclajes, trayectos) es dato
// personal aunque la columna se llame solo "lat"/"lng".
const COLUMNA_PERSONAL = /(email|correo|rut|nombre|contacto|conductor|portador|telefono|direccion|domicilio|representante)|^ip$|_ip$|^(salida_|llegada_)?(lat|lng)$/i;
const TIPO = /^(\w+)\s+(TEXT|UUID|BOOLEAN|INT|BIGINT|NUMERIC|DATE|TIMESTAMPTZ|JSONB|BYTEA)/i;

// Lee las migraciones y devuelve tabla -> columnas candidatas. Misma
// fuente de verdad que la base real, sin necesitar una conexión.
function escanearMigraciones() {
  const tablas = new Map();
  const marcar = (t, c) => {
    if (!tablas.has(t)) tablas.set(t, new Set());
    if (c && COLUMNA_PERSONAL.test(c)) tablas.get(t).add(c);
  };

  for (const archivo of readdirSync(MIGRACIONES).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRACIONES, archivo), 'utf8');
    for (const [, tabla, cuerpo] of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\n\);/g)) {
      marcar(tabla, null);
      for (const linea of cuerpo.split('\n')) {
        const col = linea.trim().match(TIPO);
        if (col) marcar(tabla, col[1]);
      }
    }
    for (const [, tabla, col] of sql.matchAll(/ALTER TABLE (\w+)\s+ADD COLUMN IF NOT EXISTS (\w+)/gi)) {
      marcar(tabla, null);
      marcar(tabla, col);
    }
  }
  return tablas;
}

test('el escáner encuentra las migraciones y tablas conocidas', () => {
  const tablas = escanearMigraciones();
  assert.ok(tablas.size > 30, `esperaba >30 tablas, encontré ${tablas.size} — ¿cambió el formato de las migraciones?`);
  assert.ok(tablas.has('clientes') && tablas.has('facturas'));
  assert.ok(tablas.get('clientes').has('contacto_email'));
});

// ---------- el test que evita la deriva ----------

test('toda tabla con columnas de persona está clasificada en el inventario', () => {
  const sinClasificar = [...escanearMigraciones()]
    .filter(([tabla, cols]) => cols.size > 0 && !INVENTARIO[tabla])
    .map(([tabla, cols]) => `${tabla} (${[...cols].join(', ')})`);

  assert.deepEqual(sinClasificar, [],
    'Hay tablas con columnas de dato personal que no están en INVENTARIO de '
    + 'src/services/inventarioDatos.js. Clasifícalas —aunque sea como NO_PERSONAL '
    + 'con su motivo—: el registro de tratamientos tiene que reflejar la base real.');
});

test('cada entrada del inventario declara lo que la ley pide', () => {
  for (const [tabla, e] of Object.entries(INVENTARIO)) {
    assert.ok([PERSONAL, NO_PERSONAL].includes(e.clasificacion), `${tabla}: clasificación inválida`);
    assert.ok(typeof e.finalidad === 'string' && e.finalidad.length > 0, `${tabla}: sin finalidad`);
    assert.ok('cadena' in e, `${tabla}: no declara si está encadenada`);
    if (e.clasificacion === PERSONAL) {
      assert.ok(e.columnas.length > 0, `${tabla}: es personal pero no dice qué columnas`);
      assert.ok(e.base, `${tabla}: es personal y no declara base de licitud`);
    } else {
      assert.equal(e.columnas.length, 0, `${tabla}: es no_personal pero lista columnas personales`);
    }
  }
});

test('lo que no se purga dice por qué', () => {
  for (const [tabla, e] of Object.entries(INVENTARIO)) {
    if (e.retencion === null) {
      assert.ok(e.motivoSinPurga, `${tabla}: no se purga y no explica el motivo`);
    }
  }
});

test('las columnas declaradas existen de verdad en las migraciones', () => {
  const tablas = escanearMigraciones();
  for (const [tabla, e] of Object.entries(INVENTARIO)) {
    const reales = tablas.get(tabla);
    assert.ok(reales, `${tabla}: está en el inventario pero no existe en las migraciones`);
    for (const col of e.columnas) {
      // `datos` es JSONB: el escáner no puede ver adentro, se declara a mano.
      if (col === 'datos') continue;
      assert.ok(reales.has(col), `${tabla}.${col}: declarada en el inventario, ausente en la base`);
    }
  }
});

// ---------- lo encadenado es intocable ----------

test('ninguna tabla encadenada se purga', () => {
  for (const [tabla, e] of Object.entries(INVENTARIO)) {
    if (e.cadena !== CADENA.NINGUNA) {
      assert.equal(e.retencion, null,
        `${tabla}: está encadenada (${e.cadena}) y declara una purga — borrar o editar una fila encadenada invalida todos los eslabones posteriores`);
    }
  }
});

test('sesiones no se purga: de ella cuelgan facturas encadenadas', () => {
  // El CASCADE de facturas y declaraciones_embalaje hacia sesiones hace
  // que borrar una sesión rompa la cadena global sin ningún aviso.
  assert.equal(INVENTARIO.sesiones.retencion, null);
  assert.match(INVENTARIO.sesiones.motivoSinPurga, /encadenad/i);
  assert.match(INVENTARIO.sesiones.nota, /CASCADE/);
});

// ---------- lo que consume ARCOP ----------

test('tablasConDatosDe distingue buscar por correo de buscar por RUT', () => {
  const porCorreo = tablasConDatosDe('ana@ejemplo.cl').map((t) => t.tabla);
  assert.ok(porCorreo.includes('clientes'), 'el correo de contacto del cliente debe ser alcanzable');
  assert.ok(porCorreo.includes('usuarios'));
  assert.ok(!porCorreo.includes('facturas'), 'facturas no tiene correo, solo RUT');

  const porRut = tablasConDatosDe('76.570.751-K').map((t) => t.tabla);
  assert.ok(porRut.includes('facturas'));
  assert.ok(!porRut.includes('actividad_log'), 'el log se busca por usuario, no por RUT');
});

test('tablasConDatosDe nunca devuelve una tabla clasificada como no personal', () => {
  const todas = [...tablasConDatosDe('a@b.cl'), ...tablasConDatosDe('1-9')].map((t) => t.tabla);
  for (const t of todas) assert.equal(INVENTARIO[t].clasificacion, PERSONAL);
});

test('retenidoPorLey explica cada cosa que no se puede borrar', () => {
  const retenido = retenidoPorLey();
  assert.ok(retenido.length > 0);
  const facturas = retenido.find((r) => r.tabla === 'facturas');
  assert.ok(facturas, 'las facturas son el caso central: encadenadas y con respaldo tributario');
  assert.equal(facturas.cadena, CADENA.GLOBAL);
  for (const r of retenido) assert.ok(r.motivo.length > 0, `${r.tabla}: sin fundamento`);
});

test('una columna que guarda un RUT sin decirlo en su nombre igual es buscable', () => {
  // `tarjetas_viaje.conductor_documento` es el RUT del conductor. Deducir el
  // tipo de identificador del nombre de la columna la dejaba fuera, así que
  // quien conduce no habría encontrado su propio registro al ejercer el
  // derecho de acceso. La entrada lo declara con `columnasRut`.
  const tarjetas = tablasConDatosDe('12.345.678-5').find((t) => t.tabla === 'tarjetas_viaje');
  assert.ok(tarjetas, 'las tarjetas de viaje quedaron fuera de la búsqueda por RUT');
  assert.ok(
    tarjetas.columnas.includes('conductor_documento'),
    'el documento del conductor no se busca: es el dato personal más nítido del sistema.'
  );
});

test('lo declarado en columnasRut/columnasEmail existe en columnas', () => {
  for (const [tabla, e] of Object.entries(INVENTARIO)) {
    for (const c of [...(e.columnasRut || []), ...(e.columnasEmail || [])]) {
      assert.ok(e.columnas.includes(c), `${tabla}: declara ${c} como identificador pero no lo lista en columnas`);
    }
  }
});

test('el conductor de una tarjeta está en el inventario y su registro no se borra', () => {
  const t = INVENTARIO.tarjetas_viaje;
  assert.equal(t.clasificacion, PERSONAL, 'un conductor identificado por nombre y documento es una persona');
  assert.equal(t.cadena, CADENA.PROPIA, 'la tarjeta está encadenada por hash');
  assert.equal(t.retencion, null);
  assert.match(t.motivoSinPurga, /RESPONDE, no se ejecuta/,
    'la supresión sobre un registro encadenado se responde, no se ejecuta');
});
