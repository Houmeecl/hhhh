// ============================================================
// La regla de atribución de categoría, en UN solo lugar.
//
// El motor propio clasifica por palabras clave sobre la glosa de los ítems.
// Cuando ninguna calza NO devuelve "no sé": devuelve su catch-all ('servicios',
// o la primera categoría activa si esa está desactivada). Ese código sirve para
// calcular —hay factor— pero NO es una clasificación del documento.
//
// La regla: **solo se presenta la categoría, y su alcance GHG, cuando salió de
// la glosa real del documento**. Mostrar el catch-all con la misma cara que una
// atribución calculada es indistinguible de un dato, y estos informes se pegan
// en memorias anuales bajo NCG 461 / IFRS S2.
//
// Este módulo existe porque la regla estaba escrita tres veces y de tres formas
// distintas (alcanceGhg.js como cascada de motivos, mandante.js inline,
// capitalNatural.js inline e invertida), sobre DOS vocabularios distintos:
//
//   facturas.categoria_origen       'glosa' | 'sin_coincidencia'
//                                   | 'sin_categoria' | 'operador' | NULL
//   dte_proveedor.categoria_origen  'xml' | 'razon_social'
//                                   | 'sin_coincidencia' | NULL
//
// Son vocabularios distintos porque las fuentes son distintas: un DTE del SII
// puede traer el XML con la glosa real ('xml') o solo el registro del RCV, cuyo
// único "ítem" es sintético y se llama como la contraparte ('razon_social').
// Un documento cargado por el cliente no tiene esa distinción: o la glosa calzó
// ('glosa') o no.
// ============================================================

// Los tres orígenes que SÍ son una clasificación del documento:
//  · 'glosa'    — una palabra clave calzó con la glosa de los ítems.
//  · 'xml'      — ídem, sobre el detalle real que vino en el XML del DTE.
//  · 'operador' — un operador la asignó a mano, y ese acto quedó sellado en su
//                 propia cadena (ver migración 078). Es humana, no automática:
//                 los informes lo declaran en vez de pasarla por cálculo.
const ATRIBUIBLES = new Set(['glosa', 'xml', 'operador']);

export const SIN_CLASIFICAR = 'Sin clasificar';

export function esAtribuible(origen) {
  return ATRIBUIBLES.has(origen);
}

// Cómo mostrar la categoría de un documento. Recibe cualquier objeto con
// `categoria` (el NOMBRE — así lo guarda la columna) y `categoria_origen`.
//
// Dos etiquetas distintas a propósito:
//  · `detalle`  — el documento conserva su nombre, marcado como no confirmado.
//    Esconderlo del todo dejaría el CO2e sin explicación: ese número se calculó
//    con el factor de esa categoría, y el cliente tiene derecho a saber cuál.
//  · `agregado` — en donuts y totales la porción se rotula "Sin clasificar".
//    Acumularla bajo el nombre del catch-all la convierte en un hallazgo
//    ("Servicios: 40% de tus emisiones") que nadie calculó.
export function categoriaParaMostrar(f) {
  const nombre = f?.categoria || null;
  const confirmada = esAtribuible(f?.categoria_origen);
  return {
    nombre,
    confirmada,
    agregado: confirmada && nombre ? nombre : SIN_CLASIFICAR,
    detalle: !nombre ? SIN_CLASIFICAR : confirmada ? nombre : `${nombre} · sin confirmar`,
  };
}

// El alcance GHG de un documento, o null si su categoría no es atribuible.
// Se pasa el alcance ya resuelto (del snapshot congelado de la versión del
// motor, no del catálogo vivo) para no acoplar este módulo a la base.
export function alcanceAtribuible(f, alcanceGhgCrudo) {
  return esAtribuible(f?.categoria_origen) ? (alcanceGhgCrudo || null) : null;
}

// Motivos por los que un documento calculado NO recibe alcance, con el texto
// que se le muestra a quien lo lee. Vive acá y no duplicado en el PDF y en el
// panel: si se agrega un motivo en services/alcanceGhg.js y no aparece en esta
// lista, el informe muestra un saldo sin explicar.
//
// El orden es el de utilidad para quien lee: primero lo que puede resolver.
export const MOTIVOS_SIN_ALCANCE = [
  ['inferido_por_nombre', 'clasificados por el nombre del proveedor, no por el detalle del documento'],
  ['descarga_antigua', 'descargados antes de esta clasificación'],
  ['sin_coincidencia', 'sin coincidencia con ninguna categoría del motor'],
  ['motor_sin_categoria', 'sin categoría asignada por el motor (ej. notas de crédito)'],
  ['alcance_no_legible', 'con un alcance GHG no legible en el catálogo'],
];
