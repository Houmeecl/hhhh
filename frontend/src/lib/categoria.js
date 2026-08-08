// ============================================================
// Espejo mínimo de backend/src/services/categoriaPresentacion.js.
//
// La regla: el motor propio, cuando ninguna palabra clave calza con la glosa
// de los ítems, devuelve su catch-all. Ese código sirve para calcular pero NO
// es una clasificación del documento, así que no puede mostrarse con la misma
// cara que una categoría deducida de verdad.
//
// Este archivo existe solo para las pantallas que reciben `categoria_origen`
// crudo desde la API (el resto lo recibe ya rotulado desde el backend). Si se
// agrega un origen atribuible allá, hay que agregarlo acá.
// ============================================================

const ATRIBUIBLES = new Set(['glosa', 'xml', 'operador']);

export const SIN_CLASIFICAR = 'Sin clasificar';

export function esAtribuible(origen) {
  return ATRIBUIBLES.has(origen);
}

// `detalle`  — el documento conserva su nombre, marcado. Esconderlo dejaría el
//              CO2e sin explicación: se calculó con el factor de esa categoría.
// `agregado` — en donuts y totales va bajo "Sin clasificar": acumular bajo el
//              nombre del catch-all lo convierte en un hallazgo que nadie calculó.
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
