import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// La landing pública dice qué documento agrega cada frontera. Esa lista
// vive en el frontend —tiene que verse aunque el Corredor esté apagado en
// el servidor, que es su estado en una instalación nueva— y por lo tanto
// es una SEGUNDA COPIA de lo que siembran las migraciones.
//
// Dos copias de la misma verdad se separan solas. Cuando eso pasa acá, la
// página pública le promete a un exportador una lista de documentos
// distinta de la que el panel le va a exigir, y la primera vez que se
// entera es cuando ya cargó todo. Este archivo hace que la deriva sea un
// test rojo y no una llamada de un cliente.
//
// Se comparan los TIPOS de documento por cruce, no los textos: la
// redacción de la landing es de marketing y la de la migración es
// operativa, y no tienen por qué coincidir palabra por palabra.
// ============================================================

const raiz = path.join(import.meta.dirname, '..');
const leer = (p) => fs.readFileSync(path.join(raiz, p), 'utf8');

const SEED = leer('migrations-corredor/003_corredor_tramo.sql');
const CRUCES = leer('migrations-corredor/004_cruces_por_frontera.sql');
const LANDING = leer('../frontend/src/components/DocumentosPorFrontera.jsx');
// Sin comentarios: el encabezado del componente SÍ nombra a los organismos
// —explica justamente por qué no se nombran en pantalla— y esa explicación
// no puede hacer fallar el caso que vigila lo que el usuario ve.
const LANDING_VISIBLE = LANDING
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

// Los tipos que la migración 003 exige para un par de países dado.
function tiposSembrados(desde, hasta) {
  const re = new RegExp(`\\('${desde}',\\s*'${hasta}',\\s*'([a-z_]+)'`, 'g');
  return [...SEED.matchAll(re)].map((m) => m[1]).sort();
}

// Cómo se llama en pantalla cada slug, según el mapa del backend.
const ETIQUETA = {
  factura_comercial: 'Factura comercial',
  certificado_origen: 'Certificado de origen',
  carta_porte_internacional: 'Carta de porte internacional (CRT)',
  packing_list: 'Lista de empaque',
  certificado_fitosanitario: 'Certificado fitosanitario',
  documento_origen_forestal: 'Documento de origen forestal',
  guia_forestal: 'Guía de circulación forestal',
};

test('la landing nombra los mismos documentos que exige cada cruce definido', () => {
  for (const [desde, hasta] of [['BR', 'PY'], ['PY', 'AR']]) {
    const tipos = tiposSembrados(desde, hasta);
    assert.ok(tipos.length, `la migración no siembra nada para ${desde}→${hasta}`);
    for (const tipo of tipos) {
      const etiqueta = ETIQUETA[tipo];
      assert.ok(etiqueta, `falta la etiqueta de "${tipo}" en este test`);
      assert.ok(
        LANDING.includes(etiqueta),
        `la migración exige "${tipo}" en ${desde}→${hasta} y la landing no lo nombra. `
        + 'La página pública estaría prometiendo una lista distinta de la que el panel exige.'
      );
    }
  }
});

test('la landing nombra lo que se pide en todo tramo', () => {
  const comodines = [...SEED.matchAll(/\('\*',\s*'\*',\s*'([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(comodines.length >= 4);
  for (const tipo of comodines) {
    assert.ok(LANDING.includes(ETIQUETA[tipo]), `falta "${tipo}" en el bloque de todo tramo`);
  }
});

test('un cruce en definición NO aparece en la landing como si exigiera algo', () => {
  // AR→CL tiene reglas sembradas en la 003 pero el cruce está
  // 'en_definicion' en la 004: no se exigen. La landing tiene que
  // reflejar eso, no la tabla de reglas.
  assert.match(CRUCES, /\('AR', 'CL', 'en_definicion'/,
    'si AR→CL pasó a definido, hay que actualizar la landing en el mismo commit');
  assert.match(LANDING, /estado: 'en_incorporacion'/);
  const bloqueArCl = /cruce: 'AR → CL'[\s\S]*?\n  \},/.exec(LANDING)?.[0] || '';
  assert.ok(bloqueArCl, 'no se encontró el bloque AR→CL en la landing');
  assert.match(bloqueArCl, /agrega: \[\]/, 'un cruce sin definir no puede listar exigencias');
  assert.match(bloqueArCl, /no te va a exigir nada/);
});

test('la landing no le atribuye un documento a la autoridad equivocada', () => {
  // Hallazgo de la revisión normativa: el DOF es del IBAMA (vía SINAFLOR),
  // no del MAPA; y el SAG EXIGE el fitosanitario al ingreso pero no lo
  // emite para carga de origen argentino — eso lo emite el SENASA.
  // Ninguna de las dos está confirmada contra fuente primaria todavía,
  // así que la página pública no nombra organismos emisores.
  for (const organismo of ['MAPA', 'IBAMA', 'SENAVE', 'INFONA', 'SAG', 'SENASA']) {
    assert.ok(
      !new RegExp(`\\b${organismo}\\b`).test(LANDING_VISIBLE),
      `la landing nombra a "${organismo}" como emisor y esa atribución no está verificada `
      + 'en fuente primaria. Nombrar mal a una autoridad en una página pública es peor que no nombrarla.'
    );
  }
});

test('la landing declara que esto no es el trámite aduanero', () => {
  assert.match(LANDING, /no\s*\n?\s*es el tr.mite aduanero|Esto no\n/,
    'el límite de alcance tiene que estar impreso, no deducido');
  assert.match(LANDING, /agente de aduana/);
});

test('y que Chile es el destino donde se emite el informe', () => {
  assert.match(LANDING, /Chile es el destino/);
  assert.match(LANDING, /donde se emite el informe/);
});
