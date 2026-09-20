import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalytics, safeProperties, publicPage, EVENTS } from '../src/lib/analyticsCore.mjs';

function fixture(overrides = {}) {
  const calls = [];
  let loads = 0;
  const sdk = {
    init: (...args) => { calls.push(['init', ...args]); return { promise: Promise.resolve() }; },
    track: (...args) => { calls.push(['track', ...args]); return { promise: Promise.resolve({ code: 200 }) }; },
    setOptOut: (value) => calls.push(['optout', value]),
  };
  const analytics = createAnalytics({ apiKey: 'test-key', loadSdk: async () => { loads++; return sdk; }, ...overrides });
  return { analytics, calls, sdk, loads: () => loads };
}

test('no configuration or disabled: no third-party load', async () => {
  for (const options of [{ apiKey: '' }, { enabled: false }, { blocked: () => true }]) {
    const f = fixture(options);
    assert.equal(await f.analytics.track('problema_registrado'), false);
    assert.equal(f.loads(), 0);
  }
});
test('simultaneous events initialize exactly once and retain both events', async () => {
  const f = fixture({ serverZone: 'EU' });
  await Promise.all([f.analytics.track('problema_registrado'), f.analytics.track('analisis_completado')]);
  assert.equal(f.loads(), 1);
  const inits = f.calls.filter(c => c[0] === 'init');
  assert.equal(inits.length, 1);
  assert.equal(inits[0][3].autocapture, false);
  assert.equal(inits[0][3].fetchRemoteConfig, false);
  assert.equal(inits[0][3].trackingOptions.ipAddress, false);
  assert.equal(inits[0][3].serverZone, 'EU');
  assert.equal(f.calls.filter(c => c[0] === 'track').length, 2);
});
test('drop private values even when placed in allowed property names', () => {
  assert.deepEqual(safeProperties({ rubro: 'transporte_personal', comuna: 'mejillones',
    email: 'persona@example.com', rut: '12345678-9', mensaje: 'texto privado',
    tipo_problema: 'persona@example.com', resultado: { secreto: 'x' } }),
    { rubro: 'transporte_personal', comuna: 'mejillones' });
  assert.deepEqual(safeProperties(null), {});
});
test('unknown event is rejected without loading SDK', async () => {
  const f = fixture();
  assert.equal(await f.analytics.track('nombre@example.com'), false);
  assert.equal(f.loads(), 0);
});
test('StrictMode duplicate effect is suppressed; a return visit is counted', async () => {
  const f = fixture();
  await Promise.all([f.analytics.page('/plataforma', 'a'), f.analytics.page('/plataforma', 'a')]);
  await f.analytics.page('/inscripcion', 'b');
  await f.analytics.page('/plataforma', 'a');
  assert.equal(f.calls.filter(c => c[0] === 'track').length, 3);
});
test('private paths and token routes are excluded', async () => {
  const f = fixture();
  for (const p of ['/admin', '/pagar/secret', '/v/serial', '/resultado/id', '/impersonar/admin', '/mis-datos']) {
    assert.equal(publicPage(p), null);
    assert.equal(await f.analytics.page(p, 'a'), false);
  }
  assert.equal(f.loads(), 0);
});
test('opt-out and re-enable never reinitialize a ready SDK', async () => {
  const f = fixture();
  await f.analytics.track('problema_registrado');
  f.analytics.setOptOut(true);
  assert.equal(await f.analytics.track('analisis_completado'), false);
  f.analytics.setOptOut(false);
  assert.equal(await f.analytics.track('analisis_completado'), true);
  assert.equal(f.calls.filter(c => c[0] === 'init').length, 1);
});
test('opt-out during SDK loading drops pending event and allows later initialization', async () => {
  let release;
  const deferred = new Promise(resolve => { release = resolve; });
  const original = fixture();
  const f = fixture({ loadSdk: () => deferred });
  const pending = f.analytics.track('problema_registrado');
  f.analytics.setOptOut(true);
  release(original.sdk);
  assert.equal(await pending, false);
  assert.equal(original.calls.length, 0);
  f.analytics.setOptOut(false);
  assert.equal(await f.analytics.track('problema_registrado'), true);
});
test('SDK failure is contained and can recover', async () => {
  let attempt = 0;
  const original = fixture();
  const f = fixture({ loadSdk: async () => { if (++attempt === 1) throw new Error('offline'); return original.sdk; } });
  assert.equal(await f.analytics.track('problema_registrado'), false);
  assert.equal(await f.analytics.track('problema_registrado'), true);
});
test('all five insurance event names are available without artificial emission', () => {
  const f = fixture();
  for (const name of ['problema_registrado', 'analisis_completado', 'propuesta_consultada', 'simulacion_completada', 'cotizacion_solicitada']) assert.ok(EVENTS.includes(name));
  assert.equal(f.calls.length, 0);
});
