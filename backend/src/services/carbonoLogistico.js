// ============================================================
// Carbono logístico de una Carga Bioceánica — GHG Protocol Categoría 4
// (Upstream Transportation and Distribution): toneladas × km × factor
// de emisión (kgCO2e/t-km). Deliberadamente NO reutiliza
// transporte_viajes (migración 008, Categoría 7 — transporte de
// personal: modo+km+pasajeros→co2e) porque es otra categoría y no
// tiene ningún campo de carga/toneladas.
//
// El factor viene de metodologias_pais.factores (JSONB ya existente,
// sin migración de esquema — solo se agregan claves nuevas
// `${modo}_kgco2e_tkm` vía el admin de Corredor ya construido). Si el
// país no tiene el factor cargado, se devuelve sin calcular (nunca se
// inventa un número): el admin sigue pudiendo cargar co2e_aportado a
// mano en el eslabón, como hoy.
// ============================================================

export function calcularCarbonoLogistico({ modo, cantidad_t, distancia_km, factores }) {
  const clave = `${modo}_kgco2e_tkm`;
  const factor = Number(factores?.[clave]);
  const t = Number(cantidad_t);
  const km = Number(distancia_km);

  if (!Number.isFinite(factor) || factor <= 0) {
    return { calculado: false, motivo: `Sin factor '${clave}' cargado para este país.` };
  }
  if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(km) || km <= 0) {
    return { calculado: false, motivo: 'cantidad_t y distancia_km deben ser mayores que 0.' };
  }

  const co2e_kg = t * km * factor;
  return {
    calculado: true,
    co2e_t: Math.round((co2e_kg / 1000) * 10000) / 10000,
    detalle: { modo, cantidad_t: t, distancia_km: km, factor_kgco2e_tkm: factor },
    fuente_metodologica_codigo: 'ghg_protocol_cat4_transporte',
  };
}
