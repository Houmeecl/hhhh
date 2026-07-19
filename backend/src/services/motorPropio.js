// ============================================================
// Motor de cálculo propio — independiente del motor externo.
// Calcula CO2e real a partir de ítems ya extraídos de un DTE XML
// (services/dte.js): cantidad, unidad y monto reales del documento.
//
// Metodología (misma jerarquía de calidad de dato citada en los PDF):
//  - Método FÍSICO (nivel 2-3): si la unidad del ítem coincide con la
//    unidad física de la categoría → co2e = cantidad × factor_físico.
//  - Método por GASTO (nivel 4, spend-based del GHG Protocol): si la
//    unidad no es reconocible → co2e = monto_CLP × factor_gasto.
// ============================================================

const round4 = (n) => Math.round(n * 10000) / 10000;

// Texto sin tildes ni mayúsculas, para comparar contra palabras clave.
function limpiar(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // quita tildes
}

// Mapea unidades libres del SII a una unidad canónica, o null si no se reconoce.
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

// Clasifica un ítem por coincidencia de palabra clave en su glosa.
// Gana la palabra clave MÁS LARGA (la más específica): "flete maritimo"
// le gana a "flete" y "agua potable" a "agua", así el resultado no
// depende del orden en que la BD devuelva las categorías. A igual largo
// gana la primera categoría leída (comportamiento previo).
// Devuelve el código de categoría (default 'servicios', catch-all).
export function clasificar(texto, categorias) {
  const t = limpiar(texto);
  let mejor = null; // { codigo, largo }
  for (const cat of categorias.values()) {
    if (!cat.activo) continue;
    for (const kw of cat.palabras_clave || []) {
      const k = limpiar(kw);
      if (k && t.includes(k) && (!mejor || k.length > mejor.largo)) {
        mejor = { codigo: cat.codigo, largo: k.length };
      }
    }
  }
  if (mejor) return mejor.codigo;
  return categorias.has('servicios') ? 'servicios' : [...categorias.keys()][0];
}

// Calcula el CO2e (tCO2e) de un ítem de factura, eligiendo método físico o de gasto.
export function calcularItem({ nombre, descripcion, cantidad, unidad, monto }, categorias) {
  const codigo = clasificar(`${nombre || ''} ${descripcion || ''}`, categorias);
  const cat = categorias.get(codigo);
  const unidadCanonica = normalizarUnidad(unidad);

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

// Calcula la factura completa a partir de los ítems reales del DTE.
// Devuelve el MISMO shape que simpleApi.analyzeInvoice() — drop-in.
export function calcularFactura(dteItems, categorias) {
  const items = (dteItems || []).map((it) => calcularItem(it, categorias));
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
  };
}

// Carga el plan de categorías del motor como Map (usable dentro de una transacción).
export async function cargarCategorias(run) {
  const { rows } = await run(`SELECT * FROM motor_categorias`);
  return new Map(rows.map((r) => [r.codigo, r]));
}
