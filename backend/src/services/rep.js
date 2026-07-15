// ============================================================
// Servicio REP — Ley 20.920 (Responsabilidad Extendida del Productor).
// Funciones PURAS (sin BD, sin red) para validar y recalcular en el
// SERVIDOR la declaración de envases y embalajes que llega del POS.
// El % de reciclabilidad SIEMPRE se recalcula acá con la fórmula del
// packaging-calculator de SICREP (la misma de frontend/src/lib/rep.js):
//   % reciclabilidad = peso reciclable / peso total × 100
// con nivel 'Alto' (≥70), 'Medio' (≥50) o 'Bajo' (<50).
// Jamás se confía en porcentajes o niveles calculados por el cliente.
// ============================================================

// Productos prioritarios "envases y embalajes" (Ley 20.920): mismos
// 7 códigos de material que usa el frontend.
export const MATERIALES_REP = [
  { codigo: 'papel_carton', nombre: 'Papel y cartón' },
  { codigo: 'plasticos', nombre: 'Plásticos' },
  { codigo: 'vidrio', nombre: 'Vidrio' },
  { codigo: 'metales', nombre: 'Metales' },
  { codigo: 'madera', nombre: 'Madera' },
  { codigo: 'compuestos', nombre: 'Compuestos' },
  { codigo: 'otros', nombre: 'Otros' },
];

const CODIGOS_VALIDOS = new Set(MATERIALES_REP.map((m) => m.codigo));

// Límites defensivos de la declaración.
export const MAX_COMPONENTES = 50;
export const MAX_PESO_GR = 1e7;   // 10 toneladas por componente: más es un error de tipeo
export const MAX_CANTIDAD = 1e6;

// Valida el array de componentes que llega del cliente.
// componentes: [{ material, peso_gr, cantidad, reciclable }]
// Devuelve { ok: true } o { ok: false, error: 'mensaje en español' }.
export function validarComponentes(componentes) {
  if (!Array.isArray(componentes) || componentes.length === 0) {
    return { ok: false, error: 'Debes declarar al menos un componente de embalaje.' };
  }
  if (componentes.length > MAX_COMPONENTES) {
    return { ok: false, error: `Máximo ${MAX_COMPONENTES} componentes por declaración.` };
  }
  for (let i = 0; i < componentes.length; i++) {
    const c = componentes[i];
    const n = i + 1;
    if (!c || typeof c !== 'object' || Array.isArray(c)) {
      return { ok: false, error: `Componente ${n}: formato inválido.` };
    }
    if (!CODIGOS_VALIDOS.has(c.material)) {
      return { ok: false, error: `Componente ${n}: material inválido.` };
    }
    const peso = Number(c.peso_gr);
    if (typeof c.peso_gr === 'boolean' || !Number.isFinite(peso) || peso <= 0) {
      return { ok: false, error: `Componente ${n}: el peso (gr) debe ser un número mayor que 0.` };
    }
    if (peso > MAX_PESO_GR) {
      return { ok: false, error: `Componente ${n}: el peso supera el máximo permitido.` };
    }
    const cantidad = Number(c.cantidad);
    if (typeof c.cantidad === 'boolean' || !Number.isInteger(cantidad) || cantidad < 1) {
      return { ok: false, error: `Componente ${n}: la cantidad debe ser un entero mayor o igual a 1.` };
    }
    if (cantidad > MAX_CANTIDAD) {
      return { ok: false, error: `Componente ${n}: la cantidad supera el máximo permitido.` };
    }
    if (typeof c.reciclable !== 'boolean') {
      return { ok: false, error: `Componente ${n}: reciclable debe ser verdadero o falso.` };
    }
  }
  return { ok: true };
}

// Calcula la reciclabilidad de un embalaje declarado por componentes.
// MISMA fórmula y umbrales que frontend/src/lib/rep.js:
//   - peso_gr es el peso unitario; cantidad vacía se asume 1.
//   - porcentaje = peso reciclable / peso total × 100, a 1 decimal.
//   - nivel 'Alto' (≥70), 'Medio' (≥50), 'Bajo' (<50); null si no hay peso.
export function calcularReciclabilidad(componentes) {
  const lista = Array.isArray(componentes) ? componentes : [];

  let pesoTotal = 0;
  let pesoReciclable = 0;

  for (const c of lista) {
    const pesoUnitario = Number(c?.peso_gr) || 0;
    // Cantidad vacía o no ingresada → se asume 1 unidad.
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
