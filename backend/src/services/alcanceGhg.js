import { citaFuente } from './pdf.js';

// ============================================================
// Parseo de motor_categorias.alcance_ghg ("Alcance N · Cat. M — desc")
// hacia forma estructurada, SOLO al leer — NO se persiste: el campo es
// texto libre editable desde el panel (PUT /admin/motor-propio/categorias/:codigo)
// sin validar el patrón, así que una columna derivada persistida podría
// desincronizarse sin que nada la vuelva a derivar. Tolerante: texto que
// no calza con el patrón no revienta el export, solo queda sin clasificar.
// ============================================================

const PATRON = /^Alcance\s+([123])(?:\s*·\s*Cat\.\s*(\d{1,2}))?\s*—\s*(.+)$/;

export function parsearAlcanceGHG(texto) {
  const s = String(texto ?? '').trim();
  const m = PATRON.exec(s);
  if (!m) return { alcance: null, categoria: null, descripcion: s || null };
  return { alcance: Number(m[1]), categoria: m[2] ? Number(m[2]) : null, descripcion: m[3].trim() };
}

// Nombres canónicos de las 15 categorías de Alcance 3, GHG Protocol —
// Corporate Value Chain (Scope 3) Standard (WRI/WBCSD, 2011). Fijo por
// definición del estándar, no editable desde el panel. Debe coincidir
// con la fuente registrada en fuentes_metodologicas por la migración 036
// (verificado en test/fuenteScope3.test.js).
export const CATEGORIAS_ALCANCE3_GHG_PROTOCOL = {
  1: 'Bienes y servicios adquiridos',
  2: 'Bienes de capital',
  3: 'Actividades relacionadas con combustibles y energía (no incluidas en Alcance 1 o 2)',
  4: 'Transporte y distribución — aguas arriba',
  5: 'Residuos generados en las operaciones',
  6: 'Viajes de negocios',
  7: 'Desplazamiento de empleados',
  8: 'Activos arrendados — aguas arriba',
  9: 'Transporte y distribución — aguas abajo',
  10: 'Procesamiento de productos vendidos',
  11: 'Uso de productos vendidos',
  12: 'Fin de vida de productos vendidos',
  13: 'Activos arrendados — aguas abajo',
  14: 'Franquicias',
  15: 'Inversiones',
};

export const CITA_CATEGORIAS_ALCANCE3 = citaFuente({
  organismo: 'WRI/WBCSD — GHG Protocol',
  documento: 'Corporate Value Chain (Scope 3) Accounting and Reporting Standard',
  version_anio: '2011',
});

// Agrega filas crudas (rut_proveedor, alcance_ghg, total_co2e, organismo,
// documento, version_anio) por (proveedor, categoría Alcance 3). Se hace
// en JS porque la clave de agrupación es el número YA PARSEADO del texto
// libre (evita duplicar el regex en SQL) y porque permite juntar, sin
// perder información, más de una descripción textual del motor bajo el
// mismo número de categoría Scope 3 (ej. Cat. 1 sale tanto de
// 'materiales' como de 'agua_potable').
export function agregarAlcance3(rows) {
  const grupos = new Map();
  for (const r of rows) {
    const { alcance, categoria, descripcion } = parsearAlcanceGHG(r.alcance_ghg);
    if (alcance !== 3) continue; // defensivo — la query ya filtra 'Alcance 3%'
    const clave = `${r.rut_proveedor}::${categoria ?? 'sin_categoria'}`;
    if (!grupos.has(clave)) {
      grupos.set(clave, {
        rut_proveedor: r.rut_proveedor,
        categoria_numero: categoria,
        categoria_nombre: categoria ? (CATEGORIAS_ALCANCE3_GHG_PROTOCOL[categoria] || null) : null,
        descripciones: new Set(),
        n_documentos: 0,
        total_tco2e: 0,
        fuente_factor: citaFuente({ organismo: r.organismo, documento: r.documento, version_anio: r.version_anio }),
      });
    }
    const g = grupos.get(clave);
    if (descripcion) g.descripciones.add(descripcion);
    g.n_documentos += 1;
    g.total_tco2e = Math.round((g.total_tco2e + Number(r.total_co2e || 0)) * 10000) / 10000;
  }
  return [...grupos.values()]
    .map(({ descripciones, ...g }) => ({ ...g, descripcion_motor: [...descripciones].join('; ') }))
    .sort((a, b) => a.rut_proveedor.localeCompare(b.rut_proveedor) || (a.categoria_numero ?? 99) - (b.categoria_numero ?? 99));
}
