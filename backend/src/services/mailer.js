import { Resend } from 'resend';
import { config } from '../config.js';

const resend = config.resend.apiKey ? new Resend(config.resend.apiKey) : null;

// Envía un correo. Si no hay RESEND_API_KEY, lo registra en consola (modo dev).
export async function sendMail({ to, subject, html }) {
  if (!resend) {
    console.log('\n===== CORREO (modo dev, sin Resend) =====');
    console.log('Para:', to);
    console.log('Asunto:', subject);
    console.log(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    console.log('=========================================\n');
    return { dev: true };
  }
  const { data, error } = await resend.emails.send({
    from: config.resend.from,
    to,
    subject,
    html,
  });
  if (error) throw new Error(`Resend: ${error.message || 'error'}`);
  return data;
}

export function activationEmail({ nombre, link }) {
  return {
    subject: 'Activa tu cuenta en sicr3p',
    html: `
      <div style="font-family:system-ui,Arial,sans-serif;color:#1e2a3a;max-width:520px">
        <h2 style="color:#1e2a3a">Bienvenido/a a <b>sicr3p</b></h2>
        <p>Hola ${nombre}, se creó una cuenta para ti en la plataforma de contabilidad de carbono trazable.</p>
        <p>Activa tu cuenta y define tu contraseña con este enlace:</p>
        <p><a href="${link}" style="background:#22c55e;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">Activar mi cuenta</a></p>
        <p style="color:#64748b;font-size:13px">El enlace expira en 48 horas. Si no reconoces esta invitación, ignora este correo.</p>
      </div>`,
  };
}

export function resetEmail({ nombre, link }) {
  return {
    subject: 'Restablece tu contraseña · sicr3p',
    html: `
      <div style="font-family:system-ui,Arial,sans-serif;color:#1e2a3a;max-width:520px">
        <h2 style="color:#1e2a3a">Restablecer contraseña</h2>
        <p>Hola ${nombre}, recibimos una solicitud para restablecer tu contraseña.</p>
        <p><a href="${link}" style="background:#22c55e;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">Definir nueva contraseña</a></p>
        <p style="color:#64748b;font-size:13px">El enlace expira en 2 horas.</p>
      </div>`,
  };
}
