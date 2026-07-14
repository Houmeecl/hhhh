import { Resend } from 'resend';
import { config } from '../config.js';

const resend = config.resend.apiKey ? new Resend(config.resend.apiKey) : null;

// Envía un correo. Si no hay RESEND_API_KEY, lo registra en consola (modo dev).
// `attachments`: [{ filename, content: Buffer }] (opcional).
export async function sendMail({ to, subject, html, attachments }) {
  if (!resend) {
    console.log('\n===== CORREO (modo dev, sin Resend) =====');
    console.log('Para:', to);
    console.log('Asunto:', subject);
    console.log(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    if (attachments?.length) console.log('Adjuntos:', attachments.map((a) => a.filename).join(', '));
    console.log('=========================================\n');
    return { dev: true };
  }
  const { data, error } = await resend.emails.send({
    from: config.resend.from,
    to,
    subject,
    html,
    attachments: attachments?.map((a) => ({ filename: a.filename, content: a.content })),
  });
  if (error) throw new Error(`Resend: ${error.message || 'error'}`);
  return data;
}

export function activationEmail({ nombre, link }) {
  return {
    subject: 'Activa tu cuenta en sicr3p',
    html: `
      <div style="font-family:system-ui,Arial,sans-serif;color:#0f1f2e;max-width:520px">
        <h2 style="color:#0f1f2e">Bienvenido/a a <b>sicr3p</b></h2>
        <p>Hola ${nombre}, se creó una cuenta para ti en la plataforma de contabilidad de carbono trazable.</p>
        <p>Activa tu cuenta y define tu contraseña con este enlace:</p>
        <p><a href="${link}" style="background:#28a745;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">Activar mi cuenta</a></p>
        <p style="color:#64748b;font-size:13px">El enlace expira en 48 horas. Si no reconoces esta invitación, ignora este correo.</p>
      </div>`,
  };
}

export function reporteEmail({ nombre, totalCo2e, nFacturas }) {
  const total = Number(totalCo2e || 0).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return {
    subject: 'Tu contabilidad de carbono · sicr3p',
    html: `
      <div style="font-family:system-ui,Arial,sans-serif;color:#0f1f2e;max-width:520px">
        <h2 style="color:#0f1f2e">Tu informe está listo</h2>
        <p>Hola ${nombre || ''}, adjuntamos tu informe consolidado de contabilidad de carbono.</p>
        <div style="background:#eaf6ef;border:1px solid #28a745;border-radius:10px;padding:14px 18px;margin:12px 0">
          <div style="font-size:12px;color:#218838;font-weight:700">RESULTADO INCORPORADO</div>
          <div style="font-size:22px;font-weight:800">${total} t CO₂e</div>
          <div style="font-size:13px;color:#64748b">${nFacturas} factura${nFacturas === 1 ? '' : 's'} procesada${nFacturas === 1 ? '' : 's'}</div>
        </div>
        <p style="color:#64748b;font-size:13px">Tu contabilidad, tu trazabilidad. Este informe no constituye una verificación de tercera parte acreditada.</p>
      </div>`,
  };
}

export function resetEmail({ nombre, link }) {
  return {
    subject: 'Restablece tu contraseña · sicr3p',
    html: `
      <div style="font-family:system-ui,Arial,sans-serif;color:#0f1f2e;max-width:520px">
        <h2 style="color:#0f1f2e">Restablecer contraseña</h2>
        <p>Hola ${nombre}, recibimos una solicitud para restablecer tu contraseña.</p>
        <p><a href="${link}" style="background:#28a745;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">Definir nueva contraseña</a></p>
        <p style="color:#64748b;font-size:13px">El enlace expira en 2 horas.</p>
      </div>`,
  };
}
