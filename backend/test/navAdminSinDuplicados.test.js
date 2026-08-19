import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// El NAV del panel admin sale de frontend/src/admin/secciones.js. Dos
// slugs distintos pueden apuntar a la MISMA pantalla ('accesos_externos'
// y su alias angosto 'proveedores', migración 097). Cuando una cuenta
// tiene los dos, el menú mostraba la pantalla dos veces —con dos nombres
// distintos y el mismo destino— y React además reclamaba por la key
// duplicada, porque la key era la ruta.
//
// Este archivo no se puede importar desde el backend: secciones.js trae
// icons.jsx y Node no parsea JSX. Se revisa el texto, que para una lista
// declarativa alcanza.
// ============================================================

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const leer = (p) => fs.readFileSync(path.join(raiz, p), 'utf8');

const items = () => {
  const src = leer('frontend/src/admin/secciones.js');
  return [...src.matchAll(/\{\s*slug:\s*'([a-z_]+)'[^}]*?to:\s*'([^']+)'[^}]*\}/g)]
    .map((m) => ({ slug: m[1], to: m[2], crudo: m[0] }));
};

test('cada ruta repetida del NAV declara cuál entrada es la redundante', () => {
  const todos = items();
  assert.ok(todos.length > 20, `se leyeron ${todos.length} secciones, parece que el formato cambió`);

  const porRuta = new Map();
  for (const i of todos) porRuta.set(i.to, [...(porRuta.get(i.to) || []), i]);

  for (const [to, comparten] of porRuta) {
    if (comparten.length === 1) continue;
    const marcados = comparten.filter((i) => i.crudo.includes('redundanteCon:'));
    assert.equal(
      marcados.length, comparten.length - 1,
      `${comparten.map((i) => i.slug).join(' y ')} llevan a ${to}: todos menos uno necesitan redundanteCon`
    );
    for (const m of marcados) {
      const apunta = /redundanteCon:\s*'([a-z_]+)'/.exec(m.crudo)?.[1];
      assert.ok(
        comparten.some((i) => i.slug === apunta),
        `${m.slug} dice ser redundante con '${apunta}', que no comparte esta ruta`
      );
    }
  }
});

test('los slugs del NAV son únicos: sirven de key en React', () => {
  const slugs = items().map((i) => i.slug);
  assert.equal(new Set(slugs).size, slugs.length, 'hay un slug repetido en el NAV');
});

test('el NAV usa el slug como key, no la ruta', () => {
  const app = leer('frontend/src/admin/AdminApp.jsx');
  assert.match(app, /<NavLink key=\{n\.slug\}/, 'la ruta se repite entre secciones; el slug no');
  assert.match(app, /itemsVisiblesDe\(sec, user\)/, 'el filtrado del menú tiene que deduplicar');
});
