import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'zlib';
import {
  leerCsv, detectarSeparador, desescaparXml, columnaDeRef, normalizarClave,
  mapearColumnas, detectarColumnas, tieneEncabezado, proponerMapeo, primerEmail,
  leerTabla, leerXlsx,
} from '../src/services/tabla.js';

// ============================================================
// El lector de planillas. Los casos NO son inventados: salen de la
// planilla real que motivó todo esto — una base de contactos de ferias
// con 6 pestañas, ~15.000 filas, tres hojas SIN encabezado y hasta tres
// columnas de correo por fila.
// ============================================================

// ---------- CSV ----------

test('el separador se detecta por la primera línea, no se asume la coma', () => {
  // Excel en es-CL exporta con `;` porque la coma es el decimal.
  assert.equal(detectarSeparador('empresa;rut;correo\nA;1-9;a@b.cl'), ';');
  assert.equal(detectarSeparador('empresa,rut,correo'), ',');
  assert.equal(detectarSeparador('empresa\trut\tcorreo'), '\t');
  // Una coma DENTRO de comillas no cuenta: es parte de la razón social.
  assert.equal(detectarSeparador('"Transportes Ángel, González";a@b.cl'), ';');
});

test('el CSV respeta comillas, comas internas y saltos de línea', () => {
  const filas = leerCsv('empresa;correo\n"Ríos, Pérez y Cía.";a@b.cl\n"Dos\nlíneas";c@d.cl');
  assert.equal(filas.length, 3);
  assert.deepEqual(filas[1], ['Ríos, Pérez y Cía.', 'a@b.cl']);
  assert.equal(filas[2][0], 'Dos\nlíneas');
});

test('el CSV soporta comillas escapadas y el BOM que pone Excel', () => {
  const filas = leerCsv('﻿a;b\n"dice ""hola""";x');
  assert.deepEqual(filas[0], ['a', 'b'], 'el BOM no debe pegarse a la primera columna');
  assert.equal(filas[1][0], 'dice "hola"');
});

// ---------- XML ----------

test('las entidades XML se desescapan, incluidas las numéricas', () => {
  assert.equal(desescaparXml('R&amp;M &lt;S.A.&gt;'), 'R&M <S.A.>');
  assert.equal(desescaparXml('&#193;ngel &#x41;'), 'Ángel A');
  // Una entidad desconocida se deja como está en vez de comerse el texto.
  assert.equal(desescaparXml('&noexiste;'), '&noexiste;');
});

test('la referencia de celda se traduce a índice de columna', () => {
  assert.equal(columnaDeRef('A1'), 0);
  assert.equal(columnaDeRef('Z9'), 25);
  assert.equal(columnaDeRef('AA1'), 26);
  assert.equal(columnaDeRef('BC12'), 54);
  assert.equal(columnaDeRef(''), -1);
});

// ---------- xlsx armado a mano ----------

