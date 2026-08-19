import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { generateCarpetaMandante } from '../src/services/pdf.js';
import { GENESIS, hashDocumento, hashCadena } from '../src/services/cadenaHash.js';

// ============================================================
// La carpeta del mandante se imprime y se entrega en papel. Su caja
// "SELLO DE INTEGRIDAD" verificaba SOLO el primer documento y se pintaba
// verde con eso: una carpeta con el primer documento intacto y el séptimo
// alterado salía verde. El rótulo decía "primer documento", pero quien la
// recibe mira el color.
// ============================================================

function textoDelPdf(buf) {
  let salida = '';
  const bin = buf.toString('latin1');
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  while ((m = re.exec(bin)) !== null) {
    let crudo;
    try { crudo = zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { continue; }
    for (const t of crudo.matchAll(/<([0-9A-Fa-f\s]+)>/g)) {
      salida += Buffer.from(t[1].replace(/\s/g, ''), 'hex').toString('latin1');
    }
    for (const t of crudo.matchAll(/\(((?:[^()\\]|\\.)*)\)/g)) {
      salida += t[1].replace(/\\([()\\])/g, '$1');
    }
  }
  return salida;
}

const SESION = {
  id: '11111111-1111-1111-1111-111111111111',
  nombre_cliente: 'Empresa de Prueba', rut_cliente: '76.123.456-0',
  fecha: new Date('2026-06-15T12:00:00Z'),
};

// Tres documentos sellados y encadenados de verdad.
function documentos() {
  const docs = [];
  let anterior = GENESIS;
  for (let i = 1; i <= 3; i += 1) {
    const base = {
      numero_venta: `F-${i}`, rut_emisor: '76.111.111-1', rut_receptor: '76.123.456-0',
      total_co2e: i, categoria: 'Servicios', archivo_original: `f${i}.pdf`,
    };
    const hash_documento = hashDocumento(base);
    const hash_cadena = hashCadena(anterior, hash_documento);
    docs.push({
      ...base, id: `2222222${i}-2222-2222-2222-222222222222`, status: 'ok',
      categoria_codigo: 'servicios', categoria_origen: 'glosa', items: [],
      eslabon: i, hash_anterior: anterior, hash_documento, hash_cadena,
    });
    anterior = hash_cadena;
  }
  return docs;
}

const carpeta = (facturas) => generateCarpetaMandante({
  sesion: SESION, facturas, declaracion: null, alcances: [],
  mandante: { nombre: 'Mandante SpA' }, contrapartes: null,
});

test('con todos los documentos íntegros, el sello dice cuántos verificó', async () => {
  const texto = textoDelPdf(await carpeta(documentos()));
  assert.match(texto, /SELLO DE INTEGRIDAD \(3 de 3 documentos sellados verificados\)/);
  assert.ok(!/No verifica/.test(texto));
});

test('un documento alterado que NO es el primero rompe el sello', async () => {
  const docs = documentos();
  // Se altera el tercero: antes esto pasaba inadvertido porque solo se
  // miraba el primero.
  docs[2].hash_documento = hashDocumento({ numero_venta: 'ADULTERADA', total_co2e: 999 });
  const texto = textoDelPdf(await carpeta(docs));
  assert.match(texto, /SELLO DE INTEGRIDAD \(2 de 3 documentos sellados verificados\)/);
  assert.match(texto, /No verifica: F-3/);
  assert.match(texto, /Verifique en l.nea con el QR/);
});

test('los documentos sin sellar no cuentan ni rompen nada', async () => {
  const docs = documentos();
  docs.push({ id: 'sin-sello', numero_venta: 'F-4', total_co2e: 1, status: 'ok', items: [] });
  const texto = textoDelPdf(await carpeta(docs));
  assert.match(texto, /SELLO DE INTEGRIDAD \(3 de 3 documentos sellados verificados\)/);
});

test('una carpeta sin documentos sellados no imprime sello', async () => {
  const texto = textoDelPdf(await carpeta([{ id: 'x', numero_venta: 'F-1', total_co2e: 1, status: 'ok', items: [] }]));
  assert.ok(!/SELLO DE INTEGRIDAD/.test(texto));
});
