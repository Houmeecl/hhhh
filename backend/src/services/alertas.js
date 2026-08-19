// ============================================================
// Alertas automáticas de vencimiento de contrato.
//
// QUÉ RESUELVE. Hasta ahora un contrato vencido solo se notaba si alguien
// entraba al panel de Clientes y miraba la columna de vigencia (agregada en
// esta misma tanda de mejoras). Nadie se enteraba solo. Este servicio manda
// un correo al contacto del cliente a 7/3/1 día(s) del vencimiento, y otro
// una vez cuando ya venció y sigue en estado 'activo' (nadie lo renovó).
//
// POR QUÉ SOLO 'activo'. Un contrato 'piloto' no tiene la misma urgencia
// comercial de renovación, y uno 'vencido' ya está marcado como tal — el
// aviso es para el que SIGUE activo mientras la fecha ya pasó o está por
// pasar, que es el caso que se puede perder de vista.
//
// DEDUPE POR DÍA. El job corre una vez al día (mismo patrón que
// iniciarPurgaAutomatica en retencion.js); para no duplicar en un reinicio
// del proceso se consulta `correos_enviados` por (referencia=cliente.id,
// tipo='recordatorio_vencimiento', mismo día) antes de enviar.
// ============================================================

import { query } from '../lib/db.js';
import { enviarYRegistrar } from './correoLog.js';
import { recordatorioVencimientoEmail } from './mailer.js';

// Días antes del vencimiento en que se avisa. 0 no está: el día exacto del
// vencimiento ya lo cubre el aviso de "1 día antes" del día anterior, y el
// caso vencido (dias < 0) tiene su propio aviso único más abajo.
export const DIAS_AVISO = [7, 3, 1];

const DIA_MS = 24 * 60 * 60 * 1000;

/** Días enteros hasta `fechaFin` (negativo si ya pasó). Función pura, testeable. */
export function diasHastaVencimiento(fechaFin, ahora = new Date()) {
  const fin = fechaFin instanceof Date ? fechaFin : new Date(fechaFin);
  return Math.ceil((fin.getTime() - ahora.getTime()) / DIA_MS);
}

/** ¿Ya se le envió HOY el recordatorio a este cliente? Evita duplicar en un reinicio. */
async function yaAvisadoHoy(clienteId) {
  const { rows } = await query(
    `SELECT 1 FROM correos_enviados
      WHERE tipo = 'recordatorio_vencimiento' AND referencia = $1
        AND created_at::date = now()::date
      LIMIT 1`,
    [String(clienteId)]
  );
  return rows.length > 0;
}

/**
 * Revisa todos los clientes con contrato 'activo' y fecha_fin definida, y
 * envía el recordatorio que corresponda (7/3/1 día antes, o vencido una vez
 * al día mientras nadie lo renueve). Devuelve cuántos correos salieron.
 */
export async function correrAlertasVencimiento() {
  const { rows: clientes } = await query(
    `SELECT id, nombre_empresa, contacto_email, fecha_fin
       FROM clientes
      WHERE estado_contrato = 'activo' AND fecha_fin IS NOT NULL
        AND contacto_email IS NOT NULL AND contacto_email <> ''`
  );

  let enviados = 0;
  for (const c of clientes) {
    const dias = diasHastaVencimiento(c.fecha_fin);
    const corresponde = dias < 0 || DIAS_AVISO.includes(dias);
    if (!corresponde) continue;

    try {
      if (await yaAvisadoHoy(c.id)) continue;
      const fechaFin = new Date(c.fecha_fin).toLocaleDateString('es-CL');
      const plantilla = recordatorioVencimientoEmail({ empresa: c.nombre_empresa, dias, fechaFin });
      await enviarYRegistrar({
        para: c.contacto_email, area: 'Clientes', tipo: 'recordatorio_vencimiento',
        referencia: c.id, plantilla,
      });
      enviados += 1;
    } catch (e) {
      console.warn(`[alertas] no se pudo avisar a ${c.nombre_empresa}:`, e.message);
    }
  }
  return { enviados, revisados: clientes.length };
}

// ---------- arranque ----------
// Mismo patrón que iniciarPurgaAutomatica() en retencion.js: temporizador en
// proceso, sin cron externo, con una primera corrida poco después del
// arranque (para que sobreviva a un `pm2 restart` diario) y luego una vez
// al día.
const INTERVALO_MS = 24 * 60 * 60 * 1000;
const RETRASO_INICIAL_MS = 6 * 60 * 1000; // después de la purga (5 min) y del dólar

let timer = null;
let inicial = null;

export function iniciarAlertasAutomaticas() {
  if (timer || inicial) return timer;
  const correr = () => correrAlertasVencimiento()
    .then((r) => { if (r.enviados) console.log(`[alertas] recordatorios de vencimiento: ${r.enviados}`); })
    .catch((e) => console.warn('[alertas]', e.message));

  inicial = setTimeout(() => {
    inicial = null;
    correr();
    timer = setInterval(correr, INTERVALO_MS);
    timer.unref?.();
  }, RETRASO_INICIAL_MS);
  inicial.unref?.();
  return inicial;
}

export function detenerAlertasAutomaticas() {
  if (timer) clearInterval(timer);
  if (inicial) clearTimeout(inicial);
  timer = null;
  inicial = null;
}
