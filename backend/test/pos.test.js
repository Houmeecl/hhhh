import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generarSerial,
  generarClave,
  serialValido,
  ALFABETO_CLAVE,
  LARGO_CLAVE,
  clampDocumentos,
  MAX_DOCS_TRAMITE,
} from '../src/services/posTerminal.js';

// ---------- generarSerial ----------

test('generarSerial produce el formato AV-XXXX (4 hex mayúsculas)', () => {
  for (let i = 0; i < 50; i++) {
    assert.match(generarSerial(), /^AV-[0-9A-F]{4}$/);
  }
});

test('generarSerial siempre pasa serialValido', () => {
  for (let i = 0; i < 50; i++) {
    assert.equal(serialValido(generarSerial()), true);
  }
});

test('generarSerial tiene unicidad razonable (100 muestras casi sin repetidos)', () => {
  const muestras = new Set();
  for (let i = 0; i < 100; i++) muestras.add(generarSerial());
  // El espacio es 16^4 = 65.536: por paradoja del cumpleaños puede haber
  // alguna colisión aislada en 100 muestras, pero 3+ colisiones indicaría
  // un generador roto (probabilidad astronómicamente baja).
  assert.ok(muestras.size >= 98, `demasiadas colisiones: ${100 - muestras.size}`);
});

// ---------- generarClave ----------

test('generarClave produce claves de largo 10', () => {
  for (let i = 0; i < 50; i++) {
    assert.equal(generarClave().length, LARGO_CLAVE);
    assert.equal(generarClave().length, 10);
  }
});

test('generarClave solo usa el alfabeto sin ambiguos', () => {
  for (let i = 0; i < 100; i++) {
    for (const ch of generarClave()) {
      assert.ok(ALFABETO_CLAVE.includes(ch), `carácter fuera del alfabeto: ${ch}`);
    }
  }
});

test('el alfabeto de claves no contiene caracteres ambiguos (0/O/1/I/l/L)', () => {
  for (const ambiguo of ['0', 'O', '1', 'I', 'l', 'L']) {
    assert.ok(!ALFABETO_CLAVE.includes(ambiguo), `alfabeto contiene ambiguo: ${ambiguo}`);
  }
});

test('generarClave no repite claves (100 muestras, espacio ~31^10)', () => {
  const muestras = new Set();
  for (let i = 0; i < 100; i++) muestras.add(generarClave());
  assert.equal(muestras.size, 100);
});

// ---------- serialValido ----------

test('serialValido acepta seriales bien formados', () => {
  assert.equal(serialValido('AV-0000'), true);
  assert.equal(serialValido('AV-FFFF'), true);
  assert.equal(serialValido('AV-3F0A'), true);
  assert.equal(serialValido('AV-9C21'), true);
});

test('serialValido rechaza formatos inválidos', () => {
  assert.equal(serialValido('AV-3f0a'), false);     // hex en minúsculas
  assert.equal(serialValido('AV-123'), false);      // muy corto
  assert.equal(serialValido('AV-12345'), false);    // muy largo
  assert.equal(serialValido('AV-GHIJ'), false);     // no-hex
  assert.equal(serialValido('AB-3F0A'), false);     // prefijo incorrecto
  assert.equal(serialValido('AV3F0A'), false);      // sin guión
  assert.equal(serialValido(' AV-3F0A'), false);    // espacios
  assert.equal(serialValido('AV-3F0A '), false);
});

test('serialValido no lanza con entradas no string', () => {
  assert.equal(serialValido(''), false);
  assert.equal(serialValido(null), false);
  assert.equal(serialValido(undefined), false);
  assert.equal(serialValido(1234), false);
  assert.equal(serialValido({}), false);
});

// ---------- clampDocumentos ----------

test('clampDocumentos acepta el rango válido 1..MAX_DOCS_TRAMITE', () => {
  assert.equal(clampDocumentos(1), 1);
  assert.equal(clampDocumentos(3), 3);
  assert.equal(clampDocumentos(MAX_DOCS_TRAMITE), MAX_DOCS_TRAMITE);
});

test('clampDocumentos limita valores sobre el tope al máximo', () => {
  assert.equal(clampDocumentos(MAX_DOCS_TRAMITE + 1), MAX_DOCS_TRAMITE);
  assert.equal(clampDocumentos(9999), MAX_DOCS_TRAMITE);
});

test('clampDocumentos devuelve 1 ante entradas inválidas', () => {
  assert.equal(clampDocumentos(undefined), 1);   // body sin campo (compatibilidad)
  assert.equal(clampDocumentos(null), 1);
  assert.equal(clampDocumentos(0), 1);
  assert.equal(clampDocumentos(-4), 1);
  assert.equal(clampDocumentos(2.5), 1);         // no entero
  assert.equal(clampDocumentos('3'), 3);         // string numérico sí se acepta
  assert.equal(clampDocumentos('abc'), 1);
  assert.equal(clampDocumentos({}), 1);
  assert.equal(clampDocumentos(Infinity), 1);
});
