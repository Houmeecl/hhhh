// ============================================================
// Motor de cálculo propio — independiente del motor externo.
// Calcula CO2e real a partir de ítems ya extraídos de un DTE XML
// (services/dte.js): cantidad, unidad y monto reales del documento.
//
// Metodología (misma jerarquía de calidad de dato citada en los PDF):
//  - Método FÍSICO (nivel 2-3): si la unidad del ítem coincide con la
//    unidad física de la categoría → co2e = cantidad × factor_físico.
//    Habilitado con origen 'xml' (siempre) o 'ia_verificada': la IA
//    (analisisIA.js) sí captura unidad de texto libre, pero solo se
//    confía en ella cuando el documento ya pasó la verificación cruzada
//    Σítems≈total (verificarYColapsarItems en facturaTexto.js) — si esa
//    verificación no corrió o colapsó los ítems, el documento llega aquí
//    con origen 'texto' y cae a gasto, igual que siempre. El parser de
//    reglas (propio_texto/propio_ocr) nunca captura unidad (no hay nada
//    que verificar ahí), así que para esos dos orígenes nada cambia.
//  - Método por GASTO (nivel 4, spend-based del GHG Protocol): si la
//    unidad no es reconocible, o el origen no la habilita → co2e =
//    monto_CLP × factor_gasto.
//
// Guardias: un ítem sin cantidad física utilizable NI monto > 0 se
// descarta ("Sin cantidad ni monto → No se calcula", Figura 2 de la
// guía); un monto negativo (descuento / nota de crédito) se descarta
// (el proxy por gasto jamás produce CO2e negativo); un monto sobre
// MONTO_MAX_CLP_ITEM O una cantidad sobre CANTIDAD_MAX_ITEM lanza error
// tipificado 'monto_fuera_de_rango' (un monto o una cantidad absurdos son
// síntoma de lectura corrupta: se rechaza el documento, no se adivina —
// el tope de cantidad protege el método FÍSICO tal como el de monto
// protege el método por gasto; sin él, una cantidad corrupta con unidad
// reconocida producía un CO2e disparatado sin disparar ningún rechazo).
// ============================================================

import { limpiar, normalizarOcr } from './textoOcr.js';

const round4 = (n) => Math.round(n * 10000) / 10000;

// Tope de monto por ítem (CLP). Mismo patrón que TARIFA_MAX_CLP en
// compensacion.js: default holgado (diez mil millones), ajustable por
// entorno sin tocar código.
export const MONTO_MAX_CLP_ITEM = Number(process.env.MOTOR_MONTO_MAX_CLP) > 0
  ? Number(process.env.MOTOR_MONTO_MAX_CLP)
  : 1e10;

// Tope de cantidad por ítem (unidad física: kWh, L, kg, m3, km — la que
// sea). Deliberadamente holgado (mil millones): ninguna línea de factura
// real trae esa magnitud; el objetivo es atrapar ceros de más por typo o
// corrupción de OCR, no limitar consumo industrial legítimo.
export const CANTIDAD_MAX_ITEM = Number(process.env.MOTOR_CANTIDAD_MAX) > 0
  ? Number(process.env.MOTOR_CANTIDAD_MAX)
  : 1e9;

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
    if (monto > MONTO_MAX_CLP_ITEM || cantidad > CANTIDAD_MAX_ITEM) { fueraDeRango = true; continue; }
    // Negativo en CUALQUIERA de los dos ejes descarta el ítem: un monto
    // negativo es un descuento/reverso, y una cantidad negativa entraría
    // al método físico produciendo CO2e negativo (vía de subdeclaración).
    if (monto < 0 || cantidad < 0) { descartados += 1; continue; }
    if (monto === 0 && cantidad <= 0) { descartados += 1; continue; }
    calculables.push(it);
  }
  return { calculables, descartados, fueraDeRango };
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

// Clasifica un ítem por coincidencia de palabra clave en su glosa.
// Gana la palabra clave MÁS LARGA (la más específica): "flete maritimo"
// le gana a "flete" y "agua potable" a "agua", así el resultado no
// depende del orden en que la BD devuelva las categorías. A igual largo
// gana la primera categoría leída (comportamiento previo).
// Devuelve el código de categoría (default 'servicios', catch-all).
export function clasificar(texto, categorias) {
  return clasificarConSenal(texto, categorias).codigo;
}

// Igual que clasificar(), pero además dice SI hubo coincidencia de palabra
// clave o si se cayó al catch-all. La diferencia importa río abajo: cuando
// no hubo coincidencia, el código devuelto ('servicios') es un default de
// cálculo, NO una clasificación del documento. Atribuirle el alcance GHG de
// esa categoría (Alcance 3 · Cat. 1) sería presentar un default como si
// fuera una atribución calculada — ver services/alcanceGhg.js.
export function clasificarConSenal(texto, categorias) {
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
  if (mejor) return { codigo: mejor.codigo, coincidencia: true };
  const servicios = categorias.get('servicios');
  return { codigo: servicios?.activo ? 'servicios' : activas[0].codigo, coincidencia: false };
}

