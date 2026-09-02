import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// ============================================================
// El migrador lleva registro, y por eso el §3 del foco es cierto.
//
// `docs/FOCO-2026-2027.md` §3 pide: «No borrar ni reescribir migraciones
// históricas que hayan podido ejecutarse. Si una estructura deja de usarse,
// hacer una migración nueva.»
//
// Esa regla **solo se sostiene con un migrador que lleve registro**. Sin
// él, una migración vieja se ejecuta en cada arranque para siempre y no
// hay migración nueva que la pueda corregir — que es exactamente cómo
// marcar la casilla «Cobros» en el panel dejaba el servidor sin arrancar.
//
// Este archivo lee el código fuente, no levanta base: corre igual en el
// VPS con NODE_ENV=production.
// ============================================================

const SRC = readFileSync(new URL('../src/lib/migrate.js', import.meta.url), 'utf8');

test('el migrador anota lo aplicado y no lo repite', () => {
  assert.match(SRC, /CREATE TABLE IF NOT EXISTS \$\{TABLA\}/,
    'no crea la tabla de registro');
  assert.match(SRC, /SELECT archivo, sha256 FROM/,
    'no lee lo ya aplicado antes de correr');
  assert.match(SRC, /INSERT INTO \$\{TABLA\}/,
    'no anota lo que aplica');
  // Sin este `continue`, leer el registro no sirve de nada. Se busca el
  // bloque completo en vez de una distancia fija: el comentario que hay
  // en medio explica el porqué y va a seguir creciendo.
  const bloquePrevio = SRC.slice(SRC.indexOf('if (previo) {'), SRC.indexOf('await cliente.query(\'BEGIN\')'));
  assert.match(bloquePrevio, /continue;/,
    'lee el registro pero igual re-ejecuta');
});

test('cada migración va en su propia transacción con su registro', () => {
  // Anotar fuera de la transacción dejaría migraciones «aplicadas» que en
  // realidad reventaron a la mitad, y esas son las que no se reintentan
  // nunca más.
  const bloque = SRC.slice(SRC.indexOf("await cliente.query('BEGIN')"));
  const hastaCommit = bloque.slice(0, bloque.indexOf("COMMIT"));
  assert.match(hastaCommit, /INSERT INTO \$\{TABLA\}/,
    'el registro se anota fuera de la transacción del SQL');
  assert.match(SRC, /ROLLBACK/, 'no revierte si la migración falla');
});

test('reescribir una migración aplicada se AVISA, no se ignora', () => {
  // El sha256 es lo que convierte al registro en un guardián del §3: no
  // solo evita re-ejecutar, delata que alguien reescribió historia.
  assert.match(SRC, /sha256/, 'no guarda el hash de lo aplicado');
  assert.match(SRC, /previo !== hash/, 'no compara el hash guardado con el del archivo');
  assert.match(SRC, /AVISO/, 'detecta el cambio y se lo calla');
  assert.match(SRC, /FOCO-2026-2027\.md §3/,
    'el aviso no dice dónde está la regla que se está rompiendo');
});

test('el comentario del migrador ya no promete lo contrario', () => {
  // El encabezado viejo decía «No hay registro de migraciones aplicadas:
  // cada archivo corre en CADA arranque». Si eso sobrevive, el próximo que
  // lea el archivo va a escribir migraciones bajo una premisa falsa.
  assert.ok(!/No hay registro de migraciones aplicadas/.test(SRC),
    'quedó el comentario que dice que no hay registro');
});

test('las migraciones siguen numeradas y ordenadas', () => {
  // El orden alfabético ES el orden de ejecución. Un archivo sin prefijo
  // numérico se cuela en cualquier lado.
  const dir = new URL('../migrations/', import.meta.url).pathname;
  const sueltos = readdirSync(dir).filter((f) => f.endsWith('.sql') && !/^\d{3}_/.test(f));
  assert.deepEqual(sueltos, [], `migraciones sin prefijo NNN_: ${sueltos.join(', ')}`);
});
