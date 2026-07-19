import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filaEslabonPublico, hashCorto } from '../src/services/cadenaPublica.js';

// Fila de `facturas` como sale de la base: llena de datos sensibles que
// JAMÁS deben llegar a la vista pública.
const FACTURA = {
  id: 'f1a2b3c4-0000-0000-0000-000000000001',
  sesion_id: 's-privada',
  invoice_id_simple: 'ext-99',
  numero_venta: 'F-12345',
  archivo_original: 'factura-cliente-secreto.xml',
  rut_emisor: '76123456-0',
  rut_receptor: '11111111-1',
  total_co2e: '3.4567',
  categoria: 'Energía eléctrica',
  status: 'procesada',
  motor: 'propio',
  hash_documento: 'd'.repeat(64),
  hash_anterior: 'a'.repeat(64),
  hash_cadena: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  eslabon: '7',
  created_at: '2026-07-18T14:30:00.000Z',
};

test('filaEslabonPublico: SOLO las claves permitidas (Object.keys estricto)', () => {
  const fila = filaEslabonPublico(FACTURA);
  assert.deepEqual(
    Object.keys(fila).sort(),
    ['eslabon', 'factura_id', 'fecha', 'hash_corto', 't_co2e']
  );
});

test('filaEslabonPublico: no filtra rut, empresa, folio ni archivo', () => {
  const texto = JSON.stringify(filaEslabonPublico(FACTURA));
  assert.ok(!texto.includes('76123456'), 'sin RUT emisor');
  assert.ok(!texto.includes('11111111'), 'sin RUT receptor');
  assert.ok(!texto.includes('F-12345'), 'sin folio');
  assert.ok(!texto.includes('secreto'), 'sin nombre de archivo');
  assert.ok(!texto.includes('s-privada'), 'sin sesion_id');
  assert.ok(!texto.includes(FACTURA.hash_cadena), 'sin el hash completo');
});

test('filaEslabonPublico: valores mapeados y tipados', () => {
  const fila = filaEslabonPublico(FACTURA);
  assert.equal(fila.eslabon, 7);
  assert.equal(fila.factura_id, FACTURA.id);
  assert.equal(fila.fecha, '2026-07-18');
  assert.equal(fila.hash_corto, '0123456789…89abcdef');
  assert.equal(fila.t_co2e, 3.4567);
});

test('filaEslabonPublico: sin created_at la fecha es null', () => {
  assert.equal(filaEslabonPublico({ ...FACTURA, created_at: null }).fecha, null);
});

test('hashCorto: 10 iniciales + … + 8 finales', () => {
  const h = 'abcdefghij' + 'x'.repeat(46) + 'qrstuvwz';
  assert.equal(hashCorto(h), 'abcdefghij…qrstuvwz');
  assert.equal(hashCorto(h).length, 19);
});

test('hashCorto: hashes cortos o vacíos pasan tal cual', () => {
  assert.equal(hashCorto('abc'), 'abc');
  assert.equal(hashCorto(''), '');
  assert.equal(hashCorto(null), '');
});
