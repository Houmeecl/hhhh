import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { generateInformeCarbono } from '../src/services/pdf.js';

// PDFKit comprime los content streams con Flate, así que buscar texto en el
// buffer crudo no encuentra nada. Se inflan los streams y se decodifican las
// cadenas de los operadores de texto: PDFKit las emite en hexadecimal
// (`<48656c6c6f>` dentro de un arreglo TJ), y a veces como literal `(...)`.
// Alcanza para aseverar que una frase quedó impresa, sin depender de un
// binario externo como pdftotext.
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

// Informe de contabilidad de carbono a partir de analizarPeriodo() — prueba
// pura de generación de PDF, sin BD. Analisis mínimo con la forma real que
// entrega services/analisisSiiProveedor.js.
const EMPRESA = { id: 'a1b2c3d4-0000-0000-0000-000000000001', nombre_empresa: 'Minería del Norte SpA', rut: '76520943-9' };

const ANALISIS = {
  periodo: '2026-05',
  resumen: {
    compra: { n: 2, neto: 500000, iva: 95000, total: 595000 },
    venta: { n: 1, neto: 1000000, iva: 190000, total: 1190000 },
  },
  por_tipo: {
    compra: [{ tipo_dte: '33', nombre: 'Factura electrónica', n: 2, neto: 500000, iva: 95000, total: 595000 }],
    venta: [{ tipo_dte: '39', nombre: 'Boleta electrónica', n: 0, neto: 1000000, iva: 190000, total: 1190000, resumen: true }],
  },
  concentracion: { compra: [], venta: [] },
  emisiones: {
    total_co2e_tref: 1.2345, documentos_calculados: 2, documentos_totales: 2,
    metodo_fisico: 1, metodo_gasto: 1, referencial: true, motor_version_id: 'v1',
  },
  documentos: [],
};

test('generateInformeCarbono devuelve un PDF válido con los datos del período', async () => {
  const buf = await generateInformeCarbono({ empresa: EMPRESA, periodo: ANALISIS.periodo, analisis: ANALISIS });
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 500, 'el PDF no debería estar vacío');
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
});

test('generateInformeCarbono funciona sin emisiones calculadas (motor sin configurar)', async () => {
  const sinEmisiones = { ...ANALISIS, emisiones: null };
  const buf = await generateInformeCarbono({ empresa: EMPRESA, periodo: ANALISIS.periodo, analisis: sinEmisiones });
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
});

// Regresión de honestidad: el descargo de ISO 14064-3 se había quedado solo
// en la interfaz, mientras la ficha comercial 01 y el dossier corporativo
// afirmaban que "cada informe lo dice de forma impresa". El PDF viaja solo a
// un mandante, un auditor o una autoridad, así que el aviso tiene que ir
// dentro. Si este test falla, hay que corregir esos documentos ANTES de
// quitar el aviso del PDF.
test('generateInformeCarbono imprime el descargo de verificación acreditada', async () => {
  const buf = await generateInformeCarbono({ empresa: EMPRESA, periodo: ANALISIS.periodo, analisis: ANALISIS });
  const texto = textoDelPdf(buf);
  assert.ok(texto.length > 100, 'el extractor debe encontrar texto en el PDF');
  assert.match(texto, /14064-3/, 'el PDF debe citar la norma de verificación que NO cumple');
  assert.match(texto, /referenciales/, 'el PDF debe declarar que los factores son referenciales');
});

test('generateInformeCarbono nunca recibe ni imprime una clave: la firma no acepta ese campo', async () => {
  // La función solo toma { empresa, periodo, analisis } — no hay forma de
  // pasarle una credencial SII aunque quisiéramos; documentamos el contrato.
  const buf = await generateInformeCarbono({ empresa: EMPRESA, periodo: ANALISIS.periodo, analisis: ANALISIS, password: 'no-debiera-usarse' });
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
});

