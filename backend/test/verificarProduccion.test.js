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

// Sin correo no se puede dar de alta un cliente: se caen la activación de
// cuenta, el magic link y "¿olvidaste tu contraseña?". Antes solo advertía;
// ahora es fatal, igual que MOCK_SIMPLE — no basta con "degradar en silencio"
// cuando lo que se rompe es el alta del cliente real.
test('sin SMTP propio ni RESEND_API_KEY es fatal', () => {
  const cfg = base();
  cfg.resend.apiKey = '';
  const { fatales } = verificarConfigProduccion(cfg);
  assert.equal(fatales.length, 1);
  assert.match(fatales[0], /correos NO se envían/);
});

test('con SMTP propio configurado, sin RESEND_API_KEY no es fatal', () => {
  // mailer.js prioriza SMTP propio (Poste.io) sobre Resend — basta con uno
  // de los dos transportes, no hace falta ambos.
  const cfg = base();
  cfg.resend.apiKey = '';
  cfg.smtp = { host: 'mail.sicr3p.cl', user: 'no-responder@sicr3p.cl', pass: 'algo' };
  const { fatales, advertencias } = verificarConfigProduccion(cfg);
  assert.deepEqual(fatales, []);
  assert.deepEqual(advertencias, []);
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

// Un typo en SII_PROVEEDOR ('simplapi') caía en SILENCIO a baseapi: toda
// descarga usaba el proveedor equivocado sin que nadie lo notara.
test('SII_PROVEEDOR desconocido es fatal (no puede caer en silencio a baseapi)', () => {
  const cfg = base();
  cfg.sii = { proveedor: 'simplapi', simpleapi: { enabled: true }, apigateway: { enabled: false } };
  const { fatales } = verificarConfigProduccion(cfg);
  assert.equal(fatales.length, 1);
  assert.match(fatales[0], /SII_PROVEEDOR/);
  assert.match(fatales[0], /simplapi/);
});

test('SII_PROVEEDOR=simpleapi sin SIMPLEAPI_KEY es fatal', () => {
  const cfg = base();
  cfg.sii = { proveedor: 'simpleapi', simpleapi: { enabled: false }, apigateway: { enabled: false } };
  const { fatales } = verificarConfigProduccion(cfg);
  assert.equal(fatales.length, 1);
  assert.match(fatales[0], /SIMPLEAPI_KEY/);
});

test('SII_PROVEEDOR=apigateway sin APIGATEWAY_API_KEY es fatal', () => {
  const cfg = base();
  cfg.sii = { proveedor: 'apigateway', simpleapi: { enabled: false }, apigateway: { enabled: false } };
  const { fatales } = verificarConfigProduccion(cfg);
  assert.equal(fatales.length, 1);
  assert.match(fatales[0], /APIGATEWAY_API_KEY/);
});

test('SII_PROVEEDOR válido con su key presente no arroja fatales', () => {
  const cfg = base();
  cfg.sii = { proveedor: 'simpleapi', simpleapi: { enabled: true }, apigateway: { enabled: false } };
  const { fatales } = verificarConfigProduccion(cfg);
  assert.deepEqual(fatales, []);
  // baseapi por defecto tampoco (su falta de key ya tiene advertencia propia).
  const cfg2 = base();
  cfg2.sii = { proveedor: 'baseapi', simpleapi: { enabled: false }, apigateway: { enabled: false } };
  assert.deepEqual(verificarConfigProduccion(cfg2).fatales, []);
});

test('los defaults de desarrollo acumulan varios fatales a la vez', () => {
  const cfg = base();
  cfg.jwt.accessSecret = 'dev_access_secret_change_me';
  cfg.jwt.refreshSecret = 'dev_refresh_secret_change_me';
  cfg.seedDemo = true;
  const { fatales } = verificarConfigProduccion(cfg);
  assert.equal(fatales.length, 3);
});
