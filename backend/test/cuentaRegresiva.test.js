import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  LANZAMIENTO, msHasta, yaLanzo, desglose, dosDigitos, fechaLegible, horaLegible,
} from '../../frontend/src/lib/cuentaRegresiva.js';

// ============================================================
// La cuenta regresiva de la portada.
//
// A las 16:00 de Chile la portada de sicr3p.cl deja de ser la cuenta
// regresiva y pasa a ser la landing, sin que nadie despliegue nada. Toda
// esa decisión es una comparación de fechas. Si se equivoca, el sitio se
// destapa antes de tiempo o se queda tapado después — y en los dos casos
// se descubre en público.
//
// El módulo vive en el frontend pero se prueba desde acá porque es JS puro
// (sin JSX, sin React) y esta es la suite que corre el VPS antes de
// reiniciar. Misma convención que documentosPorFronteraLanding.test.js.
// ============================================================

const EN = (iso) => new Date(iso).getTime();

test('la hora del lanzamiento lleva su huso escrito, no UTC', () => {
  // En agosto Chile está en UTC-4; en septiembre pasa a UTC-3. Guardar la
  // hora con offset explícito la deja correcta aunque la fecha se corra al
  // otro lado del cambio. Guardar "20:00Z" habría funcionado hoy y mentido
  // en octubre.
  assert.match(LANZAMIENTO, /[+-]\d{2}:\d{2}$/, 'el ISO perdió su offset');
  assert.equal(new Date(LANZAMIENTO).toISOString(), '2026-08-21T20:00:00.000Z');
});

test('antes de la hora la cuenta regresiva sigue puesta', () => {
  assert.equal(yaLanzo(EN('2026-08-21T15:59:59-04:00')), false);
  assert.equal(yaLanzo(EN('2026-08-20T16:00:00-04:00')), false);
});

test('a la hora en punto ya lanzamos: no queda un último segundo', () => {
  assert.equal(yaLanzo(EN('2026-08-21T16:00:00-04:00')), true);
  assert.equal(yaLanzo(EN('2026-08-21T16:00:01-04:00')), true);
});

test('un reloj en otro huso llega al mismo veredicto', () => {
  // 16:00 en Chile son las 20:00 UTC y las 21:00 en Madrid ese día. Los
  // tres son el mismo instante: la portada cambia a la vez en todas partes.
  assert.equal(yaLanzo(EN('2026-08-21T20:00:00Z')), true);
  assert.equal(yaLanzo(EN('2026-08-21T19:59:59Z')), false);
});

test('una fecha ilegible deja la cuenta regresiva puesta, no destapa el sitio', () => {
  // La respuesta conservadora ante un error es "todavía no". Al revés, un
  // ISO mal escrito publicaría la landing antes de tiempo.
  assert.equal(yaLanzo(EN('2026-08-21T16:00:00-04:00'), 'no-es-una-fecha'), false);
  assert.equal(yaLanzo(NaN), false);
  assert.equal(yaLanzo(undefined), false);
});

test('desglose reparte bien días, horas, minutos y segundos', () => {
  const ms = msHasta(EN('2026-08-19T13:30:30-04:00'));
  assert.deepEqual(desglose(ms), { dias: 2, horas: 2, minutos: 29, segundos: 30 });
});

test('pasada la hora el reloj marca cero, nunca negativo', () => {
  const ms = msHasta(EN('2026-08-22T10:00:00-04:00'));
  assert.ok(ms < 0, 'el caso de prueba debería estar en el pasado');
  assert.deepEqual(desglose(ms), { dias: 0, horas: 0, minutos: 0, segundos: 0 });
  assert.deepEqual(desglose(NaN), { dias: 0, horas: 0, minutos: 0, segundos: 0 });
});

test('dosDigitos rellena y nunca muestra un signo menos', () => {
  assert.equal(dosDigitos(0), '00');
  assert.equal(dosDigitos(7), '07');
  assert.equal(dosDigitos(42), '42');
  assert.equal(dosDigitos(-3), '00');
});

