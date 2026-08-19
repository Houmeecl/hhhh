import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { generatePasaporteCarga } from '../src/services/pdf.js';
import { listoParaExportar, semaforoExportacion, glosaExportacion, urgenciaExportacion } from '../src/services/exportacion.js';

// ============================================================
// El pasaporte de exportación: lo que el exportador le manda al comprador
// europeo. Como todo papel que viaja solo, tiene que decir sus límites —y
// sobre todo los tres que se prestan a confusión: que no es la
// declaración del EUDR, que sicr3p no determina deforestación, y que no
// dice dónde está la carga.
// ============================================================

function textoDelPdf(buf) {
  let salida = '';
  const bin = buf.toString('latin1');
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  while ((m = re.exec(bin)) !== null) {
    let crudo;
    try { crudo = zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { continue; }
    for (const t of crudo.matchAll(/<([0-9A-Fa-f\s]+)>/g)) {
      salida += Buffer.from(t[1].replace(/\s/g, ''), 'hex').toString('latin1');
    }
    for (const t of crudo.matchAll(/\(((?:[^()\\]|\\.)*)\)/g)) {
      salida += t[1].replace(/\\([()\\])/g, '$1');
    }
  }
  return salida;
}

const CARGA = {
  id: '33333333-3333-3333-3333-333333333333',
  codigo: 'CB-2026-000042', codigo_nc: '1201', descripcion: 'Soya en grano',
  cantidad: 500, unidad: 't', pais_origen: 'BR',
};
const EXPORTADOR = { nombre_empresa: 'Agro del Sur Ltda.', rut: '76.555.444-3', eori: 'BR1234567', pais: 'BR' };

const PARCELA = {
  id: 'p1', nombre: 'Fazenda Bela Vista', pais: 'BR', region: 'MT',
  area_ha: 120.5, lat: null, lng: null, poligono: { type: 'Polygon', coordinates: [[[-55.7, -12.5]]] },
  nivel_confianza: 3, aporte_pct: 100,
};

const evaluacion = (lote) => {
  const e = listoParaExportar(lote);
  return { ...e, semaforo: semaforoExportacion(e), glosa: glosaExportacion(e), urgencia: urgenciaExportacion(e) };
};

const armar = (over = {}) => generatePasaporteCarga({
  carga: CARGA,
  exportador: EXPORTADOR,
  exportacion: evaluacion({ codigo_nc: '1201', parcelas: [] }),
  parcelas: [PARCELA],
  produccion: null,
  tramo: null,
  documental: null,
  documentos: [],
  ...over,
});

test('el pasaporte imprime el código, el exportador y la mercancía', async () => {
  const texto = textoDelPdf(await armar());
  assert.match(texto, /CB-2026-000042/);
  assert.match(texto, /Agro del Sur/);
  assert.match(texto, /Soya en grano/);
  assert.match(texto, /NC 1201/);
});

test('una carga de soya sin coordenadas muestra la consecuencia del EUDR: prohibición', async () => {
  const texto = textoDelPdf(await armar());
  assert.match(texto, /EUDR/);
  // No es un sobrecosto: es no entrar. El papel no puede mostrar los dos
  // con el mismo peso.
  assert.match(texto, /no se puede comercializar en la UE/);
});

test('declara los tres límites que más se prestan a confusión', async () => {
  const texto = textoDelPdf(await armar());
  assert.match(texto, /L.mites y exclusiones declaradas/);
  assert.match(texto, /NO es la Declaraci.n de Diligencia Debida del EUDR/);
  assert.match(texto, /sicr3p NO determina si un predio fue deforestado/);
  assert.match(texto, /No se registra la posici.n de ning.n veh.culo/);
  assert.match(texto, /El nivel 5 .*no se emite nunca/s);
});

test('dice que la aduana no está cubierta', async () => {
  const texto = textoDelPdf(await armar());
  assert.match(texto, /los ve el agente de\s*aduana/);
});

test('el predio sale con su área y su nivel, y el polígono se declara como tal', async () => {
  const texto = textoDelPdf(await armar());
  assert.match(texto, /Fazenda Bela Vista/);
  assert.match(texto, /Pol.gono/);
  assert.match(texto, /sobre 4 hect.reas exige el pol.gono completo/i);
});

test('sin tramo definido lo dice, en vez de inventar una lista de documentos', async () => {
  const texto = textoDelPdf(await armar());
  assert.match(texto, /Todav.a no se defini. el tramo/);
});

test('con tramo, imprime por dónde va a pasar y qué falta', async () => {
  const texto = textoDelPdf(await armar({
    tramo: {
      puntos: [{ id: 'campo-grande', nombre: 'Campo Grande' }, { id: 'puerto-antofagasta', nombre: 'Puerto Antofagasta' }],
      cruces: [{ pais_desde: 'BR', pais_hasta: 'PY' }, { pais_desde: 'AR', pais_hasta: 'CL' }],
    },
    documental: {
      listo: false, semaforo: 'amarillo',
      items: [
        { tipo_documento: 'factura_comercial', etiqueta: 'Factura comercial', obligatorio: true, cumplido: true, nota: 'Respalda la operación.', por: ['exportación'] },
        { tipo_documento: 'certificado_fitosanitario', etiqueta: 'Certificado fitosanitario', obligatorio: true, cumplido: false, nota: 'Legalidad en origen.', por: ['BR→PY'] },
      ],
    },
    documentos: [{ tipo_documento: 'carta_porte_internacional', eslabon: 7, sha256: 'ab'.repeat(32) }],
  }));
  assert.match(texto, /Campo Grande/);
  assert.match(texto, /Puerto Antofagasta/);
  assert.match(texto, /Certificado fitosanitario/, 'el nombre legible lo manda el backend, no lo arma el PDF');
  assert.match(texto, /Carta de porte internacional/, 'y también para los ya sellados');
  assert.match(texto, /#7/, 'el eslabón del documento sellado');
  assert.match(texto, /NO\s*conserva una copia del archivo/);
});

test('no promete una verificación pública que no existe', async () => {
  const texto = textoDelPdf(await armar());
  // La cadena del Corredor es interna: no hay página pública que abrir.
  assert.match(texto, /no lleva verificaci.n p.blica por QR/);
  assert.ok(!/Escanear para verificar/.test(texto));
});

test('sin código arancelario no se opina: no cae a "exportación" por defecto', async () => {
  const texto = textoDelPdf(await armar({
    carga: { ...CARGA, codigo_nc: null },
    exportacion: evaluacion({ codigo_nc: null }),
  }));
  assert.match(texto, /Falta declarar el c.digo arancelario/);
  assert.ok(!/2023\/1115/.test(texto), 'no se afirma un régimen que todavía no se sabe');
});

// Las fuentes core de PDFKit son WinAnsi: la flecha "→" no existe en esa
// codificación y se imprimía como un "!" en medio de "BR!PY". El mismo
// tropiezo que ya documentaba el "≥" del informe consolidado.
test('no se imprime ningún glifo que WinAnsi no tenga', async () => {
  const texto = textoDelPdf(await armar({
    tramo: {
      puntos: [{ nombre: 'Campo Grande' }, { nombre: 'Puerto Antofagasta' }],
      cruces: [{ pais_desde: 'BR', pais_hasta: 'PY' }],
    },
    documental: { listo: false, semaforo: 'rojo', items: [] },
  }));
  for (const glifo of ['→', '≥', '≤']) {
    assert.ok(!texto.includes(glifo), `el glifo ${JSON.stringify(glifo)} no existe en WinAnsi`);
  }
  assert.match(texto, /cruza BR a PY/);
});
