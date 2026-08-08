import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {
  esAtribuible, categoriaParaMostrar, alcanceAtribuible, SIN_CLASIFICAR,
} from '../src/services/categoriaPresentacion.js';
import { generateReport, generateLabel, generateCarpetaMandante } from '../src/services/pdf.js';

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

// ---------- El tercer estado: procedencia no registrada ----------
//
// Hoy es el 100% de las facturas de producción (129/129 con categoria_origen
// NULL): los documentos anteriores a la migración 077 y los del motor externo,
// que no informa procedencia. De ellos NO consta que haya fallado una
// clasificación — decir "no pudo clasificarse" es afirmar un hecho que no
// ocurrió, y el mismo PDF imprime más arriba la glosa del ítem.

test('NULL no es lo mismo que catch-all: son dos estados distintos', () => {
  const nulo = categoriaParaMostrar({ categoria: 'Energía eléctrica', categoria_origen: null });
  assert.equal(nulo.estado, 'sin_procedencia');
  assert.match(nulo.detalle, /procedencia no registrada/);
  assert.ok(!nulo.detalle.includes('sin confirmar'), 'no consta que el motor haya intentado y fallado');

  const catchAll = categoriaParaMostrar({ categoria: 'Servicios', categoria_origen: 'sin_coincidencia' });
  assert.equal(catchAll.estado, 'sin_confirmar');

  // Ninguno de los dos gana alcance ni engorda el donut.
  for (const c of [nulo, catchAll]) assert.equal(c.agregado, SIN_CLASIFICAR);
});

test('el informe NO dice "no pudo clasificarse" de un documento sin procedencia', async () => {
  const pdf = await generateReport({
    sesion: SESION,
    facturas: [factura({ categoria: 'Energía eléctrica', categoria_codigo: 'electricidad', categoria_origen: null })],
    declaracion: null,
    alcances: ALCANCES,
  });
  const texto = textoDelPdf(pdf);
  assert.ok(!texto.includes('no pudo clasificarse'), 'el motor externo sí clasificó; lo que falta es de dónde salió');
  assert.match(texto, /no registra/, 'y se declara, con su causa real');
  assert.ok(!texto.includes('Alcances del período'), 'sigue sin afirmarse un alcance');
});

test('la tarjeta de categorías dice "—", no cero, cuando lo único que hay es procedencia sin registrar', async () => {
  const pdf = await generateReport({
    sesion: SESION,
    facturas: [factura({ categoria: 'Energía eléctrica', categoria_codigo: 'electricidad', categoria_origen: null })],
    declaracion: null,
    alcances: ALCANCES,
  });
  const texto = textoDelPdf(pdf);
  const i = texto.indexOf('CATEGOR');
  assert.ok(i >= 0);
  const tarjeta = texto.slice(i, i + 40);
  assert.ok(!/\b0\b/.test(tarjeta), 'cero afirmaría que no se identificó ninguna, y eso no consta');
  assert.match(texto, /SIN REGISTRAR/i);
});

test('las dos causas se cuentan por separado en la misma nota', async () => {
  const pdf = await generateReport({
    sesion: SESION,
    facturas: [
      factura({ id: 'a', categoria: 'Servicios', categoria_codigo: 'servicios', categoria_origen: 'sin_coincidencia' }),
      factura({ id: 'b', categoria: 'Energía eléctrica', categoria_codigo: 'electricidad', categoria_origen: null }),
    ],
    declaracion: null,
    alcances: ALCANCES,
  });
  const texto = textoDelPdf(pdf);
  assert.match(texto, /1 documento no pudo clasificarse/);
  assert.match(texto, /1 documento no registra/);
});

// ---------- La carpeta que se entrega en papel al mandante ----------

test('generateCarpetaMandante marca la categoría no confirmada', async () => {
  const pdf = await generateCarpetaMandante({
    sesion: SESION,
    facturas: [factura({ categoria: 'Servicios', categoria_origen: 'sin_coincidencia' })],
    declaracion: null,
    contrapartes: null,
  });
  assert.match(textoDelPdf(pdf), /sin confirmar/);
});
