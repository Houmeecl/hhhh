import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { hashApiKey, normalizarRut } from '../src/services/mandante.js';

test('hashApiKey es determinista (misma key → mismo hash)', () => {
  const key = 'smk_ejemploDeTokenAbc123';
  assert.equal(hashApiKey(key), hashApiKey(key));
});

test('hashApiKey produce hashes distintos para keys distintas', () => {
  assert.notEqual(hashApiKey('smk_uno'), hashApiKey('smk_dos'));
});

test('hashApiKey coincide con sha256 hex estándar (compatible con accesos.js)', () => {
  const key = 'smk_verificacion';
  const esperado = crypto.createHash('sha256').update(key).digest('hex');
  assert.equal(hashApiKey(key), esperado);
});

test('normalizarRut quita puntos y guión, deja K en mayúscula', () => {
  assert.equal(normalizarRut('78.222.333-k'), '78222333K');
  assert.equal(normalizarRut('11.111.111-1'), '111111111');
});

test('normalizarRut con entrada vacía o nula no lanza', () => {
  assert.equal(normalizarRut(''), '');
  assert.equal(normalizarRut(null), '');
  assert.equal(normalizarRut(undefined), '');
});

test('normalizarRut es idempotente (ya normalizado no cambia)', () => {
  const n = normalizarRut('76.123.456-0');
  assert.equal(normalizarRut(n), n);
});
