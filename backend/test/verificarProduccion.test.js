import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verificarConfigProduccion } from '../src/lib/verificarProduccion.js';

// Config mínima sana: secretos largos y distintos, sin demo, correo y motor reales.
const base = () => ({
  jwt: {
    accessSecret: 'a'.repeat(64),
    refreshSecret: 'b'.repeat(64),
  },
  seedDemo: false,
  resend: { apiKey: 're_algo' },
  simple: { mock: false },
  baseapi: { enabled: true },
  cripto: { siiKey: 'c'.repeat(64) },
});

test('config sana no arroja fatales ni advertencias', () => {
  const { fatales, advertencias } = verificarConfigProduccion(base());
  assert.deepEqual(fatales, []);
  assert.deepEqual(advertencias, []);
});

test('secreto JWT con el default de desarrollo es fatal', () => {
  const cfg = base();
  cfg.jwt.accessSecret = 'dev_access_secret_change_me';
  const { fatales } = verificarConfigProduccion(cfg);
  assert.equal(fatales.length, 1);
  assert.match(fatales[0], /JWT_ACCESS_SECRET/);
});

test('secreto JWT demasiado corto es fatal', () => {
  const cfg = base();
  cfg.jwt.refreshSecret = 'corto';
  const { fatales } = verificarConfigProduccion(cfg);
  assert.equal(fatales.length, 1);
  assert.match(fatales[0], /JWT_REFRESH_SECRET/);
});

test('secretos access y refresh idénticos es fatal', () => {
  const cfg = base();
  cfg.jwt.refreshSecret = cfg.jwt.accessSecret;
  const { fatales } = verificarConfigProduccion(cfg);
  assert.equal(fatales.length, 1);
  assert.match(fatales[0], /idénticos/);
});

test('SEED_DEMO=true es fatal', () => {
  const cfg = base();
  cfg.seedDemo = true;
  const { fatales } = verificarConfigProduccion(cfg);
  assert.equal(fatales.length, 1);
  assert.match(fatales[0], /SEED_DEMO/);
});

test('sin RESEND_API_KEY solo advierte: degrada, no miente', () => {
  // Sin correo el sistema sigue calculando bien; lo que se rompe es la
  // activación de cuentas. Grave, pero no produce un número falso.
  const cfg = base();
  cfg.resend.apiKey = '';
  const { fatales, advertencias } = verificarConfigProduccion(cfg);
  assert.deepEqual(fatales, []);
  assert.equal(advertencias.length, 1);
  assert.match(advertencias[0], /correos NO se envían/);
});

// En modo mock, `simpleApi.mockAnalyzeInvoice` genera el CO2e con un PRNG y
// ese número se sella en la cadena de hash y se firma en el informe del
// cliente. Un número inventado no puede llegar a producción porque alguien
// olvidó una variable de entorno: el backend no levanta.
test('MOCK_SIMPLE=true es FATAL en producción, no una advertencia', () => {
  const cfg = base();
  cfg.simple.mock = true;
  const { fatales } = verificarConfigProduccion(cfg);
  assert.equal(fatales.length, 1);
  assert.match(fatales[0], /MOCK_SIMPLE/);
  assert.match(fatales[0], /sellad/, 'el mensaje dice por qué importa, no solo qué falta');
});

test('sin BASEAPI_API_KEY solo advierte que el autocompletado SII queda apagado', () => {
  const cfg = base();
  cfg.baseapi = { enabled: false };
  const { fatales, advertencias } = verificarConfigProduccion(cfg);
  assert.deepEqual(fatales, []);
  assert.equal(advertencias.length, 1);
  assert.match(advertencias[0], /BASEAPI_API_KEY/);
});

test('sin SII_CRED_KEY es fatal (se cifraría con la llave de desarrollo)', () => {
  const cfg = base();
  cfg.cripto = { siiKey: '' };
  const { fatales } = verificarConfigProduccion(cfg);
  assert.equal(fatales.length, 1);
  assert.match(fatales[0], /SII_CRED_KEY/);
});

test('SII_CRED_KEY demasiado corta es fatal', () => {
  const cfg = base();
  cfg.cripto = { siiKey: 'corta' };
  const { fatales } = verificarConfigProduccion(cfg);
  assert.equal(fatales.length, 1);
  assert.match(fatales[0], /SII_CRED_KEY/);
});

test('los defaults de desarrollo acumulan varios fatales a la vez', () => {
  const cfg = base();
  cfg.jwt.accessSecret = 'dev_access_secret_change_me';
  cfg.jwt.refreshSecret = 'dev_refresh_secret_change_me';
  cfg.seedDemo = true;
  const { fatales } = verificarConfigProduccion(cfg);
  assert.equal(fatales.length, 3);
});
