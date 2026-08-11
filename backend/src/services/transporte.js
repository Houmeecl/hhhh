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

const round3 = (n) => Math.round(n * 1000) / 1000;

// Resumen por modo y por período (mes) — mismo patrón que resumenRep en
// services/repProveedor.js. `viajes` trae fecha, modo, modo_nombre, km,
// co2e (ya calculado y persistido, no se recalcula acá).
export function resumenTransporte(viajes) {
  const porModo = new Map();    // modo → { nombre, km, co2e, n }
  const porPeriodo = new Map(); // 'AAAA-MM' → { km, co2e, n }
  let km = 0;
  let co2e = 0;

  for (const v of viajes) {
    const periodo = String(v.fecha).slice(0, 7);
    km += Number(v.km);
    co2e += Number(v.co2e);

    const p = porPeriodo.get(periodo) || { km: 0, co2e: 0, n: 0 };
    p.km += Number(v.km); p.co2e += Number(v.co2e); p.n += 1;
    porPeriodo.set(periodo, p);

    const m = porModo.get(v.modo) || { nombre: v.modo_nombre || v.modo, km: 0, co2e: 0, n: 0 };
    m.km += Number(v.km); m.co2e += Number(v.co2e); m.n += 1;
    porModo.set(v.modo, m);
  }

  return {
    por_modo: [...porModo.entries()]
      .map(([modo, m]) => ({ modo, nombre: m.nombre, km: round3(m.km), co2e: round4(m.co2e), n_viajes: m.n }))
      .sort((a, b) => b.co2e - a.co2e),
    por_periodo: [...porPeriodo.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([periodo, p]) => ({ periodo, km: round3(p.km), co2e: round4(p.co2e), n_viajes: p.n })),
    total: { km: round3(km), co2e: round4(co2e), n_viajes: viajes.length },
  };
}
