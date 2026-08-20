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

test('la portada de lanzamiento no promete nada que no se pueda demostrar', () => {
  const src = fs.readFileSync(new URL('../../frontend/src/pages/Lanzamiento.jsx', import.meta.url), 'utf8');
  const visible = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // Vocabulario prohibido de cara al cliente (.claude/agents/diseno.md).
  for (const palabra of [/huella/i, /calculadora/i]) {
    assert.ok(!palabra.test(visible), `la portada usa vocabulario prohibido: ${palabra}`);
  }
});
