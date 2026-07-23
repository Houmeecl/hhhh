// ============================================================
// Motor de cálculo propio — independiente del motor externo.
// Calcula CO2e real a partir de ítems ya extraídos de un DTE XML
// (services/dte.js): cantidad, unidad y monto reales del documento.
//
// Metodología (misma jerarquía de calidad de dato citada en los PDF):
//  - Método FÍSICO (nivel 2-3): si la unidad del ítem coincide con la
//    unidad física de la categoría → co2e = cantidad × factor_físico.
//    Solo con origen 'xml': las unidades leídas de texto libre u OCR
//    no se consideran confiables (la guía metodológica lo promete y
//    esta es la garantía en el motor, no solo en el parser).
//  - Método por GASTO (nivel 4, spend-based del GHG Protocol): si la
//    unidad no es reconocible → co2e = monto_CLP × factor_gasto.
//
// Guardias: un ítem sin cantidad física utilizable NI monto > 0 se
// descarta ("Sin cantidad ni monto → No se calcula", Figura 2 de la
// guía); un monto negativo (descuento / nota de crédito) se descarta
// (el proxy por gasto jamás produce CO2e negativo); un monto sobre
// MONTO_MAX_CLP_ITEM lanza error tipificado 'monto_fuera_de_rango'
// (un monto absurdo es síntoma de lectura corrupta: se rechaza el
// documento, no se adivina).
// ============================================================

const round4 = (n) => Math.round(n * 10000) / 10000;

// Tope de monto por ítem (CLP). Mismo patrón que TARIFA_MAX_CLP en
// compensacion.js: default holgado (diez mil millones), ajustable por
// entorno sin tocar código.
export const MONTO_MAX_CLP_ITEM = Number(process.env.MOTOR_MONTO_MAX_CLP) > 0
  ? Number(process.env.MOTOR_MONTO_MAX_CLP)
  : 1e10;

// Evalúa los ítems ANTES de calcular: separa calculables de descartados
// y detecta montos fuera de rango. Pura (sin categorías ni BD) — la usa
// también lecturaDocumento.js para rechazar en el pre-pass.
export function evaluarItems(items) {
  const calculables = [];
  let descartados = 0;
  let fueraDeRango = false;
  for (const it of items || []) {
    const monto = Number(it?.monto || 0);
    const cantidad = Number(it?.cantidad || 0);
    if (monto > MONTO_MAX_CLP_ITEM) { fueraDeRango = true; continue; }
    if (monto < 0) { descartados += 1; continue; }
    if (monto === 0 && cantidad <= 0) { descartados += 1; continue; }
    calculables.push(it);
  }
  return { calculables, descartados, fueraDeRango };
}

// Texto sin tildes ni mayúsculas, para comparar contra palabras clave.
function limpiar(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // quita tildes
}

// Mapea unidades libres del SII a una unidad canónica, o null si no se
// reconoce. Decisión de diseño: 't-km' NO está en el mapa — el DTE chileno
// no trae tonelada-kilómetro confiable, así que maritimo_contenedor queda
// gasto-only por diseño (la guía metodológica lo documenta igual).
const UNIDADES = {
  kwh: 'kWh', kw: 'kWh',
  lt: 'L', lts: 'L', litro: 'L', litros: 'L', l: 'L',
  kg: 'kg', kgm: 'kg', kilo: 'kg', kilos: 'kg',
  m3: 'm3', mt3: 'm3', mts3: 'm3',
  km: 'km', kms: 'km',
};
export function normalizarUnidad(unidad) {
  const u = limpiar(unidad).replace(/[.\s]/g, '');
  return UNIDADES[u] || null;
}

// Normaliza confusiones típicas de OCR (0/O→o, 1/l→l, rn→m) para que un
// error de reconocimiento de caracteres no le cueste la categoría a un
// ítem real (ej. "e1ectricidad" u "0.NEMESA rnaritirno"). Se aplica por
// igual a la glosa y a la palabra clave, así ambas quedan comparables.
function normalizarOcr(s) {
  return s.replace(/[01]/g, (c) => (c === '0' ? 'o' : 'l')).replace(/rn/g, 'm');
}