// Un .xlsx mínimo pero REAL: ZIP con directorio central, deflate y
// sharedStrings. Se construye acá para no versionar un binario y para
// que el test falle si el lector deja de entender el formato.
function xlsxDePrueba(hojas, compartidas) {
  const archivos = [
    ['xl/workbook.xml', `<workbook><sheets>${hojas
      .map((h, i) => `<sheet name="${h.nombre}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<Relationships>${hojas
      .map((h, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`],
    ['xl/sharedStrings.xml', `<sst>${compartidas.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`],
    ...hojas.map((h, i) => [`xl/worksheets/sheet${i + 1}.xml`, `<worksheet><sheetData>${h.xml}</sheetData></worksheet>`]),
  ];

  const locales = [];
  const central = [];
  let off = 0;
  for (const [nombre, texto] of archivos) {
    const crudo = Buffer.from(texto, 'utf8');
    const comp = zlib.deflateRawSync(crudo);
    const n = Buffer.from(nombre, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(crudo.length, 22);
    lh.writeUInt16LE(n.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(crudo.length, 24);
    cd.writeUInt16LE(n.length, 28); cd.writeUInt32LE(off, 42);
    central.push(Buffer.concat([cd, n]));
    locales.push(Buffer.concat([lh, n, comp]));
    off += 30 + n.length + comp.length;
  }
  const cuerpo = Buffer.concat(locales);
  const dir = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(archivos.length, 8); eocd.writeUInt16LE(archivos.length, 10);
  eocd.writeUInt32LE(dir.length, 12); eocd.writeUInt32LE(cuerpo.length, 16);
  return Buffer.concat([cuerpo, dir, eocd]);
}

const fila = (n, celdas) => `<row r="${n}">${celdas.map(([ref, t, v]) =>
  `<c r="${ref}"${t ? ` t="${t}"` : ''}><v>${v}</v></c>`).join('')}</row>`;

test('lee un .xlsx: ZIP, deflate y cadenas compartidas', () => {
  const buf = xlsxDePrueba([{
    nombre: 'Contactos',
    xml: fila(1, [['A1', 's', 0], ['B1', 's', 1]]) + fila(2, [['A2', 's', 2], ['B2', null, 42]]),
  }], ['Empresa', 'Correo', 'Aceros SpA']);
  const { hojas, hoja, filas } = leerTabla(buf);
  assert.deepEqual(hojas, ['Contactos']);
  assert.equal(hoja, 'Contactos');
  assert.deepEqual(filas[0], ['Empresa', 'Correo']);
  assert.deepEqual(filas[1], ['Aceros SpA', '42']);
});

test('una celda vacía no corre las siguientes: se respeta el atributo r', () => {
  // Excel OMITE las celdas vacías. Sin leer `r`, la fila sin RUT dejaba
  // el correo un lugar a la izquierda y se importaba la columna errónea.
  const buf = xlsxDePrueba([{
    nombre: 'H', xml: fila(1, [['A1', 's', 0], ['C1', 's', 1]]),
  }], ['Aceros', 'a@b.cl']);
  const { filas } = leerXlsx(buf);
  assert.equal(filas[0][0], 'Aceros');
  assert.equal(filas[0][1], '', 'la columna B saltada debe quedar vacía, no desaparecer');
  assert.equal(filas[0][2], 'a@b.cl');
});

test('se puede elegir la pestaña por nombre y se salta la vacía al abrir', () => {
  const buf = xlsxDePrueba([
    { nombre: 'Hoja 1', xml: '' }, // la pestaña vacía intercalada del archivo real
    { nombre: 'Chile_Hispanos', xml: fila(1, [['A1', 's', 0]]) },
  ], ['dato']);
  // Sin pedir hoja: no debe abrir en la vacía y dar la impresión de que
  // el archivo no se pudo leer.
  assert.equal(leerTabla(buf).hoja, 'Chile_Hispanos');
  assert.equal(leerTabla(buf, { hoja: 'Hoja 1' }).filas.length, 0);
  assert.throws(() => leerTabla(buf, { hoja: 'No existe' }), /no tiene una hoja/);
});

test('un .xls antiguo se explica, no revienta con un error de ZIP', () => {
  const ole2 = Buffer.alloc(16);
  ole2.writeUInt32BE(0xd0cf11e0, 0);
  assert.throws(() => leerTabla(ole2), /\.xls antiguo/);
});

// ---------- encabezados y detección ----------

test('los encabezados se reconocen con tildes, puntos y mayúsculas', () => {
  // Los puntos separan: "R.U.T." queda "r u t". No se colapsa a "rut" a
  // propósito —hacerlo pegaría letras de cualquier sigla—, por eso la
  // lista de alias incluye la forma separada.
  assert.equal(normalizarClave('R.U.T. Empresa'), 'r u t empresa');
  assert.equal(mapearColumnas(['R.U.T.', 'Correo']).rut, 0);
  assert.equal(normalizarClave('Correo electrónico'), 'correo electronico');
  const m = mapearColumnas(['Pertenece a:', 'Empresa', 'PAIS', 'idioma', 'Contacto', 'Cargo ', 'Correo 1']);
  assert.equal(m.empresa, 1);
  assert.equal(m.contacto, 4);
  assert.equal(m.email, 6);
});

test('la coincidencia exacta le gana a la parcial: "Nombre" no le roba la columna a "Nombre contacto"', () => {
  const m = mapearColumnas(['Nombre', 'Nombre contacto', 'Correo']);
  assert.equal(m.empresa, 0);
  assert.equal(m.contacto, 1);
});

test('la fila 1 es encabezado solo si no trae correos', () => {
  assert.equal(tieneEncabezado([['Empresa', 'Contacto', 'Correo 1']]), true);
  // Caso de tres de las seis pestañas reales: la fila 1 ya es un dato.
  assert.equal(tieneEncabezado([['Aceros SpA', 'Jorge Romero', 'jromero@aceros.cl']]), false);
});

test('sin encabezado, el correo se detecta por el arroba', () => {
  const filas = [
    ['SICEP', 'Aceros SpA', 'Chile', 'jromero@aceros.cl'],
    ['SICEP', 'Maderas Ltda', 'Chile', 'vparra@maderas.cl'],
    ['SICEP', 'Vidrios SA', 'Chile', 'info@vidrios.cl'],
  ];
  assert.equal(detectarColumnas(filas).email, 3);
});

test('empresa se distingue del rubro repetido por la razón de valores distintos', () => {
  // Columna 0 = feria de origen, repetida en miles de filas.
  // Columna 1 = la empresa, distinta en cada una. Sin este criterio se
  // importaba "Aguas Latinoamerica" como razón social de todo el mundo.
  const filas = Array.from({ length: 30 }, (_, i) =>
    ['Aguas Latinoamerica', `Empresa ${i}`, 'Chile', `c${i}@x.cl`]);
  const m = detectarColumnas(filas);
  assert.equal(m.empresa, 1);
});

test('la columna País no se confunde con el contacto', () => {
  // "Chile" es texto corto y poblado igual que un nombre; lo que las
  // separa es que un país se repite y un nombre de persona no.
  const filas = Array.from({ length: 30 }, (_, i) =>
    ['Feria', `Empresa ${i}`, 'Chile', 'Español', `Persona ${i}`, `c${i}@x.cl`]);
  const m = detectarColumnas(filas);
  assert.notEqual(m.contacto, 2, 'la columna 2 es el país, no el contacto');
  assert.equal(m.contacto, 4);
});

test('un teléfono chileno no se importa como RUT', () => {
  // El bug real: un fono chileno calzaba con un patrón de forma. Ahora
  // se exige que el dígito verificador cuadre.
  const conFono = Array.from({ length: 20 }, (_, i) =>
    [`Empresa ${i}`, `c${i}@x.cl`, '56 2 2222 3333']);
  assert.equal(detectarColumnas(conFono).rut, undefined);

  const conRut = Array.from({ length: 20 }, (_, i) =>
    [`Empresa ${i}`, `c${i}@x.cl`, '11.111.111-1']);
  assert.equal(detectarColumnas(conRut).rut, 2);
});

test('las filas vacías con formato no tapan la detección', () => {
  // Pestaña real: 30 contactos arriba y ~970 filas vacías debajo.
  const filas = [
    ...Array.from({ length: 10 }, (_, i) => [`Empresa ${i}`, `Persona ${i}`, `c${i}@x.cl`]),
    ...Array.from({ length: 300 }, () => ['', '', '']),
  ];
  const m = detectarColumnas(filas);
  assert.equal(m.email, 2);
  assert.equal(m.empresa, 0);
});

test('primerEmail saca la primera dirección de una celda con varias', () => {
  assert.equal(primerEmail('a@x.cl / b@y.cl'), 'a@x.cl');
  assert.equal(primerEmail('  INFO@Aceros.CL  '), 'info@aceros.cl');
  assert.equal(primerEmail('Fono NO contesta'), null);
  assert.equal(primerEmail(''), null);
});

test('proponerMapeo usa el contenido cuando el encabezado no nombra el correo', () => {
  const filas = [
    ['Empresa', 'Contacto', '@'],
    ['Aceros', 'Jorge', 'j@aceros.cl'],
    ['Maderas', 'Ana', 'a@maderas.cl'],
  ];
  const p = proponerMapeo(filas);
  assert.equal(p.encabezado, true);
  assert.equal(p.desde, 1);
  assert.equal(p.mapeo.email, 2, 'el título "@" no calza con ningún alias, pero el contenido sí');
});

test('una planilla que se descomprime a un tamaño desproporcionado se rechaza', () => {
  // Zip bomb: deflate llega a ~1000:1, así que unos pocos MB subidos por
  // alguien de afuera se vuelven decenas de GB al inflarlos. Sin techo,
  // `inflateRawSync` no falla la petición: tumba el proceso entero.
  const ceros = Buffer.alloc(400 * 1024 * 1024);
  const comp = zlib.deflateRawSync(ceros);
  const nombre = Buffer.from('xl/worksheets/sheet1.xml', 'utf8');

  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8);
  lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(ceros.length, 22);
  lh.writeUInt16LE(nombre.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(ceros.length, 24);
  cd.writeUInt16LE(nombre.length, 28); cd.writeUInt32LE(0, 42);
  const cuerpo = Buffer.concat([lh, nombre, comp]);
  const dir = Buffer.concat([cd, nombre]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(dir.length, 12); eocd.writeUInt32LE(cuerpo.length, 16);

  assert.throws(() => leerTabla(Buffer.concat([cuerpo, dir, eocd])), /desproporcionado/);
});
