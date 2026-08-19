import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { generateReport } from '../src/services/pdf.js';

// ============================================================
// El informe mensual es el documento que se VENDE. Un tercero —
// verificador, mandante, banco— lo va a leer sin poder preguntarle nada
// a quien lo generó, así que sus límites tienen que estar impresos, no
// deducidos de lo que el informe calla.
//
// Los otros PDF de sicr3p (informe SII, transporte, CBAM) ya traían el
// bloque "Límites y exclusiones declaradas"; el principal no lo tenía.
// Este test existe para que no se vuelva a caer.
// ============================================================

function textoDelPdf(buf) {
  let salida = '';
  const bin = buf.toString('latin1');
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  while ((m = re.exec(bin)) !== null) {
    let crudo;
    try {
      crudo = zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1');
    } catch {
      continue;
    }
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
  nombre_cliente: 'Empresa de Prueba',
  rut_cliente: '76.123.456-0',
  fecha: new Date('2026-06-15T12:00:00Z'),
};

const ALCANCES = [
  { codigo: 'electricidad', nombre: 'Energía eléctrica', alcance_ghg: 'Alcance 2 — Electricidad comprada' },
];

// Sin hash_cadena a propósito: así generateReport no llama a
// verificarCadenaGlobal() y el test no toca la base.
const FACTURA = {
  id: '22222222-2222-2222-2222-222222222222',
  numero_venta: 'F-1',
  archivo_original: 'f.pdf',
  total_co2e: 3.5,
  categoria: 'Energía eléctrica',
  categoria_codigo: 'electricidad',
  categoria_origen: 'glosa',
  items: [{ descripcion: 'Suministro eléctrico', cantidad: 1 }],
};

test('el informe mensual imprime sus límites y exclusiones', async () => {
  const pdf = await generateReport({
    sesion: SESION, facturas: [FACTURA], declaracion: null, alcances: ALCANCES,
  });
  const texto = textoDelPdf(pdf);

  assert.match(texto, /L.mites y exclusiones declaradas/);
  // Los cuatro límites que un verificador busca primero.
  assert.match(texto, /location-based/, 'Alcance 2: hay que decir con qué enfoque se calculó');
  assert.match(texto, /market-based/, 'y decir explícitamente cuál NO se aplicó');
  assert.match(texto, /sin desglose por gas individual/i);
  assert.match(texto, /Sin a.o base/i);
  assert.match(texto, /congelada al momento del c.lculo/,
    'el informe no cambia si después se editan los factores: eso hay que decirlo');
});

test('sin declaración de embalaje no se declara un límite REP que no aplica', async () => {
  const pdf = await generateReport({
    sesion: SESION, facturas: [FACTURA], declaracion: null, alcances: ALCANCES,
  });
  const texto = textoDelPdf(pdf);
  assert.ok(!/REP Ley 20.920/.test(texto), 'no hay declaración REP en este informe');
});

test('con declaración de embalaje se declara que sicr3p la sella pero no la verifica', async () => {
  const pdf = await generateReport({
    sesion: SESION,
    facturas: [FACTURA],
    declaracion: {
      nivel: 'Alto', porcentaje: 72, peso_total_gr: 1000, peso_reciclable_gr: 720,
      componentes: [{ material: 'carton', peso_gr: 1000, cantidad: 1, reciclable: true }],
    },
    alcances: ALCANCES,
  });
  const texto = textoDelPdf(pdf);
  assert.match(texto, /L.mites y exclusiones declaradas/);
  assert.match(texto, /la registra y la sella, no la verifica en terreno/);
});
