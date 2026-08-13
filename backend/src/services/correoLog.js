import { query } from '../lib/db.js';
import { sendMail, elegirTransporte } from './mailer.js';

// ============================================================
// Envío de correo CON constancia en la base.
//
// Hasta ahora un envío no dejaba rastro: ante un "nunca me llegó" no
// había forma de saber si salió. Para los correos de siempre eso era un
// detalle; para una campaña de cobro es la diferencia entre poder
// reclamar un pago y no poder.
//
// Se guarda el HECHO (a quién, qué asunto, qué tipo, si salió y con qué
// transporte), NUNCA el cuerpo: el cuerpo lleva el link de pago y, en el
// correo de credenciales, la clave misma. Una bitácora que guardara eso
// sería una copia de todas las claves emitidas.
//
// `enviarYRegistrar` NO LANZA. Un correo que falla no puede tumbar la
// operación que lo originó — el dinero ya entró y el código ya se emitió;
// perder eso por un SMTP caído sería mucho peor que un correo pendiente
// de reenviar. Devuelve `{ ok, error }` para que el llamador decida.
// ============================================================

export const TIPOS_CORREO = ['link_pago', 'credenciales', 'recordatorio_pago'];

/**
 * Deja constancia de un envío. Tampoco lanza: si la bitácora falla, el
 * correo ya salió y perder la anotación no puede convertirse en un 500
 * para quien pidió el envío.
 */
export async function registrarCorreo({ para, asunto, tipo, referencia, transporte, ok, error }) {
  try {
    await query(
      `INSERT INTO correos_enviados (destinatario_email, asunto, tipo, referencia, transporte, ok, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [para, String(asunto || '').slice(0, 300), tipo, referencia || null,
       transporte || null, Boolean(ok), error ? String(error).slice(0, 500) : null]
    );
  } catch (e) {
    console.error('[correoLog] no se pudo registrar el envío:', e.message);
  }
}

/** Envía y anota. Devuelve `{ ok, error, transporte }` — nunca lanza. */
export async function enviarYRegistrar({ para, area, tipo, referencia, plantilla }) {
  let transporte = elegirTransporte();
  let ok = true;
  let error = null;
  try {
    const r = await sendMail({ to: para, area, ...plantilla });
    transporte = r?.transport || transporte;
  } catch (e) {
    ok = false;
    error = e.message;
    console.error(`[correo:${tipo}] falló el envío a ${para}:`, e.message);
  }
  await registrarCorreo({ para, asunto: plantilla.subject, tipo, referencia, transporte, ok, error });
  return { ok, error, transporte };
}

/**
 * Los correos que NO se deben enviar, de un lote de direcciones.
 *
 * Se consulta con la lista completa y una sola consulta: recorrer el
 * lote preguntando de a uno son 100 viajes a la base por tanda.
 */
export async function correosDadosDeBaja(emails) {
  const lista = [...new Set((emails || []).map((e) => String(e || '').toLowerCase().trim()).filter(Boolean))];
  if (!lista.length) return new Set();
  const { rows } = await query(
    `SELECT lower(email) AS email FROM bajas_correo WHERE lower(email) = ANY($1::text[])`,
    [lista]
  );
  return new Set(rows.map((r) => r.email));
}

/** Registra una baja. Idempotente: pedirla dos veces no es un error. */
export async function darDeBaja({ email, motivo = null, origen = 'enlace' }) {
  const e = String(email || '').toLowerCase().trim();
  if (!e) return false;
  await query(
    `INSERT INTO bajas_correo (email, motivo, origen) VALUES ($1,$2,$3)
     ON CONFLICT (lower(email)) DO NOTHING`,
    [e, motivo, origen]
  );
  return true;
}
