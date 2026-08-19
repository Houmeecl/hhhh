import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Ningún test escribe en la base de PRODUCCIÓN.
//
// EL PROBLEMA QUE ESTE CASO IMPIDE QUE VUELVA: `deploy/actualizar.sh`
// corre `npm test` en el VPS ANTES de reiniciar —es el CI propio del
// proyecto, y es una buena idea— pero lo hace con `backend/.env`
// apuntando a la BASE REAL. La protección existe desde siempre
// (`test/util/soloDev.js`) y 39 archivos la usan; dos no la usaban, y
// esos dos venían escribiendo en producción en CADA DESPLIEGUE:
//
//   · ajustesClasificacion.test.js — creaba una cuenta de operador y
//     asientos en `ajustes_clasificacion` que su propio `after` declara
//     que NO se borran (son append-only: borrar un eslabón parte la
//     cadena). O sea, basura permanente acumulándose deploy tras deploy.
//   · migracion078.test.js — insertaba una sesión «Prueba 078» con sus
//     facturas, y las facturas están encadenadas por hash.
//
// Nadie lo notó porque los tests PASABAN. Un CI verde que ensucia la
// base de producción es peor que no tener CI: da confianza y cobra en
// otro lado.
//
// Este test lee los archivos, no los ejecuta. Es tosco a propósito: la
// alternativa —un mock del pool que falle si alguien escribe— habría
// que mantenerla, y esto solo tiene que responder una pregunta simple.
// ============================================================

const DIR = path.join(import.meta.dirname);

// Escrituras REALES: dentro de una plantilla pasada a query()/withTx().
// No cuenta un INSERT que aparezca dentro de una aserción SOBRE el texto
// de un servicio (retencion.test.js y fuenteScope3.test.js hacen eso, y
// son perfectamente inocentes).
const ESCRITURA = /(?:query|client\.query)\(\s*`[^`]*(?:INSERT\s+INTO|DELETE\s+FROM|UPDATE\s+[a-z_]+\s+SET)/i;

test('todo test que escribe en la base tiene la guarda de producción', () => {
  const culpables = [];
  for (const archivo of fs.readdirSync(DIR).filter((f) => f.endsWith('.test.js'))) {
    const fuente = fs.readFileSync(path.join(DIR, archivo), 'utf8');
    if (!ESCRITURA.test(fuente)) continue;
    if (!/soloDev\.js/.test(fuente)) culpables.push(archivo);
  }
  assert.deepEqual(culpables, [],
    'Estos tests escriben en la base y NO importan test/util/soloDev.js. En el VPS eso significa '
    + 'escribir en PRODUCCIÓN durante el deploy. Agrega `{ skip: SALTO_PROD }` a los casos que '
    + 'tocan la base y envuelve before/after con `if (!EN_PRODUCCION)`.');
});

test('el que importa la guarda, la usa de verdad', () => {
  // Importar `soloDev` y después no poner ningún `skip` sería peor que no
  // importarlo: parece protegido y no lo está.
  const tibios = [];
  for (const archivo of fs.readdirSync(DIR).filter((f) => f.endsWith('.test.js'))) {
    const fuente = fs.readFileSync(path.join(DIR, archivo), 'utf8');
    if (!/soloDev\.js/.test(fuente)) continue;
    if (!ESCRITURA.test(fuente)) continue;
    // Se aceptan las formas que el proyecto ya usa, no una sola:
    //   { skip: SALTO_PROD }                      (duplicados, expediente…)
    //   { skip: EN_PRODUCCION && SALTO_PROD }     (analisisSiiProveedor, exportAlcance3Mandante)
    //   if (EN_PRODUCCION) return;  /  if (!EN_PRODUCCION) …   en before/after
    // Exigir una sola forma habría marcado como culpables a dos archivos
    // que están perfectamente protegidos.
    const usa = /skip:\s*(?:EN_PRODUCCION\s*&&\s*)?SALTO_PROD/.test(fuente)
      || /if\s*\(\s*!?EN_PRODUCCION\s*\)/.test(fuente);
    if (!usa) tibios.push(archivo);
  }
  assert.deepEqual(tibios, [],
    'Importan soloDev.js pero no lo aplican en ningún caso: la protección es decorativa.');
});