// Calcula el CO2e (tCO2e) de un ítem de factura, eligiendo método físico o
// de gasto. `origen` decide si el método físico está disponible: 'xml'
// (unidades reales del DTE) o 'ia_verificada' (unidad extraída por IA, solo
// cuando el llamador ya confirmó que el documento pasó la verificación
// cruzada Σítems≈total — ver public.js). Es un helper de bajo nivel — la
// política de origen por defecto (conservadora) vive en calcularFactura.
export function calcularItem({ nombre, descripcion, cantidad, unidad, monto }, categorias, origen = 'xml') {
  const { codigo, coincidencia } = clasificarConSenal(`${nombre || ''} ${descripcion || ''}`, categorias);
  const cat = categorias.get(codigo);
  const unidadCanonica = (origen === 'xml' || origen === 'ia_verificada') ? normalizarUnidad(unidad) : null;

  // El método FÍSICO exige que la categoría sea una clasificación real del
  // ítem, no el catch-all. El factor físico de una categoría no se le puede
  // aplicar a un ítem que no fue clasificado en ella: con `servicios`
  // desactivada el catch-all pasa a ser `agua` (primera activa por código),
  // que tiene unidad m3 y factor físico — y entonces "Hormigón premezclado
  // H30, 120 M3" se calculaba como 120 m³ de AGUA: 0,04 tCO2e en vez de 2,7
  // por gasto, 65 veces menos. Sin coincidencia se calcula por gasto, que es
  // el piso metodológico honesto cuando no se sabe qué se compró.
  let co2e, metodo;
  if (coincidencia && unidadCanonica && cat.unidad_fisica === unidadCanonica && Number(cat.factor_fisico_kgco2e) > 0) {
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
    // false cuando el código salió del catch-all: hay factor con que calcular,
    // pero no hay clasificación real del ítem.
    categoria_coincidencia: coincidencia,
    metodo,
  };
}

// Calcula la factura completa a partir de los ítems reales del documento.
// Devuelve el MISMO shape que simpleApi.analyzeInvoice() — drop-in — más
// `items_descartados` (ítems sin datos o negativos, excluidos del cálculo).
// origen: 'xml' o 'ia_verificada' habilitan el método físico; 'texto'
// (default, conservador) fuerza método por gasto aunque el ítem traiga
// unidad — ver calcularItem() para el detalle de cada origen.
export function calcularFactura(dteItems, categorias, { origen = 'texto' } = {}) {
  if (![...(categorias?.values() || [])].some((c) => c.activo)) {
    throw new Error('Motor sin categorías activas configuradas.');
  }
  const { calculables, descartados, fueraDeRango } = evaluarItems(dteItems);
  if (fueraDeRango) {
    const e = new Error(`Un ítem supera el monto o la cantidad máxima admitida ($${MONTO_MAX_CLP_ITEM.toLocaleString('es-CL')} CLP / ${CANTIDAD_MAX_ITEM.toLocaleString('es-CL')} unidades): lectura corrupta o documento fuera de rango.`);
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
    // `categoria` es el NOMBRE, que se edita desde el panel del motor y por
    // eso no sirve como clave. `categoria_codigo` es el código estable: es lo
    // que se persiste y con lo que se hace JOIN para resolver el alcance GHG.
    // Aditivo sobre el shape drop-in de analyzeInvoice(), igual que
    // `items_descartados` — ningún llamador existente se entera.
    categoria_codigo: dominante?.categoria_codigo || null,
    // Si el ítem dominante cayó al catch-all, la categoría del documento es un
    // default de cálculo y no se le puede atribuir un alcance GHG.
    categoria_coincidencia: dominante ? dominante.categoria_coincidencia === true : false,
    items: items.map(({ descripcion, cantidad, co2e, porcentaje_total, metodo }) => ({ descripcion, cantidad, co2e, porcentaje_total, metodo })),
    items_descartados: descartados,
  };
}

// Carga el plan de categorías del motor como Map (usable dentro de una transacción).
export async function cargarCategorias(run) {
  // ORDER BY: clasificar() desempata por orden de iteración cuando dos
  // keywords tienen el mismo largo — sin este ORDER BY ese desempate
  // dependía del orden físico que Postgres decidiera devolver (no
  // garantizado), pudiendo clasificar el mismo documento distinto entre
  // reinicios o planes de ejecución. Con ORDER BY, el resultado es
  // reproducible siempre.
  const { rows } = await run(`SELECT * FROM motor_categorias ORDER BY codigo`);
  if (rows.length === 0) throw new Error('Motor sin categorías configuradas (¿migraciones sin correr?).');
  return new Map(rows.map((r) => [r.codigo, r]));
}
