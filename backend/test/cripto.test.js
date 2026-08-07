import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cifrar, descifrar, cifradoDisponible } from '../src/services/cripto.js';

// En desarrollo (NODE_ENV != production) el cifrado usa la llave fija de dev:
// cifradoDisponible() es true y el round-trip funciona sin configurar nada.

test('cifradoDisponible es true en desarrollo', () => {
  assert.equal(cifradoDisponible(), true);
});

test('cifrar/descifrar hace round-trip', () => {
  const secreto = 'MiClaveSII_2025!';
  const blob = cifrar(secreto);
  assert.notEqual(blob, secreto);           // no queda en claro
  assert.ok(!blob.includes(secreto));       // el texto plano no aparece en el blob
  assert.equal(descifrar(blob), secreto);   // se recupera intacto
});

test('cada cifrado usa un IV distinto (dos blobs del mismo texto difieren)', () => {
  const a = cifrar('igual');
  const b = cifrar('igual');
  assert.notEqual(a, b);
  assert.equal(descifrar(a), 'igual');
  assert.equal(descifrar(b), 'igual');
});

test('un blob manipulado no se descifra (GCM detecta el cambio)', () => {
  const blob = cifrar('secreto');
  const [iv, tag, ct] = blob.split(':');
  // Alterar el ciphertext invalida el tag de autenticación.
  const ctRoto = Buffer.from(ct, 'base64');
  ctRoto[0] ^= 0xff;
  const manipulado = `${iv}:${tag}:${ctRoto.toString('base64')}`;
  assert.throws(() => descifrar(manipulado));
});

test('descifrar rechaza un blob con formato inválido', () => {
  assert.throws(() => descifrar('no-es-un-blob'), /formato inválido/);
});
