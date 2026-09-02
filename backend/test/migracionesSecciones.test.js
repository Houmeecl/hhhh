import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { SECCIONES_ADMIN } from '../src/constants/seccionesAdmin.js';

// ============================================================
// El vocabulario de secciones se declara UNA SOLA VEZ.
//
// EL BUG QUE ESTE ARCHIVO EXISTE PARA IMPEDIR. `migrate.js` no lleva
// registro: corre todos los .sql en cada arranque, siempre, en orden. Tres
// migraciones (092, 097, 100) hacían cada una `DROP CONSTRAINT` + `ADD
// CONSTRAINT` con una foto del vocabulario de su época.
//
// Mientras nadie usara una sección nueva no se notaba. Pero apenas una
// cuenta recibía 'cobros' —sección que existe desde la 100 y que el panel
// ofrece con un checkbox— el arranque volvía a pasar por la 097, que no
// conoce 'cobros', y moría:
//
//     check constraint "usuarios_secciones_admin_check" is violated by some row
//
// Es decir: **marcar una casilla en el panel dejaba el servidor sin
// arrancar en el siguiente despliegue**, y `deploy/actualizar.sh`
// reinicia en cada despliegue. Estuvo latente desde la 100 y se destapó al
// agregar 'activos' en la 110.
//
// LA PREMISA CAMBIÓ EL 01-09, y este archivo con ella. Al darle registro
// a `migrate.js` (`migraciones_aplicadas`), cada .sql corre UNA SOLA VEZ:
//
//   · En base nueva corren 092, 097, 100 y 110 en orden, cuando todavía no
//     hay ninguna fila que pueda violar el CHECK. Gana la última.
//   · En base existente ninguna vuelve a correr.
//
// Con eso, que varias migraciones impongan el CHECK dejó de ser una bomba,
// y la 097 y la 100 pudieron volver a su texto original —que es lo que el
// §3 del foco pedía y sin registro era imposible cumplir—.
//
// Lo que este archivo sigue guardando es el invariante que SÍ importa: que
// la migración más nueva declare el vocabulario COMPLETO. Si alguien agrega
// una sección al backend y al frontend pero no a la última migración, una
// base recién instalada la rechaza y el arranque muere.
// ============================================================

const DIR = new URL('../migrations/', import.meta.url).pathname;
const ARCHIVOS = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const RESTRICCION = 'usuarios_secciones_admin_check';

// Un ADD "desnudo" es el peligroso: se ejecuta sí o sí en cada arranque.
// El de la 092 va dentro de un `IF NOT EXISTS`, así que nunca pisa lo que
// dejó una migración posterior.
function addDesnudo(sql) {
  if (!sql.includes(`ADD CONSTRAINT ${RESTRICCION}`)) return false;
  return !/IF NOT EXISTS\s*\(\s*SELECT 1 FROM pg_constraint/i.test(sql);
}

const conAdd = ARCHIVOS.filter((f) => addDesnudo(readFileSync(DIR + f, 'utf8')));

// La última que lo impone es la que manda: es la que corre al final en una
// base nueva, y la única que se ejecuta si alguien agrega una más adelante.
const MANDA = conAdd[conAdd.length - 1];

test('al menos una migración declara el vocabulario', () => {
  assert.ok(MANDA, 'ninguna migración impone usuarios_secciones_admin_check');
});

test('la que manda es la más nueva de las que tocan la restricción', () => {
  // Si alguien agrega el CHECK en una migración intermedia, en base nueva
  // la posterior lo pisa y el vocabulario intermedio nunca rige. No rompe
  // nada, pero engaña a quien lo lea.
  const mencionan = ARCHIVOS.filter((f) => readFileSync(DIR + f, 'utf8').includes(RESTRICCION));
  assert.equal(MANDA, mencionan[mencionan.length - 1],
    `${MANDA} impone el CHECK pero ${mencionan[mencionan.length - 1]} es posterior`);
});

test('el vocabulario del CHECK es exactamente el de seccionesAdmin.js', () => {
  // El tercer espejo. Los otros dos —constants/seccionesAdmin.js y
  // frontend/src/admin/secciones.js— ya se comparan en auth.test.js y en
  // el contador de 26; este cierra el que vive en la base.
  const sql = readFileSync(DIR + MANDA, 'utf8');
  const bloque = sql.slice(sql.indexOf(`ADD CONSTRAINT ${RESTRICCION}`));
  const enSql = [...bloque.slice(0, bloque.indexOf(']::text[]')).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

  assert.deepEqual([...enSql].sort(), [...SECCIONES_ADMIN].sort(),
    'el CHECK de la base y SECCIONES_ADMIN no dicen lo mismo');
});
