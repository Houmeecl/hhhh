import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {
  esAtribuible, categoriaParaMostrar, alcanceAtribuible, SIN_CLASIFICAR,
} from '../src/services/categoriaPresentacion.js';
import { generateReport, generateLabel } from '../src/services/pdf.js';

// ============================================================
// La regla de atribución de categoría y su efecto en los PDF.
//
// El motor, cuando ninguna palabra clave calza con la glosa de los ítems,
// devuelve su catch-all. Ese código sirve para calcular pero NO es una
// clasificación del documento: presentarlo con la misma cara que una
// atribución calculada es indistinguible de un dato, y estos informes se
// pegan en memorias anuales bajo NCG 461 / IFRS S2.
//
// El informe consolidado es la superficie de mayor distribución: es público
// sin autenticación y va ADJUNTO AL CORREO de cada carga.
// ============================================================

// Extrae el texto de un PDF de PDFKit: streams zlib con cadenas hex <...> y
// literales (...). Mismo patrón que test/informeCarbono.test.js.
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
      continue; // no todos los streams son texto comprimido (fuentes, imágenes)
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
  { codigo: 'servicios', nombre: 'Servicios', alcance_ghg: 'Alcance 3 · Cat. 1 — Bienes y servicios adquiridos' },
];

const factura = (over) => ({
  id: '22222222-2222-2222-2222-222222222222',
  numero_venta: 'F-1', archivo_original: 'f.pdf', total_co2e: 3.5,
  items: [{ descripcion: 'x', cantidad: 1, co2e: 3.5, porcentaje_total: 100 }],
  ...over,
});

// ---------- La regla ----------

test('solo glosa, xml y operador son atribuibles', () => {
  assert.equal(esAtribuible('glosa'), true);
  assert.equal(esAtribuible('xml'), true);
  assert.equal(esAtribuible('operador'), true);
  assert.equal(esAtribuible('sin_coincidencia'), false);
  assert.equal(esAtribuible('razon_social'), false);
  assert.equal(esAtribuible('sin_categoria'), false);
  assert.equal(esAtribuible(null), false, 'anterior a la migración 077: no consta de dónde salió');
  assert.equal(esAtribuible(undefined), false);
});

test('el detalle conserva el nombre marcado; el agregado no acumula bajo el catch-all', () => {
  const catchAll = categoriaParaMostrar({ categoria: 'Servicios', categoria_origen: 'sin_coincidencia' });
  assert.equal(catchAll.confirmada, false);
  assert.match(catchAll.detalle, /^Servicios/, 'el cliente puede ver con qué factor se calculó');
  assert.match(catchAll.detalle, /sin confirmar/);
  assert.equal(catchAll.agregado, SIN_CLASIFICAR, 'en el donut NO engorda la porción "Servicios"');

  const real = categoriaParaMostrar({ categoria: 'Energía eléctrica', categoria_origen: 'glosa' });
  assert.equal(real.confirmada, true);
  assert.equal(real.detalle, 'Energía eléctrica');
  assert.equal(real.agregado, 'Energía eléctrica');
});

test('sin categoría del todo: "Sin clasificar" en ambos', () => {
  const nada = categoriaParaMostrar({ categoria: null, categoria_origen: null });
  assert.equal(nada.detalle, SIN_CLASIFICAR);
  assert.equal(nada.agregado, SIN_CLASIFICAR);
});

test('el alcance GHG solo sale cuando la categoría es atribuible', () => {
  const alc = 'Alcance 1 — Emisiones directas';
  assert.equal(alcanceAtribuible({ categoria_origen: 'glosa' }, alc), alc);
  assert.equal(alcanceAtribuible({ categoria_origen: 'sin_coincidencia' }, alc), null);
  assert.equal(alcanceAtribuible({ categoria_origen: null }, alc), null);
});

// ---------- El informe consolidado (público + correo) ----------

test('generateReport NO imprime alcance del catch-all, y declara lo que quedó fuera', async () => {
  const pdf = await generateReport({
    sesion: SESION,
    facturas: [factura({ categoria: 'Servicios', categoria_codigo: 'servicios', categoria_origen: 'sin_coincidencia' })],
    declaracion: null,
    alcances: ALCANCES,
  });
  const texto = textoDelPdf(pdf);
  assert.ok(!texto.includes('Alcances del período'), 'un catch-all no aporta alcance al período');
  assert.match(texto, /no pudo clasificarse/, 'y no se esconde: su CO2e sí está en el total');
});

test('generateReport SÍ imprime el alcance de una categoría deducida de la glosa', async () => {
  const pdf = await generateReport({
    sesion: SESION,
    facturas: [factura({ categoria: 'Energía eléctrica', categoria_codigo: 'electricidad', categoria_origen: 'glosa' })],
    declaracion: null,
    alcances: ALCANCES,
  });
  const texto = textoDelPdf(pdf);
  assert.match(texto, /Alcances del período/);
  assert.match(texto, /Alcance 2/);
  assert.ok(!texto.includes('no pudo clasificarse'));
});

// El join del informe era por NOMBRE contra `motor_categorias.nombre`, que se
// edita desde el panel del motor: renombrar una categoría sacaba su alcance del
// informe sin aviso. Ahora resuelve por código, con respaldo por nombre.
test('renombrar la categoría en el panel no borra el alcance del informe', async () => {
  const alcancesRenombrados = [
    { codigo: 'electricidad', nombre: 'Electricidad (renombrada)', alcance_ghg: 'Alcance 2 — Electricidad comprada' },
  ];
  const pdf = await generateReport({
    sesion: SESION,
    facturas: [factura({ categoria: 'Energía eléctrica', categoria_codigo: 'electricidad', categoria_origen: 'glosa' })],
    declaracion: null,
    alcances: alcancesRenombrados,
  });
  assert.match(textoDelPdf(pdf), /Alcance 2/);
});

test('la tarjeta "Categorías identificadas" cuenta cero cuando ninguna lo es', async () => {
  const pdf = await generateReport({
    sesion: SESION,
    facturas: [factura({ categoria: 'Servicios', categoria_codigo: 'servicios', categoria_origen: 'sin_coincidencia' })],
    declaracion: null,
    alcances: ALCANCES,
  });
  const texto = textoDelPdf(pdf);
  const i = texto.indexOf('CATEGOR');
  assert.ok(i >= 0, 'la tarjeta existe');
  assert.match(texto.slice(i, i + 40), /0/, 'cero categorías identificadas, no una redondeada hacia arriba');
});

// ---------- La etiqueta impresa ----------

test('generateLabel marca la categoría no confirmada', async () => {
  const pdf = await generateLabel({
    factura: factura({ categoria: 'Servicios', categoria_origen: 'sin_coincidencia' }),
    sesion: SESION,
  });
  assert.match(textoDelPdf(pdf), /sin confirmar/);
});
