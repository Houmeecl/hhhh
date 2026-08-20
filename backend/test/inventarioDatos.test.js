import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  INVENTARIO, INVENTARIO_CORREDOR, PERSONAL, NO_PERSONAL, CADENA,
  tablasConDatosDe, retenidoPorLey,
} from '../src/services/inventarioDatos.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
// Las DOS bases. El Corredor vive en `sicr3p_corredor` (ver
// lib/dbCorredor.js), pero la Ley 21.719 no distingue por base de datos:
// dejar el producto nuevo fuera del inventario sería exactamente la deriva
// que este archivo existe para impedir.
// Cada directorio con la base a la que corresponde: el escáner tiene que
// poder distinguirlas. `puntos_corredor` existe en las DOS —migración 093
// en la principal, 002 en la del Corredor— y mientras el escáner las
// aplanó en un solo Map, las dos tablas se leyeron como una sola. La misma
// ceguera que tenía el inventario.
const MIGRACIONES = [
  { dir: join(RAIZ, 'migrations'), bd: 'principal' },
  { dir: join(RAIZ, 'migrations-corredor'), bd: 'corredor' },
];

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
  // Dos conjuntos por tabla, y la distinción importa:
  //   `personales` decide QUÉ TABLAS hay que clasificar (el test de deriva);
  //   `todas` decide si una columna declarada en el inventario EXISTE.
  // Antes había uno solo, filtrado por COLUMNA_PERSONAL, y eso hacía que
  // declarar una columna real pero que el patrón no reconoce —`datos`,
  // `archivo_original`— se leyera como "ausente en la base". El síntoma se
  // había tapado con una excepción a mano para `datos`; la causa era esta.
  // La llave lleva la base, para que las dos `puntos_corredor` no se
  // fundan en una.
  const marcar = (bd, t, c) => {
    const llave = `${bd}:${t}`;
    if (!tablas.has(llave)) tablas.set(llave, { tabla: t, bd, todas: new Set(), personales: new Set() });
    if (!c) return;
    tablas.get(llave).todas.add(c);
    if (COLUMNA_PERSONAL.test(c)) tablas.get(llave).personales.add(c);
  };

  const archivos = MIGRACIONES.flatMap(({ dir, bd }) =>
    readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => ({ ruta: join(dir, f), bd })));
  for (const { ruta, bd } of archivos) {
    const sql = readFileSync(ruta, 'utf8');
    for (const [, tabla, cuerpo] of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\n\);/g)) {
      marcar(bd, tabla, null);
      for (const linea of cuerpo.split('\n')) {
        const col = linea.trim().match(TIPO);
        if (col) marcar(bd, tabla, col[1]);
      }
    }
    for (const [, tabla, col] of sql.matchAll(/ALTER TABLE (\w+)\s+ADD COLUMN IF NOT EXISTS (\w+)/gi)) {
      marcar(bd, tabla, null);
      marcar(bd, tabla, col);
    }
  }
  return tablas;
}

test('el escáner encuentra las migraciones y tablas conocidas', () => {
  const tablas = escanearMigraciones();
  assert.ok(tablas.size > 30, `esperaba >30 tablas, encontré ${tablas.size} — ¿cambió el formato de las migraciones?`);
  assert.ok(tablas.has('principal:clientes') && tablas.has('principal:facturas'));
  assert.ok(tablas.get('principal:clientes').personales.has('contacto_email'));
});

test('el escáner también mira la base del Corredor', () => {
  // Sin esto, la clasificación de las tablas del Corredor existiría en el
  // inventario pero no la vigilaría nadie: se podría agregar una columna
  // con datos de persona y el test seguiría verde.
  const tablas = escanearMigraciones();
  assert.ok(tablas.has('corredor:exportadores'), 'no encontró las migraciones del Corredor');
  assert.ok(tablas.has('corredor:parcelas'));
  assert.ok(tablas.get('corredor:usuarios_corredor').personales.has('email'));
  // `puntos_corredor` está en las DOS bases y son tablas distintas. Que el
  // escáner vea las dos es lo que impide volver a fundirlas.
  assert.ok(tablas.has('principal:puntos_corredor'), 'perdió la puntos_corredor de la base principal');
  assert.ok(tablas.has('corredor:puntos_corredor'), 'perdió la puntos_corredor del Corredor');
});

