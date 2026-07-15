import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarUnidad, clasificar, calcularItem, calcularFactura } from '../src/services/motorPropio.js';
import { parseDte } from '../src/services/dte.js';

// Mismas categorías/seed de migrations/010_motor_propio.sql, en memoria (sin BD).
function categoriasEjemplo() {
  return new Map([
    ['electricidad', {
      codigo: 'electricidad', nombre: 'Energía eléctrica', unidad_fisica: 'kWh',
      factor_fisico_kgco2e: 0.2421, factor_gasto_kgco2e_clp1000: 0.60,
      palabras_clave: ['electric', 'kwh', 'energia', 'suministro electrico', 'sen', 'luz', 'potencia'],
      activo: true,
    }],
    ['combustible', {
      codigo: 'combustible', nombre: 'Combustibles', unidad_fisica: 'L',
      factor_fisico_kgco2e: 2.68, factor_gasto_kgco2e_clp1000: 1.20,
      palabras_clave: ['diesel', 'diésel', 'gasolina', 'bencina', 'combustible', 'glp', 'gas licuado', 'petroleo'],
      activo: true,
    }],
    ['transporte', {
      codigo: 'transporte', nombre: 'Transporte y logística', unidad_fisica: 'km',
      factor_fisico_kgco2e: 0.12, factor_gasto_kgco2e_clp1000: 0.35,
      palabras_clave: ['flete', 'transporte', 'distribucion', 'logistica', 'envio', 'courier', 'despacho'],
      activo: true,
    }],
    ['materiales', {
      codigo: 'materiales', nombre: 'Insumos y materiales', unidad_fisica: 'kg',
      factor_fisico_kgco2e: 1.5, factor_gasto_kgco2e_clp1000: 0.45,
      palabras_clave: ['papeleria', 'envase', 'repuesto', 'insumo', 'material', 'embalaje', 'toner'],
      activo: true,
    }],
    ['agua', {
      codigo: 'agua', nombre: 'Agua', unidad_fisica: 'm3',
      factor_fisico_kgco2e: 0.344, factor_gasto_kgco2e_clp1000: 0.30,
      palabras_clave: ['agua', 'hidrico', 'potable', 'sanitario'],
      activo: true,
    }],
    ['servicios', {
      codigo: 'servicios', nombre: 'Servicios', unidad_fisica: null,
      factor_fisico_kgco2e: null, factor_gasto_kgco2e_clp1000: 0.25,
      palabras_clave: ['servicio', 'aseo', 'mantencion', 'arriendo', 'asesoria', 'honorario'],
      activo: true,
    }],
  ]);
}

test('normalizarUnidad reconoce variantes del SII y descarta lo desconocido', () => {
  assert.equal(normalizarUnidad('KWH'), 'kWh');
  assert.equal(normalizarUnidad('Lts'), 'L');
  assert.equal(normalizarUnidad('Kg.'), 'kg');
  assert.equal(normalizarUnidad('UN'), null);
  assert.equal(normalizarUnidad(''), null);
  assert.equal(normalizarUnidad(null), null);
});

test('clasificar encuentra categoría por palabra clave, ignorando tildes y mayúsculas', () => {
  const cats = categoriasEjemplo();
  assert.equal(clasificar('Suministro eléctrico SEN', cats), 'electricidad');
  assert.equal(clasificar('Diésel B5 flota', cats), 'combustible');
  assert.equal(clasificar('Flete regional norte', cats), 'transporte');
});

test('clasificar cae a "servicios" cuando no hay coincidencia', () => {
  const cats = categoriasEjemplo();
  assert.equal(clasificar('Concepto sin relación aparente', cats), 'servicios');
});

test('clasificar ignora categorías inactivas', () => {
  const cats = categoriasEjemplo();
  cats.get('electricidad').activo = false;
  assert.equal(clasificar('Suministro eléctrico SEN', cats), 'servicios');
});

test('calcularItem usa método físico cuando la unidad coincide', () => {
  const cats = categoriasEjemplo();
  const it = calcularItem({ nombre: 'Suministro eléctrico SEN', cantidad: 2500, unidad: 'kWh', monto: 70000 }, cats);
  assert.equal(it.metodo, 'fisico');
  assert.equal(it.categoria_codigo, 'electricidad');
  // 2500 kWh * 0.2421 kgCO2e/kWh / 1000 = 0.60525 t
  assert.equal(it.co2e, 0.6053);
});

