import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { config } from '../src/config.js';
import { signAccess, requireHomePanel } from '../src/middleware/auth.js';

// Mismo estilo del resto de la suite: unidades puras, sin servidor HTTP ni
// base de datos (no hay precedente de tests de integración sobre rutas en
// este proyecto — la verificación end-to-end del login cruzado se hace con
// Playwright contra el entorno local, no aquí).

test('signAccess incluye panel="sicrep" por defecto cuando el usuario no lo trae', () => {
  const token = signAccess({ id: 'u1', rol: 'admin', email: 'a@sicrep.cl' });
  const payload = jwt.verify(token, config.jwt.accessSecret);
  assert.equal(payload.panel, 'sicrep');
});

test('signAccess respeta panel="aduana_verde" cuando el usuario lo trae', () => {
  const token = signAccess({ id: 'u2', rol: 'admin', email: 'a@av.cl', panel: 'aduana_verde' });
  const payload = jwt.verify(token, config.jwt.accessSecret);
  assert.equal(payload.panel, 'aduana_verde');
});

function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (n) => { res.statusCode = n; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

test('requireHomePanel deja pasar una cuenta del panel correcto', () => {
  const req = { user: { panel: 'sicrep' } };
  const res = mockRes();
  let llamoNext = false;
  requireHomePanel('sicrep')(req, res, () => { llamoNext = true; });
  assert.equal(llamoNext, true);
  assert.equal(res.statusCode, null);
});

test('requireHomePanel rechaza con 403 una cuenta de otro panel', () => {
  const req = { user: { panel: 'sicrep' } };
  const res = mockRes();
  let llamoNext = false;
  requireHomePanel('aduana_verde')(req, res, () => { llamoNext = true; });
  assert.equal(llamoNext, false);
  assert.equal(res.statusCode, 403);
  assert.ok(res.body.error);
});

test('requireHomePanel rechaza cuando no hay req.user (JWT no verificado antes)', () => {
  const req = {};
  const res = mockRes();
  let llamoNext = false;
  requireHomePanel('sicrep')(req, res, () => { llamoNext = true; });
  assert.equal(llamoNext, false);
  assert.equal(res.statusCode, 403);
});
