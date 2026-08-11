// ============================================================
// Vocabulario de secciones del panel admin sicrep — un slug por cada
// entrada del NAV (frontend/src/admin/secciones.js es el espejo con la
// metadata visual; la migración 092 lo replica en el CHECK de la
// columna usuarios.secciones_admin). Los tres deben mantenerse
// sincronizados: agregar una sección nueva = tocar los tres + una
// migración que reescriba el CHECK (mismo patrón que el CHECK de
// `panel` en 042/046/058/062).
// ============================================================

export const SECCIONES_ADMIN = [
  'dashboard', 'enrolar', 'clientes', 'sesiones', 'buscar', 'metricas', 'sii',
  'capital_natural', 'trazabilidad', 'transporte', 'corredor', 'origen',
  'capacitacion', 'apl', 'prospectos', 'auspiciadores', 'juego',
  'accesos_externos', 'motor_propio', 'motor_externo', 'usuarios', 'actividad',
  'datos_personales',
];

export function seccionesValidas(arr) {
  return Array.isArray(arr) && arr.every((s) => SECCIONES_ADMIN.includes(s));
}
