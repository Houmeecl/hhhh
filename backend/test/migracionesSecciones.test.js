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
// La regla ahora: solo la migración MÁS NUEVA que amplía el vocabulario lo
// declara. Las anteriores no lo re-afirman —o lo hacen guardadas por «si
// no existe», que nunca pisa a la nueva.
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

test('solo UNA migración impone el vocabulario sin guardia', () => {
  // Si esto falla con dos archivos, el más viejo va a rechazar en cada
  // arranque las secciones que el más nuevo agregó. No es un problema de
  // estilo: es el servidor sin levantar.
  assert.equal(conAdd.length, 1,
    `imponen el CHECK sin guardia: ${conAdd.join(', ')} — debe ser solo la más nueva`);
});

test('esa migración es la más nueva que menciona la restricción', () => {
  const mencionan = ARCHIVOS.filter((f) => readFileSync(DIR + f, 'utf8').includes(RESTRICCION));
  assert.equal(conAdd[0], mencionan[mencionan.length - 1],
    `${conAdd[0]} impone el CHECK pero ${mencionan[mencionan.length - 1]} es posterior`);
});

test('el vocabulario del CHECK es exactamente el de seccionesAdmin.js', () => {
  // El tercer espejo. Los otros dos —constants/seccionesAdmin.js y
  // frontend/src/admin/secciones.js— ya se comparan en auth.test.js y en
  // el contador de 26; este cierra el que vive en la base.
  const sql = readFileSync(DIR + conAdd[0], 'utf8');
  const bloque = sql.slice(sql.indexOf(`ADD CONSTRAINT ${RESTRICCION}`));
  const enSql = [...bloque.slice(0, bloque.indexOf(']::text[]')).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

  assert.deepEqual([...enSql].sort(), [...SECCIONES_ADMIN].sort(),
    'el CHECK de la base y SECCIONES_ADMIN no dicen lo mismo');
});
