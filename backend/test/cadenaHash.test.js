import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GENESIS, hashDocumento, hashCadena, eslabonValido, verificarCadenaCompleta, siguienteEslabon } from '../src/services/cadenaHash.js';

const DOC_A = { numero_venta: 'F-1', rut_emisor: '76123456-0', rut_receptor: '11111111-1', total_co2e: 1.2345, categoria: 'Energía eléctrica', archivo_original: 'a.xml' };
const DOC_B = { numero_venta: 'F-2', rut_emisor: '76123456-0', rut_receptor: '11111111-1', total_co2e: 2.5, categoria: 'Agua', archivo_original: 'b.xml' };

test('hashDocumento es determinista (mismo contenido → mismo hash)', () => {
  assert.equal(hashDocumento(DOC_A), hashDocumento({ ...DOC_A }));
});

test('hashDocumento produce hashes distintos para contenidos distintos', () => {
  assert.notEqual(hashDocumento(DOC_A), hashDocumento(DOC_B));
});

test('hashDocumento es sensible a cada campo (total_co2e distinto → hash distinto)', () => {
  assert.notEqual(hashDocumento(DOC_A), hashDocumento({ ...DOC_A, total_co2e: 1.2346 }));
});

test('hashCadena encadena el hash anterior con el del documento', () => {
  const hDoc = hashDocumento(DOC_A);
  const c1 = hashCadena(GENESIS, hDoc);
  const c2 = hashCadena('otro-hash-anterior', hDoc);
  assert.notEqual(c1, c2, 'debe depender del hash anterior');
  assert.equal(hashCadena(GENESIS, hDoc), c1, 'determinista');
});

test('hashCadena sin hash anterior usa GENESIS', () => {
  const hDoc = hashDocumento(DOC_A);
  assert.equal(hashCadena(null, hDoc), hashCadena(GENESIS, hDoc));
  assert.equal(hashCadena(undefined, hDoc), hashCadena(GENESIS, hDoc));
});

test('eslabonValido: true cuando hash_cadena coincide con lo recalculado', () => {
  const hDoc = hashDocumento(DOC_A);
  const hCad = hashCadena(GENESIS, hDoc);
  assert.equal(eslabonValido({ hash_anterior: GENESIS, hash_documento: hDoc, hash_cadena: hCad }), true);
});

test('eslabonValido: false si el hash_cadena fue alterado', () => {
  const hDoc = hashDocumento(DOC_A);
  assert.equal(eslabonValido({ hash_anterior: GENESIS, hash_documento: hDoc, hash_cadena: 'manipulado' }), false);
});

test('eslabonValido: false sin hash_documento o hash_cadena', () => {
  assert.equal(eslabonValido({ hash_anterior: GENESIS, hash_documento: null, hash_cadena: 'x' }), false);
  assert.equal(eslabonValido({ hash_anterior: GENESIS, hash_documento: 'x', hash_cadena: null }), false);
});

test('verificarCadenaCompleta: cadena de 3 eslabones íntegra es válida', () => {
  const hDocA = hashDocumento(DOC_A);
  const hCadA = hashCadena(GENESIS, hDocA);
  const hDocB = hashDocumento(DOC_B);
  const hCadB = hashCadena(hCadA, hDocB);
  const hDocC = hashDocumento({ ...DOC_A, numero_venta: 'F-3' });
  const hCadC = hashCadena(hCadB, hDocC);

  const eslabones = [
    { id: '1', hash_anterior: GENESIS, hash_documento: hDocA, hash_cadena: hCadA },
    { id: '2', hash_anterior: hCadA, hash_documento: hDocB, hash_cadena: hCadB },
    { id: '3', hash_anterior: hCadB, hash_documento: hDocC, hash_cadena: hCadC },
  ];
  const r = verificarCadenaCompleta(eslabones);
  assert.equal(r.valido, true);
  assert.equal(r.total_eslabones, 3);
  assert.equal(r.ultimo_hash, hCadC);
});

test('verificarCadenaCompleta: detecta un hash_cadena alterado en el medio', () => {
  const hDocA = hashDocumento(DOC_A);
  const hCadA = hashCadena(GENESIS, hDocA);
  const hDocB = hashDocumento(DOC_B);
  const hCadB = hashCadena(hCadA, hDocB);

  const eslabones = [
    { id: '1', hash_anterior: GENESIS, hash_documento: hDocA, hash_cadena: hCadA },
    { id: '2', hash_anterior: hCadA, hash_documento: hDocB, hash_cadena: 'HASH_MANIPULADO' },
    { id: '3', hash_anterior: hCadB, hash_documento: hDocA, hash_cadena: hashCadena(hCadB, hDocA) },
  ];
  const r = verificarCadenaCompleta(eslabones);
  assert.equal(r.valido, false);
  assert.equal(r.rompe_en, '2');
});

test('verificarCadenaCompleta: detecta un hash_anterior que no enlaza con el eslabón previo', () => {
  const hDocA = hashDocumento(DOC_A);
  const hCadA = hashCadena(GENESIS, hDocA);
  const hDocB = hashDocumento(DOC_B);
  const eslabones = [
    { id: '1', hash_anterior: GENESIS, hash_documento: hDocA, hash_cadena: hCadA },
    { id: '2', hash_anterior: 'no-es-hCadA', hash_documento: hDocB, hash_cadena: hashCadena('no-es-hCadA', hDocB) },
  ];
  const r = verificarCadenaCompleta(eslabones);
  assert.equal(r.valido, false);
  assert.equal(r.rompe_en, '2');
});

test('verificarCadenaCompleta: cadena vacía es válida (0 eslabones)', () => {
  const r = verificarCadenaCompleta([]);
  assert.deepEqual(r, { valido: true, total_eslabones: 0, ultimo_hash: GENESIS });
});

// ---------- siguienteEslabon (usado por declaraciones_embalaje y Capital Natural) ----------

test('siguienteEslabon arma hash_cadena = hashCadena(ultimo_hash, hashDoc) y eslabon = n_eslabones + 1', () => {
  const hDoc = hashDocumento({ numero_venta: 'X', rut_emisor: '1', rut_receptor: '2', total_co2e: 1, categoria: 'c', archivo_original: 'a' });
  const estado = { ultimo_hash: 'abc123', n_eslabones: 4 };
  const r = siguienteEslabon(estado, hDoc);
  assert.equal(r.hash_cadena, hashCadena('abc123', hDoc));
  assert.equal(r.eslabon, 5);
});

test('siguienteEslabon funciona con estado null/undefined (primer eslabón, génesis)', () => {
  const hDoc = hashDocumento({ numero_venta: 'X', rut_emisor: '1', rut_receptor: '2', total_co2e: 1, categoria: 'c', archivo_original: 'a' });
  const r = siguienteEslabon(null, hDoc);
  assert.equal(r.hash_cadena, hashCadena(GENESIS, hDoc));
  assert.equal(r.eslabon, 1);
});

test('siguienteEslabon con n_eslabones ausente en el estado asume 0', () => {
  const hDoc = 'hash-cualquiera';
  const r = siguienteEslabon({ ultimo_hash: GENESIS }, hDoc);
  assert.equal(r.eslabon, 1);
});
