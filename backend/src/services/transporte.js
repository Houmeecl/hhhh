// ============================================================
// Transporte de personal — GHG Protocol Categoría 7.
// Cálculo puro (testeable sin DB), usado por routes/transporte.js.
// ============================================================

const round4 = (n) => Math.round(n * 10000) / 10000;

// Topes de cordura del registro de un traslado. No son reglas de negocio
// finas sino cortafuegos contra typos: un "215" tecleado como "2150000"
// produciría un CO2e absurdo que además se sella como cargo en la cuenta
// de carbono del Capital Natural — mejor un 400 claro que un inventario
// contaminado. 20.000 km cubre con holgura el trayecto aéreo comercial
// más largo del mundo (~16.700 km); 1.000 pasajeros, al avión de mayor
// capacidad (~850).
export const MAX_KM_VIAJE = 20000;
export const MAX_PASAJEROS_VIAJE = 1000;

// Valida el cuerpo de un traslado (Cat. 7). Devuelve {error} o {datos}
// con los valores ya normalizados — mismo patrón que leerProducto en
// repProveedor.js. Función pura (testeable sin BD ni HTTP); la existencia
// del modo en transporte_modos la verifica el llamador, que tiene la BD.
export function validarViaje({ modo, fecha, origen, destino, km, pasajeros, ida_vuelta, notas } = {}) {
  const org = String(origen || '').trim();
  const dst = String(destino || '').trim();
  if (!modo || !org || !dst) return { error: 'Modo, origen, destino y km son obligatorios.' };
  if (org.length > 120 || dst.length > 120) return { error: 'Origen y destino deben tener a lo más 120 caracteres.' };

  const kmNum = Number(km);
  if (!Number.isFinite(kmNum) || kmNum <= 0) return { error: 'Los km deben ser un número mayor que cero.' };
  if (kmNum > MAX_KM_VIAJE) {
    return { error: `Los km por tramo no pueden superar ${MAX_KM_VIAJE.toLocaleString('es-CL')} — revisa el valor.` };
  }

  // Vacío/ausente vale 1 (viaje individual); un valor presente debe ser
  // un entero positivo de verdad — "0", "-3" o "2.5" son errores de
  // digitación, no un caso que silenciosamente se corrige a 1.
  let pax = 1;
  if (pasajeros !== undefined && pasajeros !== null && String(pasajeros).trim() !== '') {
    pax = Number(pasajeros);
    if (!Number.isInteger(pax) || pax < 1) return { error: 'Los pasajeros deben ser un número entero mayor que cero.' };
    if (pax > MAX_PASAJEROS_VIAJE) {
      return { error: `Los pasajeros no pueden superar ${MAX_PASAJEROS_VIAJE.toLocaleString('es-CL')} — revisa el valor.` };
    }
  }

  // Fecha opcional (sin ella, la ruta usa CURRENT_DATE). Presente, debe
  // ser AAAA-MM-DD y no futura — margen de 1 día por zona horaria (el
  // servidor puede ir en UTC, un día "adelante" de Chile), mismo criterio
  // que las ventas de Ley REP (repProveedor.js).
  let fch = null;
  if (fecha !== undefined && fecha !== null && String(fecha).trim() !== '') {
    fch = String(fecha).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fch) || Number.isNaN(Date.parse(fch))) {
      return { error: 'La fecha del traslado debe ser AAAA-MM-DD.' };
    }
    if (Date.parse(fch) > Date.now() + 24 * 3600 * 1000) {
      return { error: 'La fecha del traslado está en el futuro — revísala.' };
    }
  }

  const nts = notas == null || String(notas).trim() === '' ? null : String(notas).trim().slice(0, 500);
  return {
    datos: {
      modo,
      fecha: fch,
      origen: org,
      destino: dst,
      km: kmNum,
      pasajeros: pax,
      ida_vuelta: ida_vuelta === true || ida_vuelta === 'true',
      notas: nts,
    },
  };
}

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
