// ============================================================
// Cola de onboarding de empresas — función PURA.
//
// El panel del proveedor tiene CUATRO puertas en serie, y hasta ahora la
// última no tenía quien la abriera:
//
//   1. Existe la cuenta ......... `usuarios.proveedor_id`  → la abre sicr3p
//   2. La empresa activó ........ `must_reset_password`    → la abre la empresa
//   3. Completó sus datos ....... `onboarding_completado_at` → la empresa
//   4. Tiene contrato ........... `contratos` no anulado   → la abre sicr3p
//
// Las puertas 1 a 3 son visibles en alguna pantalla. La 4 no: lo único que
// emite un contrato de proveedor es POST /admin/sii/:id/contrato, y se llega
// ahí desde Contabilidad → la empresa → "Emitir contrato". Ningún camino de
// enrolamiento lo dispara. Así, una empresa enrolada activaba, completaba sus
// datos y quedaba parada en "Cuenta en revisión" hasta que un admin se
// acordara — sin cola, sin aviso, sin nada.
//
// Este módulo no abre ninguna puerta. Solo dice EN CUÁL está parada cada
// empresa y —lo que importa— QUIÉN tiene la pelota. Esa es la distinción que
// hoy no existe: las cinco situaciones se veían igual, o sea, no se veían.
//
// Puro a propósito (mismo criterio que services/expediente.js y
// lib/corredor.js): recibe una fila plana y `ahora`, no toca la base. Así el
// caso "el enlace venció" se puede probar sin esperar 48 horas.
// ============================================================

// Quién tiene que mover ficha. `sicr3p` es trabajo nuestro pendiente;
// `empresa` es espera legítima y NO se le pone botón: mostrarlo sería
// inventarle una tarea al admin sobre algo que no está en sus manos.
export const BLOQUEADO_POR = { NOSOTROS: 'sicr3p', EMPRESA: 'empresa' };

export const ETAPAS = [
  'sin_cuenta',
  'cuenta_suspendida',
  'invitacion_vencida',
  'sin_activar',
  'sin_datos',
  'sin_contrato',
  'listo',
];

// Texto para el panel. Vive acá y no en el JSX para que el backend y el
// frontend no se contradigan cuando alguno de los dos cambie.
const DESCRIPCION = {
  sin_cuenta: 'La empresa existe, pero nadie puede entrar: le falta el acceso web.',
  cuenta_suspendida: 'Su cuenta está suspendida. Reenviar la invitación no la reactiva.',
  invitacion_vencida: 'La invitación venció sin usarse. Hay que mandarle una nueva.',
  sin_activar: 'Ya le llegó la invitación; falta que entre y defina su clave.',
  sin_datos: 'Entró, pero todavía no completa los datos de su empresa.',
  sin_contrato: 'Completó todo. Falta emitirle el contrato para que se le abra el panel.',
  listo: 'Con contrato y panel abierto.',
};

const ACCION = {
  sin_cuenta: 'crear_acceso',
  cuenta_suspendida: 'reactivar',
  invitacion_vencida: 'reenviar_invitacion',
  sin_contrato: 'emitir_contrato',
};

// `fila` viene del SELECT de GET /admin/onboarding/empresas:
//   usuario_id, usuario_estado, must_reset_password,
//   invitacion_expira (max(expira_at) de los tokens de activación SIN usar,
//   vencidos incluidos), onboarding_completado_at, con_contrato.
//
// El vencimiento se decide acá y no en el SQL a propósito: "sin token vivo"
// y "sin token" son la misma consulta pero etapas distintas —una se arregla
// reenviando, la otra es que nunca se mandó—, y meter `expira_at > now()` en
// el WHERE las volvía indistinguibles.
export function etapaOnboarding(fila = {}, ahora = new Date()) {
  const etapa = clasificar(fila, ahora);
  return {
    etapa,
    descripcion: DESCRIPCION[etapa],
    accion: ACCION[etapa] || null,
    bloqueado_por: etapa === 'listo'
      ? null
      : (ACCION[etapa] ? BLOQUEADO_POR.NOSOTROS : BLOQUEADO_POR.EMPRESA),
  };
}

function clasificar(fila, ahora) {
  if (!fila.usuario_id) return 'sin_cuenta';

  // Una cuenta suspendida se chequea ANTES que la activación: si no,
  // caía en 'invitacion_vencida' y el panel ofrecía un botón de reenvío
  // que el backend rechaza con 409 (accesos.js no reactiva por esa vía,
  // porque activar deja estado='activo' y sería deshacer la suspensión
  // de rebote). Un botón que siempre falla es peor que ninguno.
  if (fila.usuario_estado && fila.usuario_estado !== 'activo') return 'cuenta_suspendida';

  if (fila.must_reset_password) {
    const expira = fila.invitacion_expira ? new Date(fila.invitacion_expira) : null;
    const viva = expira && !Number.isNaN(expira.getTime()) && expira > ahora;
    return viva ? 'sin_activar' : 'invitacion_vencida';
  }

  if (!fila.onboarding_completado_at) return 'sin_datos';

  // `con_contrato` cuenta los contratos en cualquier estado salvo 'anulado'
  // —borrador incluido—, igual que el gate real del panel
  // (routes/origen.js, GET /panel-proveedor/perfil). Si acá se exigiera
  // 'aceptado', la cola diría "falta contrato" de empresas que ya tienen el
  // panel abierto.
  if (!fila.con_contrato) return 'sin_contrato';

  return 'listo';
}

// La cola en sí: clasifica, saca las que ya están listas y cuenta las que
// esperan por nosotros. Ese número es el que va al Dashboard — el resto es
// visibilidad, no tarea.
export function colaOnboarding(filas = [], ahora = new Date()) {
  const empresas = filas
    .map((f) => ({ ...f, ...etapaOnboarding(f, ahora) }))
    .filter((e) => e.etapa !== 'listo');
  return {
    empresas,
    esperando_por_nosotros: empresas.filter((e) => e.bloqueado_por === BLOQUEADO_POR.NOSOTROS).length,
  };
}
