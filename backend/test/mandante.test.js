import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { hashApiKey, normalizarRut, formatearRut, webhookUrlValida } from '../src/services/mandante.js';

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

test('webhookUrlValida acepta http/https públicas', () => {
  assert.equal(webhookUrlValida('https://ejemplo.com/webhook'), true);
  assert.equal(webhookUrlValida('http://minera-cliente.cl/hooks/sicr3p'), true);
});

test('webhookUrlValida rechaza protocolos no http(s)', () => {
  assert.equal(webhookUrlValida('ftp://ejemplo.com'), false);
  assert.equal(webhookUrlValida('file:///etc/passwd'), false);
  assert.equal(webhookUrlValida('javascript:alert(1)'), false);
});

test('webhookUrlValida rechaza localhost e IPs privadas', () => {
  assert.equal(webhookUrlValida('http://localhost:4000/x'), false);
  assert.equal(webhookUrlValida('http://127.0.0.1/x'), false);
  assert.equal(webhookUrlValida('http://10.0.0.5/x'), false);
  assert.equal(webhookUrlValida('http://192.168.1.10/x'), false);
  assert.equal(webhookUrlValida('http://172.16.0.1/x'), false);
  assert.equal(webhookUrlValida('http://169.254.169.254/latest/meta-data'), false);
});

test('webhookUrlValida rechaza vacío, null o URL malformada', () => {
  assert.equal(webhookUrlValida(''), false);
  assert.equal(webhookUrlValida(null), false);
  assert.equal(webhookUrlValida(undefined), false);
  assert.equal(webhookUrlValida('no-es-una-url'), false);
});

test('formatearRut devuelve el formato chileno desde el valor normalizado', () => {
  // Los RUT se guardan normalizados (así se cruzan con el RCV), pero los
  // documentos que se entregan a la empresa deben mostrarlos como se escriben.
  assert.equal(formatearRut('76222089K'), '76.222.089-K');
  assert.equal(formatearRut('761234560'), '76.123.456-0');
  assert.equal(formatearRut('76.123.456-0'), '76.123.456-0');
});

test('formatearRut no inventa puntuación sobre un valor que no es un RUT', () => {
  assert.equal(formatearRut(''), '');
  assert.equal(formatearRut(null), '');
  assert.equal(formatearRut('K'), 'K');
  // Identificadores extranjeros: la forma se valida sobre el valor crudo, así
  // que las letras no se borran en silencio para fabricar un RUT chileno.
  assert.equal(formatearRut('ABC123'), 'ABC123');
  assert.equal(formatearRut('DE811907980'), 'DE811907980');
});
