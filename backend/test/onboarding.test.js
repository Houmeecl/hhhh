import { test } from 'node:test';
import assert from 'node:assert/strict';
import { etapaOnboarding, colaOnboarding, BLOQUEADO_POR } from '../src/services/onboarding.js';

// ============================================================
// La cola de onboarding (services/onboarding.js).
//
// Lo que estos casos cuidan, en orden de importancia:
//
//  1. QUE "NADIE MANDÓ NADA" Y "SE VENCIÓ" NO SE CONFUNDAN. Las dos filas
//     salen de la misma consulta y las dos se ven como "sin activar", pero
//     una se arregla reenviando y la otra también... salvo que si el
//     vencimiento se filtra en el SQL, ambas colapsan en la misma etapa y
//     el panel pierde la única señal de que el enlace ya no sirve. Por eso
//     la comparación con `ahora` vive acá y no en el WHERE.
//  2. QUE UN CONTRATO EN BORRADOR CUENTE. El gate real del panel
//     (routes/origen.js) solo excluye 'anulado'. Si acá se exigiera
//     'aceptado', la cola pediría emitir contratos a empresas que ya
//     tienen el panel abierto — y emitirlos daría 409.
//  3. QUE NUNCA SE OFREZCA UN BOTÓN QUE VA A FALLAR. Una cuenta suspendida
//     rechaza el reenvío de invitación con 409 a propósito (activar deja
//     estado='activo' y sería deshacer la suspensión de rebote). Tiene que
//     salir como etapa propia, no como 'invitacion_vencida'.
//  4. QUE "ESPERA POR NOSOTROS" SEA HONESTO. Ese número va al Dashboard;
//     inflarlo con esperas que no dependen de nosotros lo vuelve ruido y
//     el aviso deja de mirarse.
//
// Todo puro, sin base: así el caso "el enlace venció" se prueba sin
// esperar 48 horas.
// ============================================================

const AHORA = new Date('2026-08-19T12:00:00Z');
const VIVO = '2026-08-20T12:00:00Z';   // dentro de las 48 h
const MUERTO = '2026-08-18T12:00:00Z'; // ya pasó

const activada = (extra = {}) => ({
  usuario_id: 'u1', usuario_estado: 'activo', must_reset_password: false, ...extra,
});

test('sin cuenta: la empresa existe y nadie puede entrar', () => {
  const r = etapaOnboarding({ usuario_id: null }, AHORA);
  assert.equal(r.etapa, 'sin_cuenta');
  assert.equal(r.accion, 'crear_acceso');
  assert.equal(r.bloqueado_por, BLOQUEADO_POR.NOSOTROS);
});

test('invitación viva: espera la empresa y NO se ofrece botón', () => {
  const r = etapaOnboarding(
    { usuario_id: 'u1', usuario_estado: 'activo', must_reset_password: true, invitacion_expira: VIVO },
    AHORA
  );
  assert.equal(r.etapa, 'sin_activar');
  assert.equal(r.accion, null);
  assert.equal(r.bloqueado_por, BLOQUEADO_POR.EMPRESA);
});

test('invitación vencida: vuelve a ser nuestra y se puede reenviar', () => {
  const r = etapaOnboarding(
    { usuario_id: 'u1', usuario_estado: 'activo', must_reset_password: true, invitacion_expira: MUERTO },
    AHORA
  );
  assert.equal(r.etapa, 'invitacion_vencida');
  assert.equal(r.accion, 'reenviar_invitacion');
  assert.equal(r.bloqueado_por, BLOQUEADO_POR.NOSOTROS);
});

test('cuenta creada sin ningún token: también es invitación vencida', () => {
  // No es lo mismo que el caso anterior en la base (una fila no existe, la
  // otra caducó) pero para el admin la acción es idéntica: mandar una nueva.
  const r = etapaOnboarding(
    { usuario_id: 'u1', usuario_estado: 'activo', must_reset_password: true, invitacion_expira: null },
    AHORA
  );
  assert.equal(r.etapa, 'invitacion_vencida');
});

