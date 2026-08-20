import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Ninguna ruta del Corredor puede quedar TAPADA por una de sicr3p.
//
// EL BUG QUE ESTE ARCHIVO IMPIDE QUE VUELVA. `routes/public.js` publica
// `GET /api/corredor/puntos` —el catálogo del mapa de la torre, que sale
// de la base de SICR3P— y está montado en index.js ANTES que
// `routes/corredorApi.js`. Cuando el panel del Corredor agregó su propio
// `GET /puntos`, Express nunca llegó a él: se quedaba con el público.
//
// No era un 404 ni un error visible. Era peor: el selector de tramo
// mostraba los puntos de la OTRA base, con todas sus credenciales de
// verse bien, mientras `PUT /cargas/:id/tramo` los valida contra la base
// del Corredor. Un punto que existe allá y no acá se ofrecía y después se
// rechazaba, y el aislamiento entre los dos mundos —que es lo único que
// sostiene el diseño— quedaba roto justo donde nadie lo miraba.
//
// Se leen los archivos, no se ejecutan: mismo criterio que
// test/deployScript.test.js con los scripts de despliegue.
// ============================================================

const raiz = path.join(import.meta.dirname, '..');
const leer = (p) => fs.readFileSync(path.join(raiz, p), 'utf8');

const METODOS = 'get|post|put|patch|delete';

// Las rutas que declara un archivo de router, tal cual las escribe.
function rutasDe(archivo) {
  const re = new RegExp(`router\\.(${METODOS})\\(\\s*['\`]([^'\`]+)['\`]`, 'g');
  return [...leer(archivo).matchAll(re)].map((m) => ({ metodo: m[1], ruta: m[2] }));
}

// Todo lo que `public.js` cuelga bajo /corredor — es el único router
// montado en '/api' que invade el prefijo del Corredor.
const publicasDelCorredor = () => rutasDe('src/routes/public.js')
  .filter((r) => r.ruta === '/corredor' || r.ruta.startsWith('/corredor/'))
  .map((r) => ({ ...r, ruta: r.ruta.replace(/^\/corredor/, '') || '/' }));

test('public.js se monta antes que corredorApi.js: el orden importa', () => {
  const index = leer('src/index.js');
  const iPublic = index.indexOf("app.use('/api', apiLimiter, publicRoutes)");
  const iCorredor = index.indexOf("app.use('/api/corredor', apiLimiter, corredorApiRoutes)");
  assert.ok(iPublic > 0 && iCorredor > 0, 'cambiaron los montajes en index.js');
  assert.ok(
    iPublic < iCorredor,
    'public.js va primero, así que sus rutas ganan: por eso hace falta el caso de abajo'
  );
});

test('ninguna ruta de corredorApi.js queda tapada por una pública', () => {
  const publicas = publicasDelCorredor();
  assert.ok(publicas.length > 0, 'si public.js ya no publica nada bajo /corredor, este archivo sobra');

  const propias = rutasDe('src/routes/corredorApi.js');
  assert.ok(propias.length > 10, `se leyeron ${propias.length} rutas, parece que cambió el formato`);

  for (const p of propias) {
    const choque = publicas.find((q) => q.ruta === p.ruta && q.metodo === p.metodo);
    assert.ok(
      !choque,
      `${p.metodo.toUpperCase()} /api/corredor${p.ruta} lo atiende public.js, no el Corredor. `
      + 'Cámbiale el path (ej. /catalogo/puntos) o mueve el montaje.'
    );
  }
});

test('el catálogo de puntos del Corredor no usa el path del público', () => {
  const propias = rutasDe('src/routes/corredorApi.js');
  assert.ok(
    propias.some((r) => r.metodo === 'get' && r.ruta === '/catalogo/puntos'),
    'el catálogo propio del Corredor vive en /catalogo/puntos'
  );
  assert.ok(
    !propias.some((r) => r.ruta === '/puntos'),
    '/puntos es del catálogo público de la torre, que sale de la otra base'
  );
});

test('el frontend del Corredor pide el catálogo propio', () => {
  const api = leer('../frontend/src/panel-corredor/api.js');
  assert.match(api, /pedir\('\/catalogo\/puntos'\)/);
});

test('la sonda del script de despliegue apunta a una ruta que sí es del Corredor', () => {
  // Si apuntara a /api/corredor/puntos, el público respondería 200 aunque
  // el Corredor estuviera apagado, y encender-corredor.sh diría que todo
  // salió bien sin haber comprobado nada.
  const script = leer('../deploy/encender-corredor.sh');
  assert.match(script, /SONDA_URL=.*\/api\/corredor\/catalogo\/puntos/);
});
