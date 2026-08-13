// ============================================================
// Retención y purga de datos personales.
//
// La Ley 21.719 pide conservar el dato personal solo mientras dure la
// finalidad que lo justifica. Hasta ahora en sicr3p no se borraba nada:
// el log de actividad acumulaba IPs indefinidamente y las postulaciones
// rechazadas conservaban el teléfono de quien postuló para siempre.
//
// DOS CRITERIOS QUE EXPLICAN TODAS LAS DECISIONES DE ABAJO:
//
// 1. ANONIMIZAR ANTES QUE BORRAR, cuando el registro tiene valor
//    probatorio. En `actividad_log` el dato personal es la IP; el resto
//    de la fila —quién, qué, cuándo— es justamente la prueba de
//    accountability que la misma ley exige. Borrar la fila entera
//    debilitaría el cumplimiento en vez de mejorarlo.
//
// 2. LO ENCADENADO NO SE TOCA. Facturas, declaraciones REP, contratos y
//    Capital Natural están sellados por hash: borrar o editar una fila
//    invalida todos los eslabones posteriores. Se conservan por
//    obligación legal (respaldo tributario) y para el ejercicio de
//    reclamaciones. `test/inventarioDatos.test.js` impide que alguien
//    agregue una purga sobre una tabla encadenada por descuido.
//
// LOS PLAZOS DE ABAJO NECESITAN CONFIRMACIÓN LEGAL. Son valores por
// defecto razonables, no cifras sacadas del texto de la ley. Están en un
// solo lugar, y en `.env` se pueden ajustar sin tocar código.
// ============================================================

import { query } from '../lib/db.js';

