import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDte, rutValido } from '../src/services/dte.js';

const DTE_EJEMPLO = `<?xml version="1.0" encoding="ISO-8859-1"?>
<DTE version="1.0">
  <Documento ID="F1234T33">
    <Encabezado>
      <IdDoc><TipoDTE>33</TipoDTE><Folio>1234</Folio><FchEmis>2026-06-15</FchEmis></IdDoc>
      <Emisor>
        <RUTEmisor>76123456-0</RUTEmisor>
        <RznSoc>Minera del Norte SpA</RznSoc>
        <GiroEmis>Extracción de cobre</GiroEmis>
      </Emisor>
      <Receptor>
        <RUTRecep>11111111-1</RUTRecep>
        <RznSocRecep>Prueba Capital SpA</RznSocRecep>
      </Receptor>
      <Totales><MntNeto>100000</MntNeto><IVA>19000</IVA><MntTotal>119000</MntTotal></Totales>
    </Encabezado>
    <Detalle><NmbItem>Suministro eléctrico</NmbItem><QtyItem>2500</QtyItem><UnmdItem>kWh</UnmdItem><PrcItem>28</PrcItem><MontoItem>70000</MontoItem></Detalle>
    <Detalle><NmbItem>Cargo por potencia</NmbItem><QtyItem>1</QtyItem><PrcItem>30000</PrcItem><MontoItem>30000</MontoItem></Detalle>
    <TmstFirma>2026-06-15T10:00:00</TmstFirma>
  </Documento>
</DTE>`;

test('parseDte extrae encabezado, emisor, receptor y totales', () => {
  const d = parseDte(DTE_EJEMPLO);
  assert.equal(d.tipo_dte, 33);
  assert.equal(d.tipo_nombre, 'Factura electrónica');
  assert.equal(d.folio, '1234');
  assert.equal(d.fecha_emision, '2026-06-15');
  assert.equal(d.rut_emisor, '76123456-0');
  assert.equal(d.razon_social_emisor, 'Minera del Norte SpA');
  assert.equal(d.rut_receptor, '11111111-1');
  assert.equal(d.monto_total, 119000);
  assert.equal(d.items.length, 2);
  assert.equal(d.items[0].nombre, 'Suministro eléctrico');
  assert.equal(d.items[0].cantidad, 2500);
});

test('parseDte verifica RUT, totales y detalle', () => {
  const d = parseDte(DTE_EJEMPLO);
  assert.equal(d.verificaciones.rut_emisor_valido, true);
  assert.equal(d.verificaciones.rut_receptor_valido, true);
  assert.equal(d.verificaciones.totales_consistentes, true);   // 100000+19000 = 119000
  assert.equal(d.verificaciones.detalle_consistente, true);    // 70000+30000 = 100000
  assert.equal(d.verificaciones.firma_presente, true);
  assert.equal(d.verificacion_ok, true);
});

test('parseDte detecta totales inconsistentes y RUT inválido', () => {
  const malo = DTE_EJEMPLO
    .replace('<MntTotal>119000</MntTotal>', '<MntTotal>150000</MntTotal>')
    .replace('<RUTEmisor>76123456-0</RUTEmisor>', '<RUTEmisor>76123456-7</RUTEmisor>');
  const d = parseDte(malo);
  assert.equal(d.verificaciones.totales_consistentes, false);
  assert.equal(d.verificaciones.rut_emisor_valido, false);
  assert.equal(d.verificacion_ok, false);
});

test('parseDte devuelve null si no es un DTE', () => {
  assert.equal(parseDte('<html>hola</html>'), null);
  assert.equal(parseDte(''), null);
  assert.equal(parseDte(null), null);
});

// ============================================================
// Guía de despacho (tipo 52): trae un bloque <Transporte> que el resto de
// los DTE no tiene — patente del vehículo y destino físico del despacho,
// que puede no ser la dirección tributaria del receptor.
// ============================================================

