import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatearPropiedadesNotion, enviarLeadANotion } from '../src/services/notionLeads.js';

// ============================================================
// Réplica de leads a Notion — lo que se testea es el CONTRATO FAIL-SAFE:
// deshabilitada es un no-op sin red, y un fallo de red/API se traga con
// log en vez de lanzar (la captación del lead nunca depende de Notion).
// ============================================================

test('formatearPropiedadesNotion: title siempre presente (empresa > nombre > email)', () => {
  const conEmpresa = formatearPropiedadesNotion({ tipo: 'interesado', datos: { empresa: 'ACME', nombre: 'Ana', email: 'a@b.cl' } });
  assert.equal(conEmpresa.Nombre.title[0].text.content, 'ACME');
  const soloEmail = formatearPropiedadesNotion({ tipo: 'interesado', datos: { email: 'a@b.cl' } });
  assert.equal(soloEmail.Nombre.title[0].text.content, 'a@b.cl');
});

test('formatearPropiedadesNotion: omite propiedades sin dato (no rompe contra esquema parcial)', () => {
  const props = formatearPropiedadesNotion({ tipo: 'interesado', datos: { email: 'a@b.cl', origen: 'corredor' } });
  assert.equal(props.Mensaje, undefined);
  assert.equal(props['Teléfono'], undefined);
  assert.equal(props['Estimación'], undefined);
  assert.equal(props.Origen.select.name, 'Landing Corredor Bioceánico');
});

test('formatearPropiedadesNotion: la estimación va legible, no como JSON crudo', () => {
  const props = formatearPropiedadesNotion({
    tipo: 'interesado',
    datos: { email: 'a@b.cl', origen: 'calculadora', estimacion: { total_t: 1.5, compensacion_clp: 12000 } },
  });
  const texto = props['Estimación'].rich_text[0].text.content;
  assert.match(texto, /1,50 t CO2e/);
  assert.match(texto, /12\.000/);
  assert.doesNotMatch(texto, /[{}"]/);
});

test('formatearPropiedadesNotion: inscripción usa el select "Inscripción"', () => {
  const props = formatearPropiedadesNotion({
    tipo: 'inscripcion',
    datos: { nombre_empresa: 'Fábrica X', contacto_email: 'x@y.cl', contacto_telefono: '+56 9 1111' },
  });
  assert.equal(props.Origen.select.name, 'Inscripción');
  assert.equal(props.Nombre.title[0].text.content, 'Fábrica X');
  assert.equal(props.Email.email, 'x@y.cl');
  assert.equal(props['Teléfono'].rich_text[0].text.content, '+56 9 1111');
});

test('enviarLeadANotion: deshabilitada es no-op sin tocar la red', async () => {
  let llamadas = 0;
  const r = await enviarLeadANotion(
    { tipo: 'interesado', datos: { email: 'a@b.cl' } },
    { cfg: { notion: { enabled: false } }, fetcher: () => { llamadas += 1; throw new Error('no debería llamarse'); } }
  );
  assert.deepEqual(r, { skipped: true });
  assert.equal(llamadas, 0);
});

test('enviarLeadANotion: un fetch que revienta NO lanza — resuelve {ok:false} y loggea', async () => {
  const cfg = { notion: { enabled: true, token: 'x', databaseId: 'y', version: '2022-06-28', timeoutMs: 100 } };
  const r = await enviarLeadANotion(
    { tipo: 'interesado', datos: { email: 'a@b.cl' } },
    { cfg, fetcher: async () => { throw new Error('red caída'); } }
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /red caída/);
});

test('enviarLeadANotion: una respuesta no-ok de la API tampoco lanza', async () => {
  const cfg = { notion: { enabled: true, token: 'x', databaseId: 'y', version: '2022-06-28', timeoutMs: 100 } };
  const r = await enviarLeadANotion(
    { tipo: 'interesado', datos: { email: 'a@b.cl' } },
    { cfg, fetcher: async () => ({ ok: false, status: 400, text: async () => 'esquema no calza' }) }
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /Notion 400/);
});
