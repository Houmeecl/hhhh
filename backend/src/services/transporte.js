// ============================================================
// Transporte de personal — GHG Protocol Categoría 7.
// Cálculo puro (testeable sin DB), usado por routes/transporte.js.
// ============================================================

const round4 = (n) => Math.round(n * 10000) / 10000;

/**
 * co2e (t) = km × (ida_vuelta ? 2 : 1) × pasajeros × factor(kgCO2e/pkm) / 1000
 * @param {{ km:number, pasajeros?:number, ida_vuelta?:boolean, factor_kgco2e_pkm:number }} p
 * @returns {number} tCO2e, redondeado a 4 decimales
 */
export function calcularCo2eViaje({ km, pasajeros, ida_vuelta, factor_kgco2e_pkm }) {
  const pax = Math.max(1, Number(pasajeros) || 1);
  const tramos = ida_vuelta ? 2 : 1;
  return round4((Number(km) * tramos * pax * Number(factor_kgco2e_pkm)) / 1000);
}