const dias = (envVar, porDefecto) => {
  const v = Number(process.env[envVar]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : porDefecto;
};

export const PLAZOS = {
  // La IP de una sesión de trabajo pierde utilidad forense rápido; el
  // resto del registro de actividad se conserva sin ella.
  actividad_ip: dias('RETENCION_ACTIVIDAD_IP_DIAS', 365),
  // Credenciales en tránsito: cumplida su función no hay finalidad que
  // las sostenga. El plazo corto es solo colchón de depuración.
  tokens: dias('RETENCION_TOKENS_DIAS', 30),
  // Se conserva el hecho de la postulación y su resolución; se suelta a
  // la persona que la envió.
  auspicio_rechazado: dias('RETENCION_AUSPICIO_DIAS', 365),
  // Metadato de un documento ilegible. Nunca guardó el binario.
  documentos_rechazados: dias('RETENCION_RECHAZADOS_DIAS', 365),
  // Prospecto perdido: el seguimiento comercial ya terminó.
  prospecto_perdido: dias('RETENCION_PROSPECTOS_DIAS', 730),
  // Interesado descartado: un lead liviano (solo correo, sin RUT ni
  // resolución formal) que se decidió no contactar. Sin el correo la
  // fila no informa nada, así que se borra completa — a diferencia de
  // las solicitudes con RUT, donde el hecho sí vale conservarlo.
  interesado_descartado: dias('RETENCION_INTERESADOS_DIAS', 180),
  // Bitácora de correos: su uso es diagnosticar una entrega y poder
  // probar que un envío salió. Un año cubre de sobra el reclamo tardío
  // ("nunca me llegó el link que pagué") y el cierre contable del
  // ejercicio; pasado eso guarda el correo de alguien sin finalidad.
  correos_enviados: dias('RETENCION_CORREOS_DIAS', 365),
  // Cobro que nunca se pagó: el contacto entró a la lista desde un
  // registro de ferias, no porque lo pidiera, y pasado el plazo ya no
  // hay gestión comercial viva que sostenga guardar su correo. Mismo
  // criterio y mismo plazo que un interesado descartado. Los PAGADOS no
  // se tocan: son el respaldo de una venta.
  cobro_sin_pagar: dias('RETENCION_COBROS_DIAS', 180),
};

// Cada minuto de más acá es una consulta pesada en producción; cada
// minuto de menos, datos que sobreviven su finalidad. Una vez al día
// alcanza para un plazo medido en meses.
const INTERVALO_MS = 24 * 60 * 60 * 1000;

// ---------- funciones puras ----------

/**
 * ¿Pasó el plazo desde `fecha`? Devuelve false ante una fecha ausente o
 * inválida: no se purga lo que no se sabe cuándo entró.
 */
export function plazoVencido(fecha, diasPlazo, ahora = new Date()) {
  if (!fecha) return false;
  const t = fecha instanceof Date ? fecha.getTime() : Date.parse(fecha);
  if (!Number.isFinite(t)) return false;
  if (!Number.isFinite(diasPlazo) || diasPlazo <= 0) return false;
  return ahora.getTime() - t >= diasPlazo * 24 * 60 * 60 * 1000;
}

/** Junta el resultado de cada tarea en algo informable y guardable. */
export function resumirPurga(tareas = []) {
  const resultado = {};
  let filas = 0;
  for (const t of tareas) {
    resultado[t.nombre] = { filas: t.filas, accion: t.accion };
    filas += t.filas;
  }
  return { filas, resultado, tareas: tareas.length };
}

// ---------- las tareas ----------
//
// Cada una devuelve cuántas filas tocó. `accion` queda en la bitácora
// para que se pueda auditar qué se hizo, no solo cuánto.

const TAREAS = [
  {
    nombre: 'actividad_log.ip',
    accion: 'anonimizar',
    plazo: () => PLAZOS.actividad_ip,
    sql: `UPDATE actividad_log SET ip = NULL
           WHERE ip IS NOT NULL AND created_at < now() - ($1 || ' days')::interval`,
  },
  {
    nombre: 'tokens_magic',
    accion: 'borrar',
    plazo: () => PLAZOS.tokens,
    sql: `DELETE FROM tokens_magic
           WHERE (usado = true OR expira_at < now())
             AND created_at < now() - ($1 || ' days')::interval`,
  },
  {
    nombre: 'tokens_password',
    accion: 'borrar',
    plazo: () => PLAZOS.tokens,
    sql: `DELETE FROM tokens_password
           WHERE (usado = true OR expira_at < now())
             AND created_at < now() - ($1 || ' days')::interval`,
  },
  {
    nombre: 'solicitudes_auspicio.contacto',
    accion: 'anonimizar',
    plazo: () => PLAZOS.auspicio_rechazado,
    // Se conserva la empresa y el estado; se suelta a la persona. El
    // mensaje se va porque es texto libre: puede contener cualquier cosa.
    sql: `UPDATE solicitudes_auspicio
             SET contacto_nombre = NULL, contacto_email = '', contacto_telefono = NULL,
                 mensaje = NULL, ip = NULL
           WHERE estado = 'rechazada'
             AND resuelta_at IS NOT NULL
             AND resuelta_at < now() - ($1 || ' days')::interval
             AND (contacto_nombre IS NOT NULL OR contacto_email <> '' OR ip IS NOT NULL)`,
  },
  {
    nombre: 'solicitudes_inscripcion.contacto',
    accion: 'anonimizar',
    plazo: () => PLAZOS.auspicio_rechazado,
    // Mismo criterio que solicitudes_auspicio: se conserva la empresa y
    // la resolución; se suelta a la persona. El mensaje es texto libre.
    sql: `UPDATE solicitudes_inscripcion
             SET contacto_nombre = '', contacto_cargo = NULL, contacto_email = '',
                 contacto_telefono = NULL, mensaje = NULL, ip = NULL
           WHERE estado = 'descartada'
             AND resuelta_at IS NOT NULL
             AND resuelta_at < now() - ($1 || ' days')::interval
             AND (contacto_nombre <> '' OR contacto_email <> '' OR ip IS NOT NULL)`,
  },
  {
    nombre: 'interesados',
    accion: 'borrar',
    plazo: () => PLAZOS.interesado_descartado,
    sql: `DELETE FROM interesados
           WHERE estado = 'descartado'
             AND created_at < now() - ($1 || ' days')::interval`,
  },
  {
    nombre: 'solicitudes_arcop.ip',
    accion: 'anonimizar',
    plazo: () => PLAZOS.actividad_ip,
    // Mismo criterio que el log: la solicitud y su respuesta son la prueba
    // de que el derecho se atendió y se conservan; la IP no aporta a eso.
    sql: `UPDATE solicitudes_arcop SET ip = NULL
           WHERE ip IS NOT NULL AND estado <> 'pendiente'
             AND resuelta_at IS NOT NULL
             AND resuelta_at < now() - ($1 || ' days')::interval`,
  },
  {
    nombre: 'documentos_rechazados',
    accion: 'borrar',
    plazo: () => PLAZOS.documentos_rechazados,
    sql: `DELETE FROM documentos_rechazados
           WHERE created_at < now() - ($1 || ' days')::interval`,
  },
  {
    nombre: 'prospectos.contacto',
    accion: 'anonimizar',
    plazo: () => PLAZOS.prospecto_perdido,
    sql: `UPDATE prospectos SET contacto = NULL
           WHERE etapa = 'perdido' AND contacto IS NOT NULL
             AND created_at < now() - ($1 || ' days')::interval`,
  },
  {
    nombre: 'correos_enviados',
    accion: 'borrar',
    plazo: () => PLAZOS.correos_enviados,
    // Se borra la fila entera y no solo el correo: sin destinatario la
    // bitácora no prueba ni diagnostica nada, sería basura acumulándose.
    sql: `DELETE FROM correos_enviados
           WHERE created_at < now() - ($1 || ' days')::interval`,
  },
  {
    // El nombre es la TABLA (con `.columna` si fuera parcial): así lo lee
    // test/retencion.test.js para cruzar cada tarea contra el inventario.
    // El matiz de que solo se borran los no pagados va en el SQL y en el
    // comentario, no en el nombre.
    nombre: 'cobros',
    accion: 'borrar',
    plazo: () => PLAZOS.cobro_sin_pagar,
    // Solo los que no llegaron a pagar. `pagado`/`entregado` quedan: son
    // el respaldo de una venta, con su obligación de conservación. La
    // baja de correo NO se borra con esto — vive en `bajas_correo`, que
    // no se purga justamente para que la oposición siga valiendo.
    sql: `DELETE FROM cobros
           WHERE estado IN ('pendiente','enviado','anulado')
             AND created_at < now() - ($1 || ' days')::interval`,
  },
];

/** Los nombres de las tareas, para poder listarlas sin correrlas. */
export const nombresDeTareas = () => TAREAS.map((t) => ({ nombre: t.nombre, accion: t.accion, dias: t.plazo() }));

/**
 * Corre la purga completa y deja constancia en `purgas`.
 *
 * Cada tarea va en su propia sentencia y con su propio try: una tabla
 * que falle no puede impedir que las demás se purguen. Deliberadamente
 * NO se envuelve en una transacción única — sería un lock largo sobre
 * `actividad_log`, que se escribe en cada request.
 */
export async function purgar({ origen = 'automatica', usuarioId = null } = {}) {
  const inicio = Date.now();
  const tareas = [];
  const errores = [];

  for (const t of TAREAS) {
    try {
      const { rowCount } = await query(t.sql, [String(t.plazo())]);
      tareas.push({ nombre: t.nombre, accion: t.accion, filas: rowCount || 0 });
    } catch (e) {
      errores.push(`${t.nombre}: ${e.message}`);
      tareas.push({ nombre: t.nombre, accion: t.accion, filas: 0 });
    }
  }

  const resumen = resumirPurga(tareas);
  const duracion = Date.now() - inicio;
  const error = errores.length ? errores.join(' | ') : null;

  try {
    await query(
      `INSERT INTO purgas (origen, usuario_id, resultado, filas, duracion_ms, error)
       VALUES ($1,$2,$3::jsonb,$4,$5,$6)`,
      [origen, usuarioId, JSON.stringify(resumen.resultado), resumen.filas, duracion, error]
    );
  } catch (e) {
    // La bitácora es la prueba, pero no vale la pena perder la purga por
    // no poder anotarla.
    console.warn('[retencion] no se pudo registrar la purga:', e.message);
  }

  return { ...resumen, duracion_ms: duracion, error };
}

// ---------- arranque ----------
// Mismo patrón que iniciarDolarAutomatico() en services/tipoCambio.js:
// temporizador en proceso, idempotente y con unref() para no impedir que
// el proceso termine. No necesita cron ni nada de deploy/.
//
// Con un intervalo de 24 h y un `pm2 restart` en cada despliegue, un
// temporizador a secas no correría NUNCA: cada reinicio reinicia la
// cuenta. Por eso hay una primera corrida poco después del arranque.
// Los minutos de espera son para no competir con el arranque del
// servidor ni con las migraciones.
const RETRASO_INICIAL_MS = 5 * 60 * 1000;

let timer = null;
let inicial = null;

export function iniciarPurgaAutomatica() {
  if (timer || inicial) return timer;
  const correr = () => purgar({ origen: 'automatica' })
    .then((r) => { if (r.filas) console.log(`[retencion] purga: ${r.filas} fila(s)`); })
    .catch((e) => console.warn('[retencion]', e.message));

  inicial = setTimeout(() => {
    inicial = null;
    correr();
    timer = setInterval(correr, INTERVALO_MS);
    timer.unref?.();
  }, RETRASO_INICIAL_MS);
  inicial.unref?.();
  return inicial;
}

export function detenerPurgaAutomatica() {
  if (timer) clearInterval(timer);
  if (inicial) clearTimeout(inicial);
  timer = null;
  inicial = null;
}