// ---------- el test que evita la deriva ----------

// El inventario de cada base, elegido por la base de la tabla.
const inventarioDe = (bd) => (bd === 'corredor' ? INVENTARIO_CORREDOR : INVENTARIO);

test('toda tabla con columnas de persona está clasificada en el inventario', () => {
  const sinClasificar = [...escanearMigraciones().values()]
    .filter((t) => t.personales.size > 0 && !inventarioDe(t.bd)[t.tabla])
    .map((t) => `${t.bd}:${t.tabla} (${[...t.personales].join(', ')})`);

  assert.deepEqual(sinClasificar, [],
    'Hay tablas con columnas de dato personal que no están en INVENTARIO de '
    + 'src/services/inventarioDatos.js. Clasifícalas —aunque sea como NO_PERSONAL '
    + 'con su motivo—: el registro de tratamientos tiene que reflejar la base real.');
});

test('cada entrada del inventario declara lo que la ley pide', () => {
  // Las dos bases: el Corredor no queda exento de declarar finalidad.
  for (const [tabla, e] of [...Object.entries(INVENTARIO), ...Object.entries(INVENTARIO_CORREDOR)]) {
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
  for (const [tabla, e] of [...Object.entries(INVENTARIO), ...Object.entries(INVENTARIO_CORREDOR)]) {
    if (e.retencion === null) {
      assert.ok(e.motivoSinPurga, `${tabla}: no se purga y no explica el motivo`);
    }
  }
});

test('las columnas declaradas existen de verdad en las migraciones', () => {
  const tablas = escanearMigraciones();
  const pares = [
    ...Object.entries(INVENTARIO).map(([t, e]) => ['principal', t, e]),
    ...Object.entries(INVENTARIO_CORREDOR).map(([t, e]) => ['corredor', t, e]),
  ];
  for (const [bd, tabla, e] of pares) {
    const reales = tablas.get(`${bd}:${tabla}`);
    assert.ok(reales, `${bd}:${tabla}: está en el inventario pero no existe en las migraciones`);
    for (const col of e.columnas) {
      // Se contrasta contra TODAS las columnas de la tabla, no solo contra
      // las que el patrón reconoce como personales: el inventario declara
      // dónde está el dato, y a veces está en una columna cuyo nombre no lo
      // delata (`datos` JSONB, `archivo_original`). Que el patrón no la
      // marque no significa que no exista.
      assert.ok(reales.todas.has(col), `${tabla}.${col}: declarada en el inventario, ausente en la base`);
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
  const todas = [...tablasConDatosDe('a@b.cl'), ...tablasConDatosDe('1-9')];
  for (const t of todas) {
    const e = inventarioDe(t.bd)[t.tabla];
    assert.ok(e, `${t.bd}:${t.tabla}: devuelta para buscar y ausente de su inventario`);
    assert.equal(e.clasificacion, PERSONAL, `${t.bd}:${t.tabla}`);
  }
});

test('tablasConDatosDe alcanza la base del Corredor', () => {
  // Este es EL test del hallazgo. Hasta el 20-08-2026 tablasConDatosDe
  // solo recorría INVENTARIO, así que exportadores, usuarios_corredor y
  // actividad_corredor —las tres con datos personales— no aparecían jamás
  // en la respuesta a un derecho de acceso. La ruta las buscaba con el
  // pool equivocado, no las encontraba y las saltaba sin decir nada: el
  // titular recibía un paquete incompleto con cara de completo.
  const porCorreo = tablasConDatosDe('a@b.cl');
  const delCorredor = porCorreo.filter((t) => t.bd === 'corredor').map((t) => t.tabla);
  for (const esperada of ['exportadores', 'usuarios_corredor', 'actividad_corredor']) {
    assert.ok(delCorredor.includes(esperada), `falta ${esperada}: el Corredor volvió a quedar fuera del acceso`);
  }
  // Y toda tabla devuelta declara en qué base vive: sin eso, quien
  // consulta no puede elegir pool y vuelve el salto mudo.
  for (const t of porCorreo) assert.ok(t.bd, `${t.tabla} no declara base`);
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
