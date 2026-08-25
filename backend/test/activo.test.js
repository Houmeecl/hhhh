import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ESTADOS, generarCodigoActivo, codigoActivoValido, estadoActivo, activoPublico,
} from '../src/services/activo.js';

// ============================================================
// El adhesivo que va pegado en la camioneta del piloto.
//
// Es la pieza más expuesta del producto: la ve gente que no entró a
// ninguna pantalla, a tres metros y con sol de frente. Lo que diga ahí no
// se puede matizar después.
// ============================================================

// ---------- El código es la única credencial de una página pública ----------

test('el código lleva 8 bytes, no 2', () => {
  // Mismo motivo que el serial de la Tarjeta de Viaje: con pocos
  // caracteres se puede barrer el espacio y averiguar qué empresas están
  // siendo auditadas.
  const c = generarCodigoActivo();
  assert.ok(codigoActivoValido(c), c);
  assert.equal(c.split('-')[1].length, 16);
});

test('el código es variado y rechaza basura', () => {
  const vistos = new Set();
  for (let i = 0; i < 50; i++) vistos.add(generarCodigoActivo());
  assert.equal(vistos.size, 50, 'colisiones en 50 intentos');
  for (const malo of ['AC-1234', 'TV-04A2BB19C7D3E5F1', 'AC-ZZZZ', '', null]) {
    assert.equal(codigoActivoValido(malo), false, String(malo));
  }
});

// ---------- El color, que es lo que se lee de lejos ----------

test('sin expedientes es GRIS, no cero ni rojo', () => {
  // Un activo recién incorporado no merece un color que insinúe
  // incumplimiento. No hay con qué comparar: eso es gris.
  assert.equal(estadoActivo([]).clave, 'sin_comparacion');
  assert.equal(estadoActivo(null).clave, 'sin_comparacion');
  assert.equal(estadoActivo([null, undefined]).clave, 'sin_comparacion');
});

test('todo cubierto es CONTRASTADO', () => {
  assert.equal(estadoActivo([100]).clave, 'contrastado');
  assert.equal(estadoActivo([100, 100, 100]).clave, 'contrastado');
});

test('el PEOR expediente manda', () => {
  // Si de tres contratos uno está incompleto, el activo no está
  // contrastado. Decir que sí porque los otros dos cierran sería
  // exactamente el verde falso que este producto existe para no emitir.
  assert.equal(estadoActivo([100, 100, 40]).clave, 'falta_evidencia');
  assert.equal(estadoActivo([100, 99.9]).clave, 'falta_evidencia');
});

test('el adhesivo NO tiene rojo: cobertura cero también es «falta evidencia»', () => {
  // `semaforoExpediente(0)` devuelve rojo. Acá colapsa en ámbar: para
  // quien va pasando significa lo mismo —falta evidencia— y un adhesivo
  // rojo en una camioneta se lee como «esta empresa está mal», que es un
  // juicio que sicr3p no emite.
  assert.equal(estadoActivo([0]).clave, 'falta_evidencia');
  const claves = Object.values(ESTADOS).map((e) => e.clave);
  assert.deepEqual(claves.sort(), ['contrastado', 'falta_evidencia', 'sin_comparacion']);
});

test('basura en las coberturas no pinta de verde', () => {
  // Un NaN colándose no puede terminar en un adhesivo que dice
  // CONTRASTADO.
  for (const malo of [['muchos'], [NaN], ['100%']]) {
    assert.equal(estadoActivo(malo).clave, 'sin_comparacion', JSON.stringify(malo));
  }
});

// ---------- El color nunca va solo ----------

test('cada estado trae palabra y símbolo, no solo color', () => {
  // A tres metros, con sol, y para quien no distingue verde de ámbar, la
  // palabra es lo único que queda.
  for (const e of Object.values(ESTADOS)) {
    assert.ok(e.palabra && e.palabra.length > 3, `${e.clave} sin palabra`);
    assert.ok(e.simbolo && e.simbolo.length >= 1, `${e.clave} sin símbolo`);
    assert.ok(/^#[0-9a-f]{6}$/i.test(e.color), `${e.clave} sin color`);
    assert.ok(e.explica && e.explica.length > 40, `${e.clave} sin explicación`);
  }
  // Y los tres símbolos son distintos entre sí: si dos coincidieran, el
  // símbolo dejaría de desambiguar.
  const simbolos = Object.values(ESTADOS).map((e) => e.simbolo);
  assert.equal(new Set(simbolos).size, 3);
});

// ---------- Lo que la página pública NO muestra ----------

test('la patente y el proveedor no salen a la calle', () => {
  // La patente identifica un móvil. Publicarla convertiría el adhesivo en
  // un rastreador para cualquiera que lo fotografíe.
  const p = activoPublico({
    codigo: 'AC-04A2BB19C7D3E5F1',
    nombre: 'Camioneta 4×4',
    identificador_interno: 'KXPR-42',
    proveedor_id: '11111111-2222-3333-4444-555555555555',
    contrato: 'Contrato A',
  }, [100]);

  const texto = JSON.stringify(p);
  assert.ok(!texto.includes('KXPR-42'), 'se publicó la patente');
  assert.ok(!texto.includes('11111111'), 'se publicó el id del proveedor');
  assert.equal(p.estado, 'contrastado');
});

test('la salida pública es lista blanca: una columna nueva no se publica sola', () => {
  const p = activoPublico({
    codigo: 'AC-04A2BB19C7D3E5F1',
    nombre: 'Grúa',
    columna_agregada_manana: 'dato que nadie revisó',
  }, []);
  assert.ok(!JSON.stringify(p).includes('dato que nadie revisó'));
});

// ---------- Lo que el adhesivo IMPRESO sí muestra ----------

test('el adhesivo impreso lleva la patente; la página pública no', async () => {
  // Las dos afirmaciones van en el MISMO test a propósito: son las dos
  // mitades de una sola decisión, y separarlas dejaría que alguien borre
  // una sin ver que rompe la otra.
  const { activoParaImpresion } = await import('../src/services/activo.js');
  const fila = {
    codigo: 'AC-04A2BB19C7D3E5F1',
    nombre: 'Camioneta 4x4',
    identificador_interno: 'KXPR-42',
    proveedor_id: '11111111-2222-3333-4444-555555555555',
    contrato: 'Contrato A',
  };

  const impreso = activoParaImpresion(fila, [100]);
  assert.equal(impreso.patente, 'KXPR-42');
  assert.equal(impreso.estado, 'contrastado');

  // Pero ni siquiera el impreso arrastra el id del proveedor: la lista
  // blanca de activoPublico sigue mandando debajo.
  assert.ok(!JSON.stringify(impreso).includes('11111111'), 'se filtró el proveedor_id');

  assert.equal(activoPublico(fila, [100]).patente, undefined);
  assert.ok(!JSON.stringify(activoPublico(fila, [100])).includes('KXPR-42'));
});

test('sin patente en la fila, el adhesivo no inventa una', async () => {
  // `identificador_interno` es opcional en la migración 109: una grúa de
  // patio no tiene patente. Debe quedar en null, no en '' ni 'undefined'
  // —que es lo que terminaría impreso en la etiqueta.
  const { activoParaImpresion } = await import('../src/services/activo.js');
  for (const fila of [{ codigo: 'AC-04A2BB19C7D3E5F1', nombre: 'Grúa' },
    { codigo: 'AC-04A2BB19C7D3E5F1', nombre: 'Grúa', identificador_interno: '' }]) {
    assert.equal(activoParaImpresion(fila, []).patente, null);
  }
});
