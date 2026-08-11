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

// Los cuatro estados del backend, con el mismo nombre. Ver allá el porqué de
// separar 'sin_confirmar' (el motor intentó y no calzó) de 'sin_procedencia'
// (no consta que haya intentado): decirle "no pudo clasificarse" al segundo es
// afirmar un hecho que no ocurrió.
export function estadoCategoria(f) {
  const nombre = f?.categoria || null;
  const origen = f?.categoria_origen ?? null;
  if (esAtribuible(origen)) return 'atribuida';
  if (!nombre) return 'sin_categoria';
  return origen === null ? 'sin_procedencia' : 'sin_confirmar';
}

// `detalle`  — el documento conserva su nombre, marcado. Esconderlo dejaría el
//              CO2e sin explicación: se calculó con el factor de esa categoría.
// `agregado` — en donuts y totales va bajo "Sin clasificar": acumular bajo el
//              nombre del catch-all lo convierte en un hallazgo que nadie calculó.
//
// El texto de `detalle` es es-CL fijo, así que solo sirve en pantallas que no
// están traducidas. Las que sí lo están (pasaporte público, verificación por
// QR) arman su etiqueta con `estado` y sus propias claves i18n.
export function categoriaParaMostrar(f) {
  const nombre = f?.categoria || null;
  const estado = estadoCategoria(f);
  const sufijo = { sin_confirmar: ' · sin confirmar', sin_procedencia: ' · procedencia no registrada' };
  return {
    nombre,
    confirmada: estado === 'atribuida',
    estado,
    agregado: estado === 'atribuida' && nombre ? nombre : SIN_CLASIFICAR,
    detalle: estado === 'sin_categoria' ? SIN_CLASIFICAR : `${nombre}${sufijo[estado] || ''}`,
  };
}
