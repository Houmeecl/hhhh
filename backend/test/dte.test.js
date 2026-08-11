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

test('rutValido aplica módulo 11', () => {
  assert.equal(rutValido('76.123.456-0'), true);
  assert.equal(rutValido('11.111.111-1'), true);
  assert.equal(rutValido('78.222.333-K'), true);
  assert.equal(rutValido('76.123.456-7'), false);
  assert.equal(rutValido('no-es-rut'), false);
});
