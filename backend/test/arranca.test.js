import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// ¿ARRANCA EL SERVIDOR?
//
// POR QUÉ EXISTE ESTE ARCHIVO. La suite llegó a pasar con 1.124 casos
// verdes mientras `node src/index.js` moría en el arranque con un
// SyntaxError. La causa fue una comilla invertida dentro de un
// comentario SQL —que en JavaScript cierra el template literal— en
// routes/cobros.js. Ningún test lo detectó porque los tests importan
// SERVICIOS, y ese archivo es un ROUTER: nadie lo cargaba.
//
// El agujero no era ese archivo, era la forma de la suite: los routers
// solo se importan desde index.js, y nada importaba index.js. Un error
// de sintaxis o un import roto en cualquier router pasaba la suite
// entera y recién aparecía al levantar el proceso.
//
// Estos dos casos cierran el agujero por los dos lados: uno mira TODO
// el árbol de fuentes sin ejecutar nada, el otro carga de verdad cada
// router para atrapar además los imports rotos y las exportaciones que
// no existen.
// ============================================================

const AQUI = dirname(fileURLToPath(import.meta.url));
const SRC = join(AQUI, '..', 'src');

function archivosJs(dir) {
  const salida = [];
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) salida.push(...archivosJs(ruta));
    else if (entrada.endsWith('.js')) salida.push(ruta);
  }
  return salida;
}

test('todo el código fuente parsea — ningún archivo rompe el arranque', () => {
  // `node --check` NO ejecuta el módulo: no abre conexiones, no arma
  // temporizadores, no toca la red. Solo responde si el archivo es
  // JavaScript válido. Por eso puede pasar sobre el árbol completo sin
  // efectos y sin importar el orden.
  const rotos = [];
  for (const archivo of archivosJs(SRC)) {
    try {
      execFileSync(process.execPath, ['--check', archivo], { stdio: 'pipe' });
    } catch (e) {
      const detalle = String(e.stderr || e.message).split('\n').slice(0, 4).join(' ').trim();
      rotos.push(`${relative(SRC, archivo)} → ${detalle}`);
    }
  }
  assert.deepEqual(rotos, [], `Archivos que no parsean:\n${rotos.join('\n')}`);
});

test('todos los routers se pueden importar de verdad', async () => {
  // El paso anterior atrapa la sintaxis; este atrapa lo que la sintaxis
  // no ve: un import a un archivo que no existe, una exportación con
  // nombre cambiado, una dependencia circular que deja un binding sin
  // inicializar. Son las tres formas restantes de que index.js muera en
  // el arranque con la suite en verde.
  //
  // Importar un router arrastra lib/db.js, que crea el pool; NO se abre
  // ninguna conexión hasta la primera consulta, y acá no se hace
  // ninguna. Por eso este archivo no necesita `pool.end()` ni saltarse
  // en producción: no toca la base.
  const routers = readdirSync(join(SRC, 'routes')).filter((f) => f.endsWith('.js')).sort();
  assert.ok(routers.length > 15, `esperaba más de 15 routers, encontré ${routers.length}`);

  const fallidos = [];
  for (const archivo of routers) {
    try {
      const mod = await import(`../src/routes/${archivo}`);
      // Un router tiene que exportar ALGO montable. `cobros.js` y
      // `pos.js` no exportan default sino routers con nombre, así que
      // se acepta cualquiera de las dos formas.
      assert.ok(Object.keys(mod).length > 0, 'no exporta nada');
    } catch (e) {
      fallidos.push(`routes/${archivo} → ${e.message}`);
    }
  }
  assert.deepEqual(fallidos, [], `Routers que no cargan:\n${fallidos.join('\n')}`);
});
