import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashClave, verifyClave, encrypt, decrypt } from '../lib/crypto.js';

test('hashClave/verifyClave acepta la clave correcta y rechaza la incorrecta', () => {
  const stored = hashClave('MiClaveSII123');
  assert.ok(stored.startsWith('scrypt$'));
  assert.equal(verifyClave('MiClaveSII123', stored), true);
  assert.equal(verifyClave('otra', stored), false);
});

test('hash distinto por salt aleatorio para la misma clave', () => {
  assert.notEqual(hashClave('abc'), hashClave('abc'));
});

test('encrypt/decrypt round-trip con el secreto correcto', () => {
  const blob = encrypt('clave-sii-secreta', 'clave-sii-secreta');
  assert.ok(!blob.includes('clave-sii-secreta'), 'el blob no contiene la clave en claro');
  assert.equal(decrypt(blob, 'clave-sii-secreta'), 'clave-sii-secreta');
});

test('decrypt falla con secreto equivocado', () => {
  const blob = encrypt('dato', 'llave-buena');
  assert.throws(() => decrypt(blob, 'llave-mala'));
});
