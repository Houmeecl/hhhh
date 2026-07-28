import crypto from 'crypto';
import { config } from '../config.js';
import { query } from '../lib/db.js';
import { sendMail, activationEmail } from './mailer.js';

// ============================================================
// Activación de cuenta compartida por los 6 paneles (sicrep, terreno,
// puerto, mandante, agencia, trazador) — la fila de `usuarios` y el
// flujo de token+correo son idénticos; solo cambia a qué login se
// vuelve tras definir la contraseña. Los seis logins comparten
// `PanelLogin.jsx`, que ofrece el botón de recuperar clave apoyado
// justamente en este mapa.
// ============================================================
export const RUTA_ACTIVAR = {
  sicrep: '/admin/activar',
  aduana_verde: '/panel-verde/activar',
  puerto: '/panel-puerto/activar',
  mandante: '/panel-mandante/activar',
  agencia: '/panel-agencia/activar',
  trazador: '/panel-trazador/activar',
};

const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

// Envía (o reenvía) el correo de activación para un usuario ya insertado.
// No lanza si el correo falla: registra el error y avisa al llamador, para
// que la cuenta no quede "atascada" sin ningún enlace visible en ninguna parte.
export async function enviarActivacion({ usuarioId, email, nombre, panel }) {
  const raw = crypto.randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48h
  await query(
    `INSERT INTO tokens_password (usuario_id, token_hash, tipo, expira_at) VALUES ($1,$2,'activacion',$3)`,
    [usuarioId, hashToken(raw), expira]
  );
  const ruta = RUTA_ACTIVAR[panel] || RUTA_ACTIVAR.sicrep;
  const link = `${config.publicAppUrl}${ruta}?token=${raw}`;
  let correoEnviado = true;
  try {
    await sendMail({ to: email, ...activationEmail({ nombre, link }) });
  } catch (err) {
    correoEnviado = false;
    console.error('[activacion] no se pudo enviar el correo:', err.message);
  }
  // Sin Resend (dev) o si el envío real falló: devolvemos el link para que
  // el admin lo pueda compartir a mano en vez de perderlo.
  const mostrarLink = !config.resend.apiKey || !correoEnviado;
  return { link, correoEnviado, dev_activation_link: mostrarLink ? link : undefined };
}