const GUIA_EJEMPLO = `<?xml version="1.0" encoding="ISO-8859-1"?>
<DTE version="1.0">
  <Documento ID="G1T52">
    <Encabezado>
      <IdDoc><TipoDTE>52</TipoDTE><Folio>77</Folio><FchEmis>2026-06-15</FchEmis></IdDoc>
      <Emisor>
        <RUTEmisor>76123456-0</RUTEmisor>
        <RznSoc>Minera del Norte SpA</RznSoc>
        <DirEmisor>Camino Industrial 500</DirEmisor>
      </Emisor>
      <Receptor>
        <RUTRecep>11111111-1</RUTRecep>
        <RznSocRecep>Prueba Capital SpA</RznSocRecep>
        <DirRecep>Bodega Central 10</DirRecep>
      </Receptor>
      <Transporte>
        <Patente>ABCD12</Patente>
        <RUTTrans>76999888-1</RUTTrans>
        <DirDest>Faena Norte, camino a Calama km 12</DirDest>
        <CmnaDest>Calama</CmnaDest>
      </Transporte>
      <Totales><MntTotal>0</MntTotal></Totales>
    </Encabezado>
    <Detalle><NmbItem>Concentrado de cobre</NmbItem><QtyItem>20</QtyItem><UnmdItem>ton</UnmdItem></Detalle>
  </Documento>
</DTE>`;

test('parseDte extrae patente y destino de una guía de despacho (tipo 52)', () => {
  const d = parseDte(GUIA_EJEMPLO);
  assert.equal(d.tipo_dte, 52);
  assert.equal(d.tipo_nombre, 'Guía de despacho');
  assert.equal(d.patente, 'ABCD12');
  assert.equal(d.direccion_origen, 'Camino Industrial 500');
  assert.equal(d.direccion_destino, 'Faena Norte, camino a Calama km 12, Calama');
});

test('parseDte: sin bloque <Transporte> (factura normal), patente y direcciones quedan null/desde el receptor', () => {
  const d = parseDte(DTE_EJEMPLO);
  assert.equal(d.patente, null);
  assert.equal(d.direccion_origen, null); // DTE_EJEMPLO no trae <DirEmisor>
  assert.equal(d.direccion_destino, null); // ni <DirRecep>
});

test('parseDte: destino cae a DirRecep si la guía no trae <DirDest> (sin bloque Transporte separado)', () => {
  const guiaSinTransporte = GUIA_EJEMPLO.replace(
    /<Transporte>[\s\S]*?<\/Transporte>/,
    ''
  );
  const d = parseDte(guiaSinTransporte);
  assert.equal(d.patente, null);
  assert.equal(d.direccion_destino, 'Bodega Central 10');
});

// ============================================================
// tag()/tags() deben ser O(n), no O(n²) — un XML con muchas aperturas
// del mismo tag sin cerrar (subido por cualquier proveedor autenticado
// vía routes/informes.js, lecturaDocumento.js o transporteProveedor.js)
// no debe poder bloquear el event loop de Node.
// ============================================================

test('parseDte no se cuelga con miles de tags sin cerrar (O(n), no O(n²))', () => {
  const aperturasSinCerrar = '<Encabezado>'.repeat(50000);
  const malicioso = `<DTE><Documento>${aperturasSinCerrar}<IdDoc><TipoDTE>33</TipoDTE></IdDoc></Documento></DTE>`;
  const t0 = Date.now();
  parseDte(malicioso);
  const ms = Date.now() - t0;
  // Umbral generoso a propósito: la suite completa corre este archivo en
  // paralelo con cientos de otros tests, y el punto no es medir
  // milisegundos exactos sino descartar el O(n²) que este mismo caso
  // tardaba MINUTOS en producir (ver commit) — 8s aquí ya sería 100x más
  // lento que lo medido en desarrollo (~5ms) y seguiría siendo una señal
  // clara de regresión, sin que la carga del entorno de CI dispare un falso positivo.
  assert.ok(ms < 8000, `parseDte tardó ${ms}ms con 50.000 tags sin cerrar — sospechoso de haber vuelto a O(n²)`);
});

test('rutValido aplica módulo 11', () => {
  assert.equal(rutValido('76.123.456-0'), true);
  assert.equal(rutValido('11.111.111-1'), true);
  assert.equal(rutValido('78.222.333-K'), true);
  assert.equal(rutValido('76.123.456-7'), false);
  assert.equal(rutValido('no-es-rut'), false);
});
