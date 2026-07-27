// ============================================================
// Compensaciones POS de mostrador — helpers PUROS (sin BD, sin red).
// El monto SIEMPRE se calcula en el SERVIDOR: t CO2e de la sesión ×
// tarifa vigente (config_pos), redondeado a pesos enteros. Jamás se
// confía en montos calculados por el cliente.
// Hoy el flujo público solo acepta 'simulado' (pago simulado, sin
// pasarela conectada) y 'omitido' (se decidió no cobrar, monto $0);
// 'pendiente' y 'pagado' quedan reservados para la pasarela real
// (VirtualPos) y solo existen a nivel de esquema.
// ============================================================

// Estados que acepta el endpoint público hoy.
export const ESTADOS_PUBLICOS = ['simulado', 'omitido'];

// Límites defensivos.
export const MAX_METODO = 40;          // largo máximo del método de pago
export const TARIFA_MAX_CLP = 1e6;     // $1.000.000 por t CO2e: más es un error de tipeo

// Valida el body del POST /api/sesiones/:id/compensacion.
// Devuelve { ok: true, estado, metodo } (metodo saneado o null)
// o { ok: false, error: 'mensaje en español' }.
export function validarCompensacion({ metodo, estado } = {}) {
  if (!ESTADOS_PUBLICOS.includes(estado)) {
    return { ok: false, error: "El estado debe ser 'simulado' u 'omitido'." };
  }
  if (metodo === undefined || metodo === null || metodo === '') {
    return { ok: true, estado, metodo: null };
  }
  if (typeof metodo !== 'string' || !metodo.trim()) {
    return { ok: false, error: 'El método de pago es inválido.' };
  }
  if (metodo.trim().length > MAX_METODO) {
    return { ok: false, error: `El método de pago no puede superar ${MAX_METODO} caracteres.` };
  }
  return { ok: true, estado, metodo: metodo.trim() };
}

// Valida la tarifa que edita el admin (PUT /api/admin/pos/config).
// Devuelve { ok: true, tarifa } (Number) o { ok: false, error }.
export function validarTarifa(valor) {
  const t = Number(valor);
  if (typeof valor === 'boolean' || valor === null || valor === undefined ||
      valor === '' || !Number.isFinite(t)) {
    return { ok: false, error: 'La tarifa debe ser un número (CLP por t CO2e).' };
  }
  if (t <= 0) {
    return { ok: false, error: 'La tarifa debe ser mayor que 0.' };
  }
  if (t > TARIFA_MAX_CLP) {
    return { ok: false, error: 'La tarifa supera el máximo permitido ($1.000.000 por t CO2e).' };
  }
  return { ok: true, tarifa: t };
}

// Valida el tipo de cambio USD→CLP que fija el admin (migración 018).
// null / '' / undefined es VÁLIDO y significa "limpiar": el frontend deja
// de mostrar USD. El valor lo pone el admin a mano citando su fuente.
// Devuelve { ok: true, tipo_cambio } (Number o null) o { ok: false, error }.
export const TIPO_CAMBIO_MAX_CLP = 5000; // CLP por USD: más es un error de tipeo

export function validarTipoCambio(valor) {
  if (valor === null || valor === undefined || valor === '') {
    return { ok: true, tipo_cambio: null };
  }
  const t = Number(valor);
  if (typeof valor === 'boolean' || !Number.isFinite(t)) {
    return { ok: false, error: 'El tipo de cambio debe ser un número (CLP por USD) o null para limpiarlo.' };
  }
  if (t <= 0) {
    return { ok: false, error: 'El tipo de cambio debe ser mayor que 0.' };
  }
  if (t > TIPO_CAMBIO_MAX_CLP) {
    return { ok: false, error: 'El tipo de cambio supera el máximo permitido ($5.000 por USD).' };
  }
  return { ok: true, tipo_cambio: t };
}

// Equivalente en USD de un monto CLP con el tipo de cambio vigente.
// null si falta el tipo de cambio o el monto no es un número > 0 — el
// frontend simplemente no muestra USD (mismo criterio que el POS).
// Redondeo a 2 decimales; siempre calculado en el SERVIDOR.
export function montoUsdDesdeClp(montoClp, tipoCambio) {
  const m = Number(montoClp);
  const tc = Number(tipoCambio);
  if (!Number.isFinite(m) || m <= 0) return null;
  if (!Number.isFinite(tc) || tc <= 0) return null;
  return Math.round((m / tc) * 100) / 100;
}

// Monto a cobrar en CLP: ROUND(t_co2e × tarifa), pesos enteros.
// Un trámite 'omitido' registra la decisión pero cobra $0.
// Valores no numéricos o negativos jamás producen un cobro (0).
export function calcularMonto(tCo2e, tarifa, estado) {
  if (estado === 'omitido') return 0;
  const t = Number(tCo2e);
  const tf = Number(tarifa);
  if (!Number.isFinite(t) || !Number.isFinite(tf) || t <= 0 || tf <= 0) return 0;
  return Math.round(t * tf);
}
