import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvEscape, filasACsv } from '../src/services/csv.js';

test('csvEscape deja intacto un valor sin caracteres especiales', () => {
  assert.equal(csvEscape('761111111'), '761111111');
  assert.equal(csvEscape(1234), '1234');
  assert.equal(csvEscape(null), '');
  assert.equal(csvEscape(undefined), '');
});

test('csvEscape envuelve y duplica comillas cuando hay coma o comillas', () => {
  assert.equal(csvEscape('Comercializadora "El Sol", Ltda.'), '"Comercializadora ""El Sol"", Ltda."');
  assert.equal(csvEscape('línea\ncon salto'), '"línea\ncon salto"');
});

test('filasACsv arma encabezado + filas separadas por CRLF', () => {
  const csv = filasACsv(['rut', 'nombre'], [{ rut: '761111111', nombre: 'Proveedor, S.A.' }]);
  assert.equal(csv, 'rut,nombre\r\n761111111,"Proveedor, S.A."\r\n');
});

test('filasACsv maneja cero filas (solo encabezado)', () => {
  assert.equal(filasACsv(['a', 'b'], []), 'a,b\r\n');
});