test('calcularItem cae a método por gasto cuando no hay unidad física reconocible', () => {
  const cats = categoriasEjemplo();
  // "Cargo por potencia" es un cargo de demanda eléctrica real (boleta SEN) → clasifica
  // como electricidad por la palabra clave "potencia", pero sin kWh usa el método de gasto.
  const it = calcularItem({ nombre: 'Cargo por potencia', cantidad: 1, unidad: null, monto: 30000 }, cats);
  assert.equal(it.metodo, 'gasto');
  assert.equal(it.categoria_codigo, 'electricidad');
  // 30000 / 1_000_000 * 0.60 = 0.018 t
  assert.equal(it.co2e, 0.018);
});

test('calcularItem sin ninguna palabra clave coincidente cae en "servicios" por gasto', () => {
  const cats = categoriasEjemplo();
  const it = calcularItem({ nombre: 'Concepto sin relación aparente', cantidad: 1, unidad: null, monto: 30000 }, cats);
  assert.equal(it.metodo, 'gasto');
  assert.equal(it.categoria_codigo, 'servicios');
  // 30000 / 1_000_000 * 0.25 = 0.0075 t
  assert.equal(it.co2e, 0.0075);
});

test('calcularFactura suma total, calcula % por ítem y elige la categoría dominante', () => {
  const cats = categoriasEjemplo();
  const items = [
    { nombre: 'Suministro eléctrico SEN', cantidad: 2500, unidad: 'kWh', monto: 70000 },
    { nombre: 'Cargo por potencia', cantidad: 1, unidad: null, monto: 30000 },
  ];
  const f = calcularFactura(items, cats);
  // 0.6053 (2500 kWh físico) + 0.018 (30000 CLP gasto, clasificado electricidad) = 0.6233
  assert.equal(f.total_co2e, 0.6233);
  assert.equal(f.categoria, 'Energía eléctrica');
  assert.equal(f.items.length, 2);
  const sumaPorcentajes = Math.round(f.items.reduce((a, it) => a + it.porcentaje_total, 0) * 10) / 10;
  assert.equal(sumaPorcentajes, 100);
});

test('calcularFactura con datos reales de un DTE XML parseado (dte-ejemplo)', () => {
  const DTE_EJEMPLO = `<?xml version="1.0" encoding="ISO-8859-1"?>
<DTE version="1.0">
  <Documento ID="F1234T33">
    <Encabezado>
      <IdDoc><TipoDTE>33</TipoDTE><Folio>1234</Folio><FchEmis>2026-06-15</FchEmis></IdDoc>
      <Emisor><RUTEmisor>76123456-0</RUTEmisor><RznSoc>Minera del Norte SpA</RznSoc></Emisor>
      <Receptor><RUTRecep>11111111-1</RUTRecep><RznSocRecep>Prueba Capital SpA</RznSocRecep></Receptor>
      <Totales><MntNeto>100000</MntNeto><IVA>19000</IVA><MntTotal>119000</MntTotal></Totales>
    </Encabezado>
    <Detalle><NmbItem>Suministro eléctrico</NmbItem><QtyItem>2500</QtyItem><UnmdItem>kWh</UnmdItem><PrcItem>28</PrcItem><MontoItem>70000</MontoItem></Detalle>
    <Detalle><NmbItem>Cargo por potencia</NmbItem><QtyItem>1</QtyItem><PrcItem>30000</PrcItem><MontoItem>30000</MontoItem></Detalle>
    <TmstFirma>2026-06-15T10:00:00</TmstFirma>
  </Documento>
</DTE>`;
  const dte = parseDte(DTE_EJEMPLO);
  assert.equal(dte.items.length, 2);
  const cats = categoriasEjemplo();
  const f = calcularFactura(dte.items, cats);
  assert.ok(f.total_co2e > 0);
  // El ítem "Suministro eléctrico" (sin acento en NmbItem) se clasifica igual como eléctrico.
  assert.equal(f.categoria, 'Energía eléctrica');
});
