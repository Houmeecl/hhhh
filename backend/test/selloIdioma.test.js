import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generarSelloSvg } from '../src/services/sello.js';

// ============================================================
// Sello multilingüe (?lang=en): las etiquetas fijas se traducen, el
// default español queda BYTE A BYTE idéntico al sello original y
// escapeXml sigue aplicándose a todo texto variable.
// ============================================================

const BASE = {
  empresa: 'Comercial Andina SpA',
  t_co2e: 12.34,
  fecha: '2026-07-19',
  nivel_rep: 'alto',
  cadena_intacta: true,
  verificar_url: 'https://app.sicr3p.cl/verificar/abc-123',
  tema: 'claro',
};

test('sello en inglés: lleva las etiquetas EN comprometidas', () => {
  const svg = generarSelloSvg({ ...BASE, lang: 'en' });
  assert.ok(/verifiable carbon accounting/i.test(svg), 'subtítulo en inglés');
  assert.ok(svg.includes('chain intact'), 'estado de la cadena en inglés');
  assert.ok(svg.includes('verify at app.sicr3p.cl/verificar/abc-123'), 'enlace de verificación en inglés');
});

test('sello en inglés: no mezcla español', () => {
  const svg = generarSelloSvg({ ...BASE, lang: 'en' });
  assert.ok(!svg.includes('Contabilidad de carbono trazable'));
  assert.ok(!svg.includes('cadena de integridad'));
  assert.ok(!svg.includes('verificable en'));
  assert.ok(!svg.includes('Sello sicr3p de contabilidad'));
});

test('sello en inglés: los datos (empresa, toneladas, fecha, REP) no cambian', () => {
  const svg = generarSelloSvg({ ...BASE, lang: 'en' });
  assert.ok(svg.includes('Comercial Andina SpA'));
  assert.ok(svg.includes('12.34 t CO2e'));
  assert.ok(svg.includes('2026-07-19'));
  assert.ok(svg.includes('REP alto'));
});

test('el default español queda byte a byte idéntico (sin lang y con lang=es)', () => {
  const original = generarSelloSvg(BASE);
  const explicito = generarSelloSvg({ ...BASE, lang: 'es' });
  assert.equal(original, explicito);
  assert.ok(original.includes('Contabilidad de carbono trazable'));
  assert.ok(original.includes('&#10003; cadena de integridad'));
  assert.ok(original.includes('verificable en app.sicr3p.cl/verificar/abc-123'));
});

test('un lang desconocido cae al español (jamás un sello a medias)', () => {
  assert.equal(generarSelloSvg({ ...BASE, lang: 'pt' }), generarSelloSvg(BASE));
  assert.equal(generarSelloSvg({ ...BASE, lang: null }), generarSelloSvg(BASE));
});

test('escapeXml sigue aplicándose con lang=en', () => {
  const svg = generarSelloSvg({ ...BASE, lang: 'en', empresa: '<script>alert(1)</script>' });
  assert.ok(!svg.includes('<script>'), 'no inyecta markup');
  assert.ok(svg.includes('&lt;script&gt;'), 'lo escapa como texto');
});

test('el sello EN tampoco dice "certified" ni "accredited" (honestidad en ambos idiomas)', () => {
  const svg = generarSelloSvg({ ...BASE, lang: 'en' });
  assert.ok(!/certif/i.test(svg));
  assert.ok(!/accredit/i.test(svg));
  assert.ok(!/official/i.test(svg));
});