test('la fecha se escribe en español de Chile y en hora de Santiago', () => {
  assert.match(fechaLegible(), /21/);
  assert.match(fechaLegible(), /agosto/i);
  // La hora es SIEMPRE la de Santiago, no la del visitante: si se
  // formateara en local, alguien en Madrid leería "22:00" y llegaría tarde.
  assert.equal(horaLegible(), '16:00');
});

// ---------- La portada ----------

test('la portada solo se tapa en el dominio principal, no en los subdominios', () => {
  // El Instituto y el Corredor son otros productos, con su propio
  // calendario: taparlos con esta cuenta regresiva sería un daño colateral.
  const app = fs.readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
  const ruta = app.split('\n').find((l) => l.includes('<Route path="/"'));
  assert.ok(ruta, 'no se encontró la ruta raíz');
  const inst = ruta.indexOf('ES_SUBDOMINIO_INSTITUTO');
  const corr = ruta.indexOf('ES_SUBDOMINIO_CORREDOR');
  const cuenta = ruta.indexOf('EN_CUENTA_REGRESIVA');
  assert.ok(inst !== -1 && corr !== -1, 'se perdió alguna rama de subdominio');
  assert.ok(cuenta !== -1, 'la portada dejó de mirar la cuenta regresiva');
  assert.ok(
    cuenta > inst && cuenta > corr,
    'la cuenta regresiva quedó ANTES que los subdominios: taparía al Instituto y al Corredor'
  );
});

test('hay una escotilla para ver la landing antes de la hora', () => {
  // Sin esto, revisar la portada real el día previo obliga a bajar la
  // cuenta regresiva y volver a subirla.
  const app = fs.readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /ver.*===\s*'landing'/, 'desapareció ?ver=landing');
});

test('la portada de lanzamiento NO ofrece ingresar', () => {
  // Hasta el lanzamiento la única acción es dejar el correo. Un enlace a
  // /ingresar invita a probar puertas que todavía no queremos que se
  // toquen, y además contradice el mensaje: si ya se puede entrar, la
  // cuenta regresiva no cuenta nada.
  const src = fs.readFileSync(new URL('../../frontend/src/pages/Lanzamiento.jsx', import.meta.url), 'utf8');
  const visible = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/\/ingresar/.test(visible), 'volvió un enlace a /ingresar');
  assert.ok(!/Ingresar/.test(visible), 'volvió un botón de Ingresar');
  assert.ok(/LeadCta/.test(visible), 'desapareció el formulario de lista de espera');
  assert.ok(/origen="lanzamiento"/.test(visible), 'el lead perdió su origen y caería en "otro"');
});

test('"lanzamiento" es un origen de lead reconocido, no cae en "otro"', async () => {
  const { ORIGENES, ORIGEN_LABEL } = await import('../src/services/interesados.js');
  assert.ok(ORIGENES.includes('lanzamiento'));
  assert.ok(ORIGEN_LABEL.lanzamiento, 'sin etiqueta, el panel y el correo lo muestran feo');
});

