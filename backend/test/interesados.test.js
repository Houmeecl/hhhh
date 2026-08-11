import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  validarInteresado, esBot, correoEstimacion, alertaLeadEmail, escaparHtml, ORIGENES,
} from '../src/services/interesados.js';
import { acuseInscripcionEmail } from '../src/services/inscripcion.js';
import { query, pool } from '../src/lib/db.js';
import { runMigrations } from '../src/lib/migrate.js';
import { SALTO_PROD } from './util/soloDev.js';

// ============================================================
// Validación pura de los leads livianos del sitio (migración 091).
// ============================================================

const BASE = { origen: 'corredor', email: 'lead@empresa-prueba.cl' };

test('validarInteresado: caso feliz normaliza el email a minúsculas', () => {
  const r = validarInteresado({ ...BASE, email: '  LEAD@Empresa-Prueba.CL ', nombre: ' Ana ' });
  assert.equal(r.ok, true);
  assert.equal(r.datos.email, 'lead@empresa-prueba.cl');
  assert.equal(r.datos.nombre, 'Ana');
  assert.equal(r.datos.origen, 'corredor');
});

test('validarInteresado: email malo o ausente rechaza — es el único obligatorio', () => {
  assert.equal(validarInteresado({ origen: 'corredor' }).ok, false);
  assert.equal(validarInteresado({ origen: 'corredor', email: 'no-es-correo' }).ok, false);
  assert.equal(validarInteresado({ origen: 'corredor', email: 'a@b' }).ok, false);
});

test('validarInteresado: origen fuera del catálogo cae a "otro" (no rechaza — el lead vale igual)', () => {
  const r = validarInteresado({ ...BASE, origen: 'inventado' });
  assert.equal(r.ok, true);
  assert.equal(r.datos.origen, 'otro');
  for (const o of ORIGENES) assert.equal(validarInteresado({ ...BASE, origen: o }).datos.origen, o);
});

test('validarInteresado: recorta largos máximos', () => {
  const r = validarInteresado({ ...BASE, nombre: 'n'.repeat(300), mensaje: 'm'.repeat(5000) });
  assert.equal(r.datos.nombre.length, 150);
  assert.equal(r.datos.mensaje.length, 2000);
});

test('validarInteresado: estimación solo con origen calculadora, re-armada con claves conocidas', () => {
  const est = { total_t: '1.5', compensacion_clp: 12000, usd: 13, entradas: { electricidad: 2500 }, malicioso: '<x>' };
  const conCalc = validarInteresado({ ...BASE, origen: 'calculadora', estimacion: est });
  assert.equal(conCalc.datos.estimacion.total_t, 1.5);
  assert.equal(conCalc.datos.estimacion.compensacion_clp, 12000);
  assert.equal(conCalc.datos.estimacion.malicioso, undefined); // clave desconocida descartada
  // Con otro origen la estimación se ignora completa.
  const sinCalc = validarInteresado({ ...BASE, origen: 'corredor', estimacion: est });
  assert.equal(sinCalc.datos.estimacion, null);
  // Sin total no hay estimación que valga.
  const sinTotal = validarInteresado({ ...BASE, origen: 'calculadora', estimacion: { compensacion_clp: 100 } });
  assert.equal(sinTotal.datos.estimacion, null);
});

test('esBot: el honeypot sitio_web lleno delata al bot; vacío o ausente no', () => {
  assert.equal(esBot({ sitio_web: 'http://spam.example' }), true);
  assert.equal(esBot({ sitio_web: '' }), false);
  assert.equal(esBot({}), false);
  assert.equal(esBot(undefined), false);
});

// ---------- correos (puros, sin red) ----------

test('correoEstimacion: incluye el total es-CL y nunca la palabra prohibida', () => {
  const { subject, html } = correoEstimacion({ nombre: 'Ana', estimacion: { total_t: 1.5, compensacion_clp: 12000 } });
  assert.match(html, /1,50 t CO2e/);
  assert.match(html, /12\.000/);
  assert.doesNotMatch(`${subject} ${html}`, /huella/i);
  assert.match(html, /referencial/);
});

test('correoEstimacion: escapa HTML del nombre (no puede inyectar etiquetas)', () => {
  const { html } = correoEstimacion({ nombre: '<script>x</script>', estimacion: { total_t: 1 } });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('alertaLeadEmail: arma el asunto con origen y empresa, escapa el mensaje', () => {
  const { subject, html } = alertaLeadEmail({
    tipo: 'interesado',
    datos: { origen: 'corredor', empresa: 'ACME', email: 'x@y.cl', mensaje: '<img src=x>' },
  });
  assert.match(subject, /Nuevo lead/);
  assert.match(subject, /ACME/);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(`${subject} ${html}`, /huella/i);
});

test('acuseInscripcionEmail: incluye empresa e intereses legibles, sin la palabra prohibida', () => {
  const { subject, html } = acuseInscripcionEmail({
    nombre_empresa: 'Fábrica X', contacto_nombre: 'Ana', intereses: ['carbono', 'rep'],
  });
  assert.match(html, /Fábrica X/);
  assert.match(html, /Contabilidad de carbono/);
  assert.match(html, /Ley REP/);
  assert.doesNotMatch(`${subject} ${html}`, /huella/i);
});

test('escaparHtml: cubre las cinco entidades', () => {
  assert.equal(escaparHtml(`<a href="x" title='y'>&`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;');
});

// ---------- integración: dedupe por (email, origen) ----------

test('migración 091: ON CONFLICT actualiza la fila nueva en vez de duplicar', { skip: SALTO_PROD }, async () => {
  await runMigrations();
  const email = `test-interesado-${Date.now()}@prueba.cl`;
  const insertar = (estimacion) => query(
    `INSERT INTO interesados (origen, email, estimacion)
     VALUES ('calculadora', $1, $2::jsonb)
     ON CONFLICT (lower(email), origen) WHERE estado = 'nuevo'
     DO UPDATE SET estimacion = COALESCE(EXCLUDED.estimacion, interesados.estimacion), created_at = now()
     RETURNING id, estimacion, (xmax = 0) AS nuevo`,
    [email, JSON.stringify(estimacion)]
  );
  const r1 = await insertar({ total_t: 1 });
  assert.equal(r1.rows[0].nuevo, true);
  const r2 = await insertar({ total_t: 2 });
  assert.equal(r2.rows[0].nuevo, false);           // fue UPDATE, no INSERT
  assert.equal(r2.rows[0].id, r1.rows[0].id);      // misma fila
  assert.equal(r2.rows[0].estimacion.total_t, 2);  // estimación actualizada

  const { rows: n } = await query(`SELECT count(*)::int AS n FROM interesados WHERE email = $1`, [email]);
  assert.equal(n[0].n, 1);

  // CHECKs de la tabla.
  await assert.rejects(query(`INSERT INTO interesados (origen, email) VALUES ('inventado', 'x@y.cl')`));
  await assert.rejects(query(`UPDATE interesados SET estado = 'inventado' WHERE email = $1`, [email]));

  await query(`DELETE FROM interesados WHERE email = $1`, [email]);
});

after(async () => { await pool.end().catch(() => {}); });
