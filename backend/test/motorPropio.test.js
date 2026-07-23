import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizarUnidad, clasificar, calcularItem, calcularFactura, evaluarItems, MONTO_MAX_CLP_ITEM, CANTIDAD_MAX_ITEM } from '../src/services/motorPropio.js';
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

// Subconjunto del seed de migrations/018_metodologias_avaladas.sql, en memoria.
function categoriasConNuevas() {
  const cats = categoriasEjemplo();
  // La 018 traslada 'glp'/'gas licuado' desde combustible a la categoría dedicada.
  cats.get('combustible').palabras_clave = cats
    .get('combustible')
    .palabras_clave.filter((k) => k !== 'glp' && k !== 'gas licuado');
  cats.set('glp', {
    codigo: 'glp', nombre: 'Gas licuado (GLP)', unidad_fisica: 'L',
    factor_fisico_kgco2e: 1.61, factor_gasto_kgco2e_clp1000: 1.00,
    palabras_clave: ['glp', 'gas licuado', 'lipigas', 'abastible', 'gasco', 'cilindro de gas', 'balon de gas'],
    activo: true,
  });
  cats.set('agua_potable', {
    codigo: 'agua_potable', nombre: 'Agua potable (red)', unidad_fisica: 'm3',
    factor_fisico_kgco2e: 0.41, factor_gasto_kgco2e_clp1000: 0.30,
    palabras_clave: ['agua potable', 'aguas andinas', 'esval', 'essbio', 'smapa'],
    activo: true,
  });
  cats.set('residuos_relleno', {
    codigo: 'residuos_relleno', nombre: 'Residuos a relleno sanitario', unidad_fisica: 'kg',
    factor_fisico_kgco2e: 0.45, factor_gasto_kgco2e_clp1000: 0.50,
    palabras_clave: ['relleno sanitario', 'disposicion final', 'retiro de residuos', 'residuos', 'vertedero', 'basura'],
    activo: true,
  });
  cats.set('maritimo_contenedor', {
    codigo: 'maritimo_contenedor', nombre: 'Marítimo — contenedor', unidad_fisica: 't-km',
    factor_fisico_kgco2e: 0.012, factor_gasto_kgco2e_clp1000: 0.20,
    palabras_clave: ['flete maritimo', 'maritimo', 'naviera', 'contenedor', 'embarque maritimo'],
    activo: true,
  });
  return cats;
}

test('clasificar prefiere la palabra clave más específica (la más larga)', () => {
  const cats = categoriasConNuevas();
  // "flete marítimo" (14) le gana a "flete" (5) del transporte terrestre.
  assert.equal(clasificar('Flete marítimo Valparaíso-Shanghái', cats), 'maritimo_contenedor');
  // "aguas andinas" / "agua potable" le ganan a "agua" de la categoría genérica.
  assert.equal(clasificar('Consumo Aguas Andinas junio', cats), 'agua_potable');
  assert.equal(clasificar('Agua potable planta', cats), 'agua_potable');
  // "relleno sanitario" (17) le gana a "sanitario" (9) de la categoría agua.
  assert.equal(clasificar('Disposición en relleno sanitario', cats), 'residuos_relleno');
  // "gas licuado" ya no vive en combustible: cae en la categoría GLP (IPCC).
  assert.equal(clasificar('Gas licuado 15 kg Lipigas', cats), 'glp');
});

test('clasificar no depende del orden en que la BD devuelva las categorías', () => {
  const cats = categoriasConNuevas();
  const invertidas = new Map([...cats.entries()].reverse());
  for (const glosa of ['Flete marítimo contenedor', 'Agua potable planta', 'Relleno sanitario mensual', 'Flete regional norte']) {
    assert.equal(clasificar(glosa, cats), clasificar(glosa, invertidas), `"${glosa}" debe clasificar igual en ambos órdenes`);
  }
});

