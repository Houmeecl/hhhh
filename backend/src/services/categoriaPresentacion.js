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
//  · 'operador' — un operador la asignó a mano. Es humana, no automática: los
//                 informes la declaran en vez de pasarla por cálculo.
//                 OJO: hoy NADIE escribe este valor. La migración 078 lo admite
//                 en el CHECK para que la bandeja de revisión manual (Fase C)
//                 pueda escribirlo junto con su asiento de ajuste encadenado.
//                 Mientras esa cadena no exista, ninguna ruta lo produce.
const ATRIBUIBLES = new Set(['glosa', 'xml', 'operador']);

export const SIN_CLASIFICAR = 'Sin clasificar';

export function esAtribuible(origen) {
  return ATRIBUIBLES.has(origen);
}

// La misma regla, en SQL, para las consultas que agregan en la base en vez de
// en JavaScript. Se exporta como constante y no se reescribe a mano en cada
// ruta: la auditoría encontró SEIS variantes de esta regla, tres de ellas SQL
// literal y sin ningún test, ya divergiendo entre sí.
//
// Solo los valores del vocabulario de `facturas` — 'xml' es de `dte_proveedor`,
// que no se agrega con estas consultas.
export const SQL_CATEGORIA_ATRIBUIBLE = "categoria_origen IN ('glosa','operador')";

// Cómo mostrar la categoría de un documento. Recibe cualquier objeto con
// `categoria` (el NOMBRE — así lo guarda la columna) y `categoria_origen`.
//
// Son CUATRO estados, no dos, y la diferencia entre los dos últimos es lo que
// separa un informe honesto de uno falso:
//
//  · 'atribuida'      — el motor la dedujo de la glosa real.
//  · 'sin_confirmar'  — consta que el motor INTENTÓ clasificar y NO calzó
//                       ninguna palabra clave: el nombre es su catch-all.
//  · 'sin_procedencia'— `categoria_origen` es NULL. Son los documentos
//                       anteriores a la migración 077 y los del motor externo
//                       (que no informa procedencia). NO consta que haya
//                       fallado una clasificación: decir "no pudo clasificarse"
//                       de estos es afirmar un hecho que no ocurrió. Hoy es el
//                       100% de las facturas de producción.
//  · 'sin_categoria'  — no hay ni nombre que mostrar.
//
// Dos etiquetas distintas a propósito:
//  · `detalle`  — el documento conserva su nombre, marcado según su estado.
//    Esconderlo del todo dejaría el CO2e sin explicación: ese número se calculó
//    con el factor de esa categoría, y el cliente tiene derecho a saber cuál.
//  · `agregado` — en donuts y totales la porción se rotula "Sin clasificar".
//    Acumularla bajo el nombre del catch-all la convierte en un hallazgo
//    ("Servicios: 40% de tus emisiones") que nadie calculó.
export function categoriaParaMostrar(f) {
  const nombre = f?.categoria || null;
  const origen = f?.categoria_origen ?? null;
  const confirmada = esAtribuible(origen);
  const estado = confirmada ? 'atribuida'
    : !nombre ? 'sin_categoria'
      : origen === null ? 'sin_procedencia'
        : 'sin_confirmar';
  const sufijo = { sin_confirmar: ' · sin confirmar', sin_procedencia: ' · procedencia no registrada' };
  return {
    nombre,
    confirmada,
    estado,
    agregado: confirmada && nombre ? nombre : SIN_CLASIFICAR,
    detalle: estado === 'sin_categoria' ? SIN_CLASIFICAR : `${nombre}${sufijo[estado] || ''}`,
  };
}

// Para el LIBRO de Capital Natural la pregunta NO es la misma, y la divergencia
// vive acá y no escondida en un `if` de otro archivo (la auditoría encontró que
// capitalNatural.js y esAtribuible() se contradecían sobre NULL, y que por eso
// dos PDF del mismo documento decían cosas distintas).
//
// Un informe AFIRMA ("este documento es Alcance 2"), y de un NULL no consta de
// dónde salió la categoría: no se afirma. El libro de Capital Natural REGISTRA
// un flujo físico ya ocurrido, sus asientos están sellados por hash desde antes
// de la migración 077, y el motor externo —el otro productor de NULL— devuelve
// 'Sin categoría' cuando no sabe, no un catch-all con factor físico. Frenar los
// NULL acá no arreglaría el histórico (es inmutable) y además cortaría un libro
// que hoy cuadra.
//
// Lo que SÍ se frena es el catch-all, que es donde nace el dato inventado.
export function clasificaParaCuentasFisicas(origen) {
  return origen == null || esAtribuible(origen);
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