test('el vencimiento se decide contra `ahora`, no contra el reloj del proceso', () => {
  const fila = { usuario_id: 'u1', usuario_estado: 'activo', must_reset_password: true, invitacion_expira: VIVO };
  assert.equal(etapaOnboarding(fila, new Date('2026-08-19T12:00:00Z')).etapa, 'sin_activar');
  assert.equal(etapaOnboarding(fila, new Date('2026-08-21T12:00:00Z')).etapa, 'invitacion_vencida');
});

test('una fecha basura no se toma por enlace vivo', () => {
  const r = etapaOnboarding(
    { usuario_id: 'u1', usuario_estado: 'activo', must_reset_password: true, invitacion_expira: 'no-es-fecha' },
    AHORA
  );
  assert.equal(r.etapa, 'invitacion_vencida');
});

test('cuenta suspendida: etapa propia, nunca "reenviar" (el backend lo rechaza con 409)', () => {
  const r = etapaOnboarding(
    { usuario_id: 'u1', usuario_estado: 'suspendido', must_reset_password: true, invitacion_expira: MUERTO },
    AHORA
  );
  assert.equal(r.etapa, 'cuenta_suspendida');
  assert.notEqual(r.accion, 'reenviar_invitacion');
});

test('activada sin completar sus datos: espera la empresa', () => {
  const r = etapaOnboarding(activada({ onboarding_completado_at: null }), AHORA);
  assert.equal(r.etapa, 'sin_datos');
  assert.equal(r.bloqueado_por, BLOQUEADO_POR.EMPRESA);
});

test('datos listos y sin contrato: el pendiente que nadie veía', () => {
  const r = etapaOnboarding(activada({ onboarding_completado_at: '2026-08-10', con_contrato: false }), AHORA);
  assert.equal(r.etapa, 'sin_contrato');
  assert.equal(r.accion, 'emitir_contrato');
  assert.equal(r.bloqueado_por, BLOQUEADO_POR.NOSOTROS);
});

test('con contrato: listo, y no vuelve a aparecer en la cola', () => {
  const fila = activada({ onboarding_completado_at: '2026-08-10', con_contrato: true });
  assert.equal(etapaOnboarding(fila, AHORA).etapa, 'listo');
  assert.equal(colaOnboarding([fila], AHORA).empresas.length, 0);
});

test('un contrato en borrador ya abre el panel, así que no es pendiente', () => {
  // `con_contrato` lo calcula el SQL con `estado <> anulado` — mismo criterio
  // que el gate de GET /panel-proveedor/perfil. Exigir 'aceptado' acá haría
  // que la cola pidiera emitir un contrato que ya existe (y daría 409).
  const enBorrador = activada({ onboarding_completado_at: '2026-08-10', con_contrato: true });
  assert.equal(etapaOnboarding(enBorrador, AHORA).etapa, 'listo');
});

test('la cola cuenta solo lo que depende de nosotros', () => {
  const filas = [
    { usuario_id: null },                                                           // nuestra
    { usuario_id: 'u', usuario_estado: 'activo', must_reset_password: true, invitacion_expira: VIVO }, // de ellos
    activada({ onboarding_completado_at: null }),                                   // de ellos
    activada({ onboarding_completado_at: '2026-08-10', con_contrato: false }),       // nuestra
    activada({ onboarding_completado_at: '2026-08-10', con_contrato: true }),        // fuera
  ];
  const cola = colaOnboarding(filas, AHORA);
  assert.equal(cola.empresas.length, 4);
  assert.equal(cola.esperando_por_nosotros, 2);
});

test('cada empresa de la cola trae con qué pintarla', () => {
  const [e] = colaOnboarding([{ usuario_id: null, nombre_empresa: 'Ejemplo SpA' }], AHORA).empresas;
  assert.equal(e.nombre_empresa, 'Ejemplo SpA'); // la fila original no se pierde
  assert.ok(e.descripcion && e.descripcion.length > 10);
  assert.ok(e.etapa && e.bloqueado_por);
});

test('una cola vacía no es un error: cero pendientes es un estado válido', () => {
  const cola = colaOnboarding([], AHORA);
  assert.deepEqual(cola, { empresas: [], esperando_por_nosotros: 0 });
});