test('clasificar tolera confusiones comunes de OCR (0/O, 1/l, rn/m)', () => {
  const cats = categoriasEjemplo();
  // "Cargo por p0tencia" (0 en vez de "o") sigue reconociendo "potencia".
  assert.equal(clasificar('Carg0 p0r p0tencia', cats), 'electricidad');
  // "e1ectrico" (1 en vez de "l") sigue reconociendo "electric".
  assert.equal(clasificar('Suministro e1ectrico mensual', cats), 'electricidad');
  const catsNuevas = categoriasConNuevas();
  // "rnaritirno" (rn en vez de "m") sigue reconociendo "maritimo", y le
  // gana a "flete" (transporte terrestre) por ser la palabra más específica.
  assert.equal(clasificar('Flete rnaritirno Valparaíso-Shanghái', catsNuevas), 'maritimo_contenedor');
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
  const f = calcularFactura(items, cats, { origen: 'xml' });
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
  const f = calcularFactura(dte.items, cats, { origen: 'xml' });
  assert.ok(f.total_co2e > 0);
  // El ítem "Suministro eléctrico" (sin acento en NmbItem) se clasifica igual como eléctrico.
  assert.equal(f.categoria, 'Energía eléctrica');
});

// ---------- Endurecimiento del motor (F3: guardias y descartes) ----------

test('calcularFactura con categorías vacías lanza error de configuración, no crashea', () => {
  assert.throws(() => calcularFactura([{ nombre: 'x', monto: 1000 }], new Map()), /sin categorías activas/);
  const inactivas = new Map([['servicios', { codigo: 'servicios', nombre: 'Servicios', activo: false, palabras_clave: [], factor_gasto_kgco2e_clp1000: 0.25 }]]);
  assert.throws(() => calcularFactura([{ nombre: 'x', monto: 1000 }], inactivas), /sin categorías activas/);
});

test('origen texto NUNCA usa método físico aunque el ítem traiga unidad', () => {
  const cats = categoriasEjemplo();
  // Mismo ítem del test físico, pero con origen 'texto' (default): gasto.
  const f = calcularFactura([{ nombre: 'Suministro eléctrico SEN', cantidad: 2500, unidad: 'kWh', monto: 70000 }], cats);
  // 70000 / 1_000_000 * 0.60 = 0.042 t (gasto), no 0.6053 (físico)
  assert.equal(f.total_co2e, 0.042);
});

test('ítems con monto negativo (descuentos / notas de crédito) se descartan', () => {
  const cats = categoriasEjemplo();
  const f = calcularFactura([
    { nombre: 'Servicio principal', monto: 100000 },
    { nombre: 'Descuento comercial', monto: -20000 },
  ], cats);
  assert.equal(f.items.length, 1);
  assert.equal(f.items_descartados, 1);
  assert.ok(f.total_co2e > 0, 'el CO2e jamás baja por un monto negativo');
});

test('ítem sin cantidad ni monto se descarta ("No se calcula", Figura 2 de la guía)', () => {
  const cats = categoriasEjemplo();
  const f = calcularFactura([
    { nombre: 'Glosa sin datos', monto: 0, cantidad: 0 },
    { nombre: 'Servicio real', monto: 50000 },
  ], cats);
  assert.equal(f.items.length, 1);
  assert.equal(f.items_descartados, 1);
});

test('monto sobre el tope lanza error tipificado monto_fuera_de_rango', () => {
  const cats = categoriasEjemplo();
  assert.throws(
    () => calcularFactura([{ nombre: 'Lectura corrupta', monto: MONTO_MAX_CLP_ITEM + 1 }], cats),
    (e) => e.code === 'monto_fuera_de_rango'
  );
});

test('cantidad sobre el tope lanza error tipificado monto_fuera_de_rango (protege también el método físico)', () => {
  // Hallazgo de auditoría: el tope de monto solo protegía el método por
  // gasto; una cantidad corrupta (ceros de más por typo/OCR) en una
  // categoría con unidad física reconocida producía un CO2e disparatado
  // sin disparar ningún rechazo. CANTIDAD_MAX_ITEM cierra ese hueco.
  const cats = categoriasEjemplo();
  assert.throws(
    () => calcularFactura([{ nombre: 'Suministro electrico', cantidad: CANTIDAD_MAX_ITEM + 1, unidad: 'kWh', monto: 1000 }], cats, { origen: 'xml' }),
    (e) => e.code === 'monto_fuera_de_rango'
  );
  assert.equal(evaluarItems([{ cantidad: CANTIDAD_MAX_ITEM + 1, monto: 1 }]).fueraDeRango, true);
  // Una cantidad grande pero plausible NO dispara el rechazo.
  assert.equal(evaluarItems([{ cantidad: CANTIDAD_MAX_ITEM - 1, monto: 1 }]).fueraDeRango, false);
});