test('el CHECK de la base conoce los mismos orígenes que el código', async () => {
  // ESTE TEST NACE DE UN 500 REAL. El catálogo ORIGENES aceptaba
  // 'lanzamiento' y la tabla, no: cada inscripción de la lista de espera
  // respondía "Error interno del servidor". Los tests en JS pasaban porque
  // miraban solo el catálogo; el error únicamente aparecía contra la base.
  //
  // Se comparan los dos textos, no se consulta Postgres: así el test corre
  // igual en producción, donde no se toca la base real.
  const { ORIGENES } = await import('../src/services/interesados.js');
  const sql = fs.readFileSync(new URL('../migrations/107_lead_lanzamiento.sql', import.meta.url), 'utf8');
  const bloque = sql.slice(sql.lastIndexOf('CHECK (origen IN ('));
  const enSql = [...bloque.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(
    [...ORIGENES].sort(),
    [...enSql].sort(),
    'el catálogo de services/interesados.js y el CHECK de la migración 107 se separaron'
  );
});

// La landing no puede prometer lo que el producto no hace. El README del
// panel de aseguramiento (repo Houmeecl/asg) nombra estrés hídrico bajo
// TNFD, detección de greenwashing e integración con SICEP y The Copper
// Mark; ninguna de las tres tiene tabla, endpoint ni servicio que la
// respalde. Verificado el 20-08-2026 contra server/db.js y server/index.js:
// hay 5 tablas y 6 endpoints, y ninguno cubre eso.
//
// Anunciarlo en la portada sería el mismo verde falso que este producto
// existe para no emitir, apuntando al cliente en vez de al auditor. Este
// test lo impide.
test('la portada no promete lo que el producto todavía no hace', () => {
  const src = fs.readFileSync(new URL('../../frontend/src/pages/Lanzamiento.jsx', import.meta.url), 'utf8');
  // Sin comentarios: el bloque que EXPLICA la exclusión nombra estas cosas
  // a propósito, y leerlo como si fuera copy haría fallar el test por su
  // propia advertencia.
  const copy = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const promesa of ['TNFD', 'greenwash', 'Copper Mark', 'SICEP', 'NIIF']) {
    assert.ok(
      !new RegExp(promesa, 'i').test(copy),
      `la portada anuncia "${promesa}" y no hay código que lo respalde`
    );
  }
  // Y no se declara auditor acreditado ni se promete opinión de auditoría.
  assert.ok(/no es autoridad/i.test(copy), 'desapareció la aclaración de que sicr3p no es autoridad');
});

test('el título del navegador y la vista previa al compartir no dicen "carbono"', () => {
  // Decisión de marca del 20-08-2026: el eje del sitio es el pasaporte
  // documental del Corredor, no la contabilidad de carbono. El <title> de
  // index.html es lo que se ve en la pestaña ANTES de que monte React, y
  // og:title es lo que aparece al pegar el enlace en WhatsApp o LinkedIn:
  // si se quedaban con el texto viejo, el titular del sitio decía una cosa
  // y la pestaña otra.
  const html = fs.readFileSync(new URL('../../frontend/index.html', import.meta.url), 'utf8');
  const titulo = html.match(/<title>([^<]*)<\/title>/)?.[1] || '';
  assert.ok(titulo, 'index.html se quedó sin <title>');
  assert.ok(!/carbono/i.test(titulo), `el <title> volvió a decir carbono: "${titulo}"`);
  for (const prop of ['og:title', 'og:description', 'twitter:title', 'twitter:description', 'description']) {
    const m = html.match(new RegExp(`(?:property|name)="${prop}" content="([^"]*)"`));
    if (m) assert.ok(!/carbono/i.test(m[1]), `${prop} volvió a decir carbono`);
  }
});

test('la portada no llama blockchain a lo que no lo es', () => {
  // La propia página /cadena del producto dice "no es una red blockchain
  // pública". Ponerlo en la portada sería contradecir al producto en su
  // propia web, y prometer garantías de una red distribuida que acá no hay.
  const src = fs.readFileSync(new URL('../../frontend/src/pages/Lanzamiento.jsx', import.meta.url), 'utf8');
  const visible = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/blockchain/i.test(visible), 'la portada dice blockchain');
  assert.ok(!/inalterable/i.test(visible), 'la cadena DETECTA el cambio; no lo impide');
});

test('la portada de lanzamiento no promete nada que no se pueda demostrar', () => {
  const src = fs.readFileSync(new URL('../../frontend/src/pages/Lanzamiento.jsx', import.meta.url), 'utf8');
  const visible = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // Vocabulario prohibido de cara al cliente (.claude/agents/diseno.md).
  for (const palabra of [/huella/i, /calculadora/i]) {
    assert.ok(!palabra.test(visible), `la portada usa vocabulario prohibido: ${palabra}`);
  }
});
