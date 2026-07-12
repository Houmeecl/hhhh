import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarRut, dvRut, formatearRut, limpiarRut } from '../lib/rut.js';

test('dvRut calcula el dígito verificador', () => {
  assert.equal(dvRut('11111111'), '1');
  assert.equal(dvRut('76123456'), '0');
  assert.equal(dvRut('78222333'), 'K');
});

test('validarRut acepta válidos y rechaza inválidos', () => {
  assert.equal(validarRut('11.111.111-1'), true);
  assert.equal(validarRut('76.123.456-0'), true);
  assert.equal(validarRut('78.222.333-K'), true);
  assert.equal(validarRut('76.123.456-7'), false); // DV real es 0
  assert.equal(validarRut('1'), false);
  assert.equal(validarRut(''), false);
});

test('formatearRut agrega puntos y guion', () => {
  assert.equal(formatearRut('111111111'), '11.111.111-1');
  assert.equal(formatearRut('78222333K'), '78.222.333-K');
});

test('limpiarRut deja solo dígitos y K', () => {
  assert.equal(limpiarRut('12.345.678-k'), '12345678K');
});
