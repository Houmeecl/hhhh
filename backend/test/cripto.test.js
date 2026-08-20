import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cifrar, descifrar, cifradoDisponible } from '../src/services/cripto.js';
import { config } from '../src/config.js';

// ============================================================
// El cifrado tiene DOS contratos, no uno, y hay que probar los dos.
//
//   desarrollo            cae a la llave fija de dev. Siempre disponible.
//   producción CON llave  usa SII_CRED_KEY. Siempre disponible.
//   producción SIN llave  NO disponible, y cifrar() tiene que reventar
//                         con un mensaje que nombre la variable que falta.
//
// Este archivo antes solo probaba el primero, con un `assert.equal(
// cifradoDisponible(), true)` a secas. Eso lo dejaba rojo en cualquier
// máquina con NODE_ENV=production y SII_CRED_KEY vacía — que es
// exactamente la corrida que deploy/actualizar.sh hace en el VPS antes de
// reiniciar. Un gate que falla por su propia suposición no protege nada:
// enseña a ignorarlo.
//
// Ahora la condición se lee de la configuración real y cada rama afirma lo
// suyo. El tercer caso es el que más importa: que la funcionalidad se
// apague con elegancia en vez de guardar una credencial del SII en claro.
// ============================================================

const HAY_LLAVE = Boolean(config.cripto.siiKey);
const EN_PRODUCCION = config.env === 'production';
const DISPONIBLE = HAY_LLAVE || !EN_PRODUCCION;

const SIN_CIFRADO = DISPONIBLE
  ? false
  : 'NODE_ENV=production sin SII_CRED_KEY: el cifrado está apagado a propósito';
const CON_CIFRADO = DISPONIBLE
  ? 'hay llave de cifrado: la rama de "sin llave" no aplica'
  : false;

test('cifradoDisponible refleja si hay con qué cifrar', () => {
  assert.equal(cifradoDisponible(), DISPONIBLE);
});

test('en producción sin SII_CRED_KEY, cifrar() falla nombrando la variable', { skip: CON_CIFRADO }, () => {
  // Que se apague no puede ser silencioso: si esto devolviera el texto
  // plano o un blob con llave vacía, la clave tributaria quedaría legible
  // en una columna TEXT.
  assert.throws(() => cifrar('MiClaveSII_2025!'), /SII_CRED_KEY/);
});

test('cifrar/descifrar hace round-trip', { skip: SIN_CIFRADO }, () => {
  const secreto = 'MiClaveSII_2025!';
  const blob = cifrar(secreto);
  assert.notEqual(blob, secreto);           // no queda en claro
  assert.ok(!blob.includes(secreto));       // el texto plano no aparece en el blob
  assert.equal(descifrar(blob), secreto);   // se recupera intacto
});

test('cada cifrado usa un IV distinto (dos blobs del mismo texto difieren)', { skip: SIN_CIFRADO }, () => {
  const a = cifrar('igual');
  const b = cifrar('igual');
  assert.notEqual(a, b);
  assert.equal(descifrar(a), 'igual');
  assert.equal(descifrar(b), 'igual');
});

test('un blob manipulado no se descifra (GCM detecta el cambio)', { skip: SIN_CIFRADO }, () => {
  const blob = cifrar('secreto');
  const [iv, tag, ct] = blob.split(':');
  // Alterar el ciphertext invalida el tag de autenticación.
  const ctRoto = Buffer.from(ct, 'base64');
  ctRoto[0] ^= 0xff;
  const manipulado = `${iv}:${tag}:${ctRoto.toString('base64')}`;
  assert.throws(() => descifrar(manipulado));
});

test('descifrar rechaza un blob con formato inválido', { skip: SIN_CIFRADO }, () => {
  assert.throws(() => descifrar('no-es-un-blob'), /formato inválido/);
});