// Clasifica un ítem por coincidencia de palabra clave en su glosa.
// Gana la palabra clave MÁS LARGA (la más específica): "flete maritimo"
// le gana a "flete" y "agua potable" a "agua", así el resultado no
// depende del orden en que la BD devuelva las categorías. A igual largo
// gana la primera categoría leída (comportamiento previo).
// Devuelve el código de categoría (default 'servicios', catch-all).
export function clasificar(texto, categorias) {
  const activas = [...(categorias?.values() || [])].filter((c) => c.activo);
  if (activas.length === 0) {
    // Error de configuración explícito — jamás el crash silencioso de
    // leer propiedades de undefined con el Map vacío.
    throw new Error('Motor sin categorías activas configuradas.');
  }
  const t = limpiar(texto);
  const tOcr = normalizarOcr(t);
  let mejor = null; // { codigo, largo }
  for (const cat of activas) {
    for (const kw of cat.palabras_clave || []) {
      const k = limpiar(kw);
      if (!k) continue;
      const coincide = t.includes(k) || tOcr.includes(normalizarOcr(k));
      if (coincide && (!mejor || k.length > mejor.largo)) {
        mejor = { codigo: cat.codigo, largo: k.length };
      }
    }
  }
  if (mejor) return mejor.codigo;
  const servicios = categorias.get('servicios');
  return servicios?.activo ? 'servicios' : activas[0].codigo;
}

// Calcula el CO2e (tCO2e) de un ítem de factura, eligiendo método físico o
// de gasto. `origen` decide si el método físico está disponible: solo 'xml'
// (unidades reales del DTE). Es un helper de bajo nivel — la política de
// origen por defecto (conservadora) vive en calcularFactura.
export function calcularItem({ nombre, descripcion, cantidad, unidad, monto }, categorias, origen = 'xml') {
  const codigo = clasificar(`${nombre || ''} ${descripcion || ''}`, categorias);
  const cat = categorias.get(codigo);
  const unidadCanonica = origen === 'xml' ? normalizarUnidad(unidad) : null;

  let co2e, metodo;
  if (unidadCanonica && cat.unidad_fisica === unidadCanonica && Number(cat.factor_fisico_kgco2e) > 0) {
    co2e = round4((Number(cantidad) * Number(cat.factor_fisico_kgco2e)) / 1000);
    metodo = 'fisico';
  } else {
    co2e = round4((Number(monto || 0) / 1_000_000) * Number(cat.factor_gasto_kgco2e_clp1000));
    metodo = 'gasto';
  }
  return {
    descripcion: nombre || descripcion || 'Ítem',
    cantidad: Number(cantidad) || 0,
    co2e,
    categoria: cat.nombre,
    categoria_codigo: codigo,
    metodo,
  };
}

// Calcula la factura completa a partir de los ítems reales del documento.
// Devuelve el MISMO shape que simpleApi.analyzeInvoice() — drop-in — más
// `items_descartados` (ítems sin datos o negativos, excluidos del cálculo).
// origen: 'xml' habilita el método físico; 'texto' (default, conservador)
// fuerza método por gasto aunque el ítem traiga unidad.
export function calcularFactura(dteItems, categorias, { origen = 'texto' } = {}) {
  if (![...(categorias?.values() || [])].some((c) => c.activo)) {
    throw new Error('Motor sin categorías activas configuradas.');
  }
  const { calculables, descartados, fueraDeRango } = evaluarItems(dteItems);
  if (fueraDeRango) {
    const e = new Error(`Un ítem supera el monto máximo admitido ($${MONTO_MAX_CLP_ITEM.toLocaleString('es-CL')} CLP): lectura corrupta o documento fuera de rango.`);
    e.code = 'monto_fuera_de_rango';
    throw e;
  }
  const items = calculables.map((it) => calcularItem(it, categorias, origen));
  const total = round4(items.reduce((a, it) => a + it.co2e, 0));
  for (const it of items) {
    it.porcentaje_total = total > 0 ? round4((it.co2e / total) * 100) : 0;
  }
  // Categoría "dominante" de la factura = la de mayor CO2e (igual criterio que el mock: una sola categoría).
  const dominante = items.reduce((max, it) => (it.co2e > (max?.co2e ?? -1) ? it : max), null);
  return {
    total_co2e: total,
    categoria: dominante?.categoria || 'Sin categoría',
    items: items.map(({ descripcion, cantidad, co2e, porcentaje_total }) => ({ descripcion, cantidad, co2e, porcentaje_total })),
    items_descartados: descartados,
  };
}

// Carga el plan de categorías del motor como Map (usable dentro de una transacción).
export async function cargarCategorias(run) {
  const { rows } = await run(`SELECT * FROM motor_categorias`);
  if (rows.length === 0) throw new Error('Motor sin categorías configuradas (¿migraciones sin correr?).');
  return new Map(rows.map((r) => [r.codigo, r]));
}