// El desglose por alcance es lo que el mandante o el banco lee primero, así
// que tiene que estar impreso — no solo en pantalla. Incluye la fila
// "Sin clasificar": si se omitiera, los tres alcances no sumarían el total
// y el informe no cuadraría.
test('generateInformeCarbono imprime la tabla de alcances GHG con el saldo sin clasificar', async () => {
  const conAlcances = {
    ...ANALISIS,
    emisiones: {
      ...ANALISIS.emisiones,
      total_co2e_tref: 41.5,
      motor_versiones: [3, 4],
      por_alcance: {
        alcances: [
          { alcance: 1, tco2e: 12.5, n_documentos: 3, categorias: [] },
          { alcance: 2, tco2e: 8, n_documentos: 2, categorias: [] },
          { alcance: 3, tco2e: 19, n_documentos: 4, categorias: [] },
        ],
        sin_clasificar: { tco2e: 2, n_documentos: 1, inferido_por_nombre: 1 },
      },
    },
  };
  const texto = textoDelPdf(await generateInformeCarbono({ empresa: EMPRESA, periodo: ANALISIS.periodo, analisis: conAlcances }));
  assert.match(texto, /Emisiones por alcance/);
  assert.match(texto, /Alcance 1/);
  assert.match(texto, /Alcance 2/);
  assert.match(texto, /Alcance 3/);
  assert.match(texto, /Sin alcance atribuido/, 'el saldo sin alcance no se puede omitir: los alcances no sumarían el total');
  assert.match(texto, /clasificados por el nombre del proveedor/, 'el motivo tiene que estar impreso, no solo el número');
  // Números en formato chileno (coma decimal), como el resto del informe.
  assert.match(texto, /12,50/);
  assert.match(texto, /30,1%/);
  // La versión citada es la ESTAMPADA al calcular, no la vigente al emitir.
  assert.match(texto, /v3, v4/);
  assert.match(texto, /WRI\/WBCSD 2011/, 'las categorías de Alcance 3 tienen que citar su estándar');
});

// Un análisis sin `por_alcance` (períodos descargados antes de la migración
// 076, o el motor sin configurar) tiene que seguir generando el PDF.
test('generateInformeCarbono no exige por_alcance: el informe sale igual sin el desglose', async () => {
  const buf = await generateInformeCarbono({ empresa: EMPRESA, periodo: ANALISIS.periodo, analisis: ANALISIS });
  const texto = textoDelPdf(buf);
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.doesNotMatch(texto, /Emisiones por alcance/);
});

test('generateInformeCarbono imprime el desglose por categoría DENTRO de cada alcance', async () => {
  const conCategorias = {
    ...ANALISIS,
    emisiones: {
      ...ANALISIS.emisiones,
      total_co2e_tref: 20,
      por_alcance: {
        alcances: [
          {
            alcance: 3, tco2e: 20, n_documentos: 4,
            categorias: [
              { codigo: 'materiales', nombre: 'Materiales de construcción', categoria_ghg: 1, categoria_ghg_nombre: 'Bienes y servicios adquiridos', tco2e: 15, n_documentos: 3 },
              { codigo: 'residuos', nombre: 'Gestión de residuos', categoria_ghg: 5, categoria_ghg_nombre: 'Residuos generados en las operaciones', tco2e: 5, n_documentos: 1 },
            ],
          },
        ],
        sin_clasificar: { tco2e: 0, n_documentos: 0 },
      },
    },
  };
  const texto = textoDelPdf(await generateInformeCarbono({ empresa: EMPRESA, periodo: ANALISIS.periodo, analisis: conCategorias }));
  assert.match(texto, /Materiales de construcci/);
  assert.match(texto, /Gesti.n de residuos/);
  assert.match(texto, /Cat\. 1/);
  assert.match(texto, /Cat\. 5/);
});

test('generateInformeCarbono declara límites, exclusiones y el rol de insumo (nunca certificación)', async () => {
  const texto = textoDelPdf(await generateInformeCarbono({ empresa: EMPRESA, periodo: ANALISIS.periodo, analisis: ANALISIS }));
  assert.match(texto, /L.mites y exclusiones declaradas/);
  assert.match(texto, /location-based/);
  assert.match(texto, /sin desglose por gas individual/i);
  assert.match(texto, /Sin a.o base/);
  // El programa HuellaChile reconoce a la empresa titular — nunca a sicr3p.
  assert.match(texto, /HuellaChile/);
  assert.match(texto, /nunca a sicr3p/);
  assert.match(texto, /No constituye certificaci.n/);
  // "INSUMO", no "certificado": el informe se prepara, no acredita.
  assert.match(texto, /INSUMO/);
});
