// ============================================================
// Utilidades REP — Ley 20.920 (Responsabilidad Extendida del Productor).
// Funciones puras para la declaración de envases y embalajes que hace el
// operador en el terminal del mostrador presencial de sicr3p: composición por componentes
// (material, peso, cantidad, reciclabilidad) y % de reciclabilidad en vivo,
// siguiendo la fórmula del packaging-calculator de SICREP:
//   % reciclabilidad = peso reciclable / peso total × 100.
// Nada de esto reemplaza la declaración formal ante el MMA (RETC/SGR);
// es una pre-declaración operativa en el punto de captura.
// ============================================================

// Productos prioritarios "envases y embalajes" (Ley 20.920): las categorías
// de material con que se declara la composición de un embalaje.
export const MATERIALES_REP = [
  { codigo: 'papel_carton', nombre: 'Papel y cartón' },
  { codigo: 'plasticos', nombre: 'Plásticos' },
  { codigo: 'vidrio', nombre: 'Vidrio' },
  { codigo: 'metales', nombre: 'Metales' },
  { codigo: 'madera', nombre: 'Madera' },
  { codigo: 'compuestos', nombre: 'Compuestos' },
  { codigo: 'otros', nombre: 'Otros' },
];

// Umbral de exención del Art. 25 de la Ley 20.920: productores que ponen en
// el mercado menos de 300 kg de envases al año pueden quedar eximidos del
// cumplimiento de metas.
export const UMBRAL_EXENCION_REP_KG = 300;

export const EXENCION_REP_NOTA =
  `Si pones en el mercado menos de ${UMBRAL_EXENCION_REP_KG} kg de envases al año, ` +
  'podrías quedar exento de las obligaciones de metas REP (Art. 25, Ley 20.920). ' +
  'Dato referencial — validar con el MMA.';

// Calcula la reciclabilidad de un embalaje declarado por componentes.
// componentes: [{ material, peso_gr, cantidad, reciclable }]
//   - peso_gr: peso unitario del componente en gramos.
//   - cantidad: unidades de ese componente (si viene vacío se asume 1).
//   - reciclable: true si el componente es reciclable en Chile.
// Devuelve { peso_total_gr, peso_reciclable_gr, porcentaje, nivel } con
// porcentaje a 1 decimal y nivel 'Alto' (≥70), 'Medio' (≥50) o 'Bajo' (<50).
// Sin componentes (o con peso total 0) el nivel es null: no hay qué evaluar.
export function calcularReciclabilidad(componentes) {
  const lista = Array.isArray(componentes) ? componentes : [];

  let pesoTotal = 0;
  let pesoReciclable = 0;

  for (const c of lista) {
    const pesoUnitario = Number(c?.peso_gr) || 0;
    // Cantidad vacía o no ingresada aún → se asume 1 unidad.
    const cantidad =
      c?.cantidad === undefined || c?.cantidad === null || c?.cantidad === ''
        ? 1
        : Number(c.cantidad) || 0;
    const peso = pesoUnitario * cantidad;
    if (peso <= 0) continue;
    pesoTotal += peso;
    if (c?.reciclable) pesoReciclable += peso;
  }

  if (pesoTotal <= 0) {
    return { peso_total_gr: 0, peso_reciclable_gr: 0, porcentaje: 0, nivel: null };
  }

  // Fórmula SICREP packaging-calculator, redondeada a 1 decimal.
  const porcentaje = Math.round((pesoReciclable / pesoTotal) * 1000) / 10;
  const nivel = porcentaje >= 70 ? 'Alto' : porcentaje >= 50 ? 'Medio' : 'Bajo';

  return {
    peso_total_gr: pesoTotal,
    peso_reciclable_gr: pesoReciclable,
    porcentaje,
    nivel,
  };
}
