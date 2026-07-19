import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generarSelloSvg, escapeXml } from '../src/services/sello.js';

const BASE = {
  empresa: 'Comercial Andina SpA',
  t_co2e: 12.34,
  fecha: '2026-07-19',
  nivel_rep: 'alto',
  cadena_intacta: true,
  verificar_url: 'https://app.sicr3p.cl/verificar/abc-123',
  tema: 'claro',
};

test('generarSelloSvg: es un SVG con wordmark sicr3p y las toneladas', () => {
  const svg = generarSelloSvg(BASE);
  assert.ok(svg.startsWith('<svg'), 'empieza con <svg');
  assert.ok(svg.endsWith('</svg>'), 'termina con </svg>');
  assert.ok(svg.includes('sicr3p'), 'lleva el wordmark');
  assert.ok(svg.includes('12.34 t CO2e'), 'lleva las toneladas');
  assert.ok(svg.includes('2026-07-19'), 'lleva la fecha');
  assert.ok(svg.includes('Contabilidad de carbono trazable'), 'lleva el título');
});

test('generarSelloSvg: escapa <script> en el nombre de la empresa', () => {
  const svg = generarSelloSvg({ ...BASE, empresa: '<script>alert(1)</script>' });
  assert.ok(!svg.includes('<script>'), 'no inyecta markup');
  assert.ok(svg.includes('&lt;script&gt;'), 'lo escapa como texto');
});

test('generarSelloSvg: escapa & y comillas en la empresa', () => {
  const svg = generarSelloSvg({ ...BASE, empresa: 'Frutas & "Verduras" S.A.' });
  assert.ok(svg.includes('Frutas &amp; &quot;Verduras&quot; S.A.'));
  assert.ok(!svg.includes('Frutas & "Verduras"'), 'no queda el texto crudo');
});

test('generarSelloSvg: tema oscuro cambia el fondo; claro es blanco', () => {
  const claro = generarSelloSvg(BASE);
  const oscuro = generarSelloSvg({ ...BASE, tema: 'oscuro' });
  assert.ok(claro.includes('#ffffff'), 'claro: fondo blanco');
  assert.ok(claro.includes('#e6e9ed'), 'claro: borde gris');
  assert.ok(oscuro.includes('#0f1f2e'), 'oscuro: fondo oscuro');
  assert.notEqual(claro, oscuro);
});

test('generarSelloSvg: JAMÁS dice "certificado" ni "acreditado"', () => {
  const svg = generarSelloSvg(BASE);
  assert.ok(!/certificad/i.test(svg));
  assert.ok(!/acreditad/i.test(svg));
});

test('generarSelloSvg: chip REP solo si hay nivel', () => {
  const con = generarSelloSvg(BASE);
  const sin = generarSelloSvg({ ...BASE, nivel_rep: null });
  assert.ok(con.includes('REP alto'));
  assert.ok(!sin.includes('REP '));
});

test('generarSelloSvg: cadena de integridad solo con cadena_intacta === true', () => {
  const ok = generarSelloSvg(BASE);
  const roto = generarSelloSvg({ ...BASE, cadena_intacta: false });
  const truco = generarSelloSvg({ ...BASE, cadena_intacta: 'true' });
  assert.ok(ok.includes('cadena de integridad'));
  assert.ok(!roto.includes('cadena de integridad'));
  assert.ok(!truco.includes('cadena de integridad'), 'comparación estricta, no truthy');
});

test('generarSelloSvg: la URL de verificación va sin protocolo', () => {
  const svg = generarSelloSvg(BASE);
  assert.ok(svg.includes('verificable en app.sicr3p.cl/verificar/abc-123'));
  assert.ok(!svg.includes('https://app.sicr3p.cl'));
});

test('generarSelloSvg: trunca nombres de empresa muy largos (~28)', () => {
  const svg = generarSelloSvg({ ...BASE, empresa: 'X'.repeat(60) });
  assert.ok(!svg.includes('X'.repeat(29)), 'no pasa de 28 caracteres');
  assert.ok(svg.includes('X'.repeat(27) + '…'), 'termina con puntos suspensivos');
});

test('escapeXml: escapa los cinco caracteres especiales', () => {
  assert.equal(escapeXml('&'), '&amp;');
  assert.equal(escapeXml('<'), '&lt;');
  assert.equal(escapeXml('>'), '&gt;');
  assert.equal(escapeXml('"'), '&quot;');
  assert.equal(escapeXml("'"), '&apos;');
  assert.equal(escapeXml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;');
});

test('escapeXml: null/undefined → string vacío, números pasan como texto', () => {
  assert.equal(escapeXml(null), '');
  assert.equal(escapeXml(undefined), '');
  assert.equal(escapeXml(12.5), '12.5');
});

test('escapeXml: no doble-escapa por orden correcto del &', () => {
  assert.equal(escapeXml('&lt;'), '&amp;lt;');
});