test('evaluarItems separa calculables, descartados y fuera de rango', () => {
  const r = evaluarItems([
    { nombre: 'ok', monto: 1000 },
    { nombre: 'fisico sin monto', monto: 0, cantidad: 10 }, // calculable por cantidad
    { nombre: 'negativo', monto: -5 },
    { nombre: 'vacio', monto: 0, cantidad: 0 },
  ]);
  assert.equal(r.calculables.length, 2);
  assert.equal(r.descartados, 2);
  assert.equal(r.fueraDeRango, false);
  assert.equal(evaluarItems([{ monto: MONTO_MAX_CLP_ITEM + 1 }]).fueraDeRango, true);
  assert.deepEqual(evaluarItems(null), { calculables: [], descartados: 0, fueraDeRango: false });
});

test('calcularFactura vacía o toda descartada devuelve total 0 y Sin categoría', () => {
  const cats = categoriasEjemplo();
  const f = calcularFactura([], cats);
  assert.equal(f.total_co2e, 0);
  assert.equal(f.categoria, 'Sin categoría');
  const g = calcularFactura([{ nombre: 'solo descuento', monto: -1 }], cats);
  assert.equal(g.total_co2e, 0);
  assert.equal(g.items_descartados, 1);
});

test('t-km nunca entra al método físico, ni siquiera desde XML (gasto-only por diseño)', () => {
  const cats = categoriasConNuevas();
  const item = { nombre: 'Flete marítimo contenedor', cantidad: 1200, unidad: 't-km', monto: 800000 };
  const r = calcularItem(item, cats, 'xml');
  assert.equal(r.categoria_codigo, 'maritimo_contenedor');
  // normalizarUnidad no reconoce t-km a propósito (la unidad exige verificar
  // masa × distancia, dato que una factura no trae): siempre método por gasto.
  assert.equal(r.metodo, 'gasto');
  // $800.000 → 800 miles × 0,20 kg/miles = 160 kg = 0,16 t.
  assert.ok(Math.abs(r.co2e - 0.16) < 1e-9, `co2e esperado 0.16, fue ${r.co2e}`);
});

test('cantidad negativa con monto positivo se descarta: el físico jamás resta CO2e', () => {
  const cats = categoriasEjemplo();
  // Vector de subdeclaración detectado en auditoría: QtyItem negativo con
  // MontoItem positivo entraría al método físico con CO2e negativo.
  const malicioso = { nombre: 'Suministro electrico', cantidad: -1000000, unidad: 'kWh', monto: 1 };
  const ev = evaluarItems([malicioso]);
  assert.equal(ev.calculables.length, 0);
  assert.equal(ev.descartados, 1);
  const f = calcularFactura([
    { nombre: 'Suministro electrico', cantidad: 500, unidad: 'kWh', monto: 100000 },
    malicioso,
  ], cats, { origen: 'xml' });
  // Solo el ítem legítimo cuenta: 500 kWh × 0,2421 = 121,05 kg = 0,1211 t.
  assert.equal(f.items_descartados, 1);
  assert.ok(f.total_co2e > 0.12 && f.total_co2e < 0.13, `total ${f.total_co2e}`);
});

test('cargarCategorias pide orden determinista a la BD (evita desempates que dependan del orden físico de lectura)', () => {
  const src = fs.readFileSync(fileURLToPath(new URL('../src/services/motorPropio.js', import.meta.url)), 'utf8');
  assert.match(src, /SELECT \* FROM motor_categorias ORDER BY codigo/);
});
