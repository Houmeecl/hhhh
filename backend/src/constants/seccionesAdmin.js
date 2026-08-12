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
  'datos_personales', 'proveedores',
];

export function seccionesValidas(arr) {
  return Array.isArray(arr) && arr.every((s) => SECCIONES_ADMIN.includes(s));
}

// 'dashboard' es el landing de toda cuenta: su ruta backend no se gatea y
// el selector del panel lo manda SIEMPRE marcado (secciones.js, `siempre:
// true`). Nunca cuenta como "sección otorgada de más" — sin esta excepción,
// un admin cuya propia cuenta no lo tenga listado no podría crear a nadie
// desde la UI.
export const SECCIONES_SIEMPRE = ['dashboard'];

// Qué secciones de `pedidas` NO puede otorgar quien tiene `propias`.
// Arreglo vacío = puede otorgarlas todas.
//
// Sin este límite, cualquier cuenta con la sección 'usuarios' podía
// editarse a SÍ MISMA y quedarse con el vocabulario completo: una escalada
// de privilegios silenciosa dentro del panel (no llega a superadmin — eso
// lo protege aparte la migración 069 — pero sí al equivalente funcional de
// "ver y usar todo"). El llamador exime al superadmin, que por diseño ya
// pasa cualquier requireSeccion.
export function seccionesNoOtorgables(pedidas, propias) {
  const tiene = new Set([...(propias || []), ...SECCIONES_SIEMPRE]);
  return (pedidas || []).filter((s) => !tiene.has(s));
}
