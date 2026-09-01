import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ============================================================
// Todo PDF que imprime una cifra de CO2e lleva su descargo.
//
// POR QUÉ ESTO ES UN TEST Y NO UNA COSTUMBRE. La constante
// `AVISO_NO_VERIFICACION` trae esta nota en `pdf.js`:
//
//   «materiales comerciales (ficha 01, dossier corporativo) afirman que
//    cada informe lo dice de forma impresa; esta constante es lo que
//    sostiene esa afirmación»
//
// O sea: hay documentos comerciales que prometen que TODO informe imprime
// el descargo. Al auditarlo el 01-09-2026, de diecisiete generadores había
// **dos que imprimían t CO2e sin ningún descargo**: la etiqueta de factura
// —que además dice «RESULTADO INCORPORADO» junto a la cifra— y el
// expediente del lote. La promesa comercial era falsa y nadie lo sabía.
//
// Este archivo lee el código fuente, como `corredorReset.test.js`: no
// necesita base ni levantar el servidor, así que corre igual en el VPS con
// NODE_ENV=production.
//
// NO EXIGE UN TEXTO ÚNICO, y eso es a propósito. `generateInformeApl`
// tiene su propio «pie de honestidad» —dice que no acredita el
// cumplimiento del APL y quién sí lo otorga—, que es MÁS específico que el
// aviso genérico. Obligarlo a llevar además el de ISO 14064-3 sería ruido.
// Lo que se exige es que haya alguno.
// ============================================================

const SRC = readFileSync(new URL('../src/services/pdf.js', import.meta.url), 'utf8');
const LINEAS = SRC.split('\n');

// Los generadores exportados, con el rango de líneas de cada uno.
function generadores() {
  const inicios = [];
  LINEAS.forEach((l, i) => {
    const m = l.match(/^export (?:async )?function (generate\w+)/);
    if (m) inicios.push({ nombre: m[1], desde: i });
  });
  return inicios.map((g, k) => ({
    ...g,
    hasta: k + 1 < inicios.length ? inicios[k + 1].desde : LINEAS.length,
    cuerpo: LINEAS.slice(g.desde, k + 1 < inicios.length ? inicios[k + 1].desde : LINEAS.length),
  }));
}

// ¿Imprime una cifra de CO2e al lector? Se busca en lo que va a `.text(`,
// no en comentarios: un comentario que menciona CO2e no imprime nada.
const imprimeCo2e = (cuerpo) => cuerpo.some((l) => {
  const sinComentario = l.replace(/\/\/.*$/, '');
  return /\.text\(|`/.test(sinComentario) && /CO2e|CO₂e/.test(sinComentario) && !/^\s*\/\//.test(l);
});

// ¿Lleva algún descargo? Vale el genérico, el breve, o uno propio que
// diga que no acredita / no certifica / no constituye verificación.
const llevaDescargo = (cuerpo) => cuerpo.some((l) => (
  /avisoNoVerificacion\(doc|AVISO_NO_VERIFICACION|AVISO_BREVE/.test(l)
  || /NO acredita|no acredita ni certifica|NO constituye una verificación|no certifica/i.test(l)
));

test('todo generador que imprime CO2e lleva un descargo', () => {
  const sinDescargo = generadores()
    .filter((g) => imprimeCo2e(g.cuerpo) && !llevaDescargo(g.cuerpo))
    .map((g) => g.nombre);

  assert.deepEqual(sinDescargo, [],
    'estos PDF imprimen una cifra de CO2e sin decir que no es una verificación acreditada: '
    + `${sinDescargo.join(', ')}. La ficha comercial afirma que todos lo dicen impreso.`);
});

test('el aviso genérico y el breve dicen lo mismo', () => {
  // Si alguien suaviza uno y no el otro, el documento chico y el grande
  // empiezan a prometer cosas distintas.
  for (const trozo of ['verificación de tercera parte acreditada', 'ISO 14064-3', 'referencial']) {
    assert.ok(SRC.includes(trozo), `el aviso perdió «${trozo}»`);
  }
  const breve = SRC.match(/const AVISO_BREVE\s*=([\s\S]*?);/)?.[1] || '';
  assert.match(breve, /ISO 14064-3/, 'la variante breve tiene que citar la norma igual');
  assert.match(breve, /referencial/i, 'la variante breve tiene que decir que el factor es referencial');
});

test('el generador del adhesivo sigue sin prometer verificación', () => {
  // El adhesivo NO imprime CO2e —a propósito: un número en una camioneta
  // se lee como una calificación—, así que no le toca este descargo. Pero
  // sí lleva el suyo, y si alguien le agrega una cifra este test lo obliga
  // a llevar también el otro.
  const adhesivo = generadores().find((g) => g.nombre === 'generateAdhesivoActivo');
  assert.ok(adhesivo, 'no está generateAdhesivoActivo');
  assert.equal(imprimeCo2e(adhesivo.cuerpo), false,
    'el adhesivo empezó a imprimir CO2e: revisar si corresponde y agregarle el descargo');
  assert.ok(adhesivo.cuerpo.some((l) => /No es autoridad ni certificadora/.test(l)),
    'el adhesivo perdió su descargo propio');
});
