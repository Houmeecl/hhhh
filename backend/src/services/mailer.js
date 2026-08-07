import { Resend } from 'resend';
import nodemailer from 'nodemailer';
import { config } from '../config.js';

const resend = config.resend.apiKey ? new Resend(config.resend.apiKey) : null;

// Transporte SMTP propio (Poste.io) si está configurado. secure=true en 465.
const smtpTransport = (config.smtp.host && config.smtp.user && config.smtp.pass)
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
      // Con SMTP_TLS_INSECURE=true se acepta el certificado autofirmado del
      // servidor de correo propio en el mismo host (conexión local, no sale
      // a internet). Por defecto rejectUnauthorized queda en true.
      ...(config.smtp.tlsInsecure ? { tls: { rejectUnauthorized: false } } : {}),
    })
  : null;

// De dónde salen los correos (MAIL_FROM). En producción con SMTP propio debe
// ser una casilla del dominio del servidor (ej. no-responder@sicr3p.cl) para
// que el DKIM firme y el SPF pase.
const FROM = config.resend.from;

// Qué transporte se usaría según la config: SMTP propio tiene prioridad, luego
// Resend, y si no hay ninguno, modo dev (log). Función pura para poder testear
// la prioridad sin tocar red ni entorno.
export function elegirTransporte(cfg = config) {
  if (cfg.smtp?.host && cfg.smtp?.user && cfg.smtp?.pass) return 'smtp';
  if (cfg.resend?.apiKey) return 'resend';
  return 'dev';
}

// Envía un correo. Prioridad: SMTP propio → Resend → modo dev (log en consola).
// `attachments`: [{ filename, content: Buffer }] (opcional).
export async function sendMail({ to, subject, html, attachments }) {
  // 1) SMTP propio (servidor de correo del VPS).
  if (smtpTransport) {
    const info = await smtpTransport.sendMail({
      from: FROM,
      to,
      subject,
      html,
      attachments: attachments?.map((a) => ({ filename: a.filename, content: a.content })),
    });
    return { id: info.messageId, transport: 'smtp' };
  }

  // 2) Resend (transaccional externo).
  if (resend) {
    const { data, error } = await resend.emails.send({
      from: FROM,
      to,
      subject,
      html,
      attachments: attachments?.map((a) => ({ filename: a.filename, content: a.content })),
    });
    if (error) throw new Error(`Resend: ${error.message || 'error'}`);
    return { ...data, transport: 'resend' };
  }

  // 3) Modo dev: sin SMTP ni Resend, se registra en consola.
  console.log('\n===== CORREO (modo dev, sin SMTP ni Resend) =====');
  console.log('Para:', to);
  console.log('Asunto:', subject);
  console.log(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  // Los enlaces viven en atributos href (se pierden al quitar las etiquetas): se listan aparte.
  const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  if (links.length) console.log('Enlaces:', links.join(' '));
  if (attachments?.length) console.log('Adjuntos:', attachments.map((a) => a.filename).join(', '));
  console.log('=================================================\n');
  return { dev: true };
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
          <div style="font-size:22px;font-weight:800">${total} t CO2e</div>
          <div style="font-size:13px;color:#64748b">${nFacturas} factura${nFacturas === 1 ? '' : 's'} procesada${nFacturas === 1 ? '' : 's'}</div>
        </div>
        <p style="color:#64748b;font-size:13px">Tu contabilidad, tu trazabilidad. Este informe no constituye una verificación de tercera parte acreditada.</p>
      </div>`,
  };
}

export function magicEmail({ link }) {
  return {
    subject: 'Tu enlace de acceso · sicr3p',
    html: `
      <div style="font-family:system-ui,Arial,sans-serif;color:#0f1f2e;max-width:520px">
        <h2 style="color:#0f1f2e">Ingresa a <b>sicr3p</b></h2>
        <p>Usa este enlace para entrar a tu historial de contabilidad de carbono. No necesitas contraseña.</p>
        <p><a href="${link}" style="background:#28a745;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">Ingresar a mi cuenta</a></p>
        <p style="color:#64748b;font-size:13px">El enlace expira en 15 minutos y sirve una sola vez. Si no lo solicitaste, ignora este correo.</p>
      </div>`,
  };
}

// Formato es-CL (punto de miles, coma decimal).
function nfClp(n, dec = 0) {
  return Number(n || 0).toLocaleString('es-CL', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// Comprobante del POS de mostrador. `estado`: 'simulado' | 'omitido'.
export async function enviarComprobantePos({ para, empresa, t_co2e, monto_clp, estado, metodo, verificarUrl, informeUrl }) {
  const total = nfClp(t_co2e, 2);
  const compensacion = estado === 'simulado'
    ? `
        <p style="margin:4px 0"><b>Compensación (pago simulado${metodo ? `, ${metodo}` : ''}):</b> $ ${nfClp(monto_clp)} CLP</p>
        <p style="margin:4px 0;color:#b45309;font-size:13px">Pago simulado — sin pasarela de pago real conectada todavía.</p>`
    : `
        <p style="margin:4px 0"><b>Sin cobro en esta visita.</b></p>`;
  return sendMail({
    to: para,
    subject: `Comprobante sicr3p — ${empresa}`,
    html: `
      <div style="font-family:system-ui,Arial,sans-serif;color:#0f1f2e;max-width:520px">
        <h2 style="color:#0f1f2e">Comprobante de tu visita — sicr3p</h2>
        <p>Hola${empresa ? ` <b>${empresa}</b>` : ''}, este es el resumen de tu paso por sicr3p.</p>
        <div style="background:#eaf6ef;border:1px solid #28a745;border-radius:10px;padding:14px 18px;margin:12px 0">
          <div style="font-size:12px;color:#218838;font-weight:700">RESULTADO INCORPORADO</div>
          <div style="font-size:22px;font-weight:800">${total} t CO2e</div>
          <div style="font-size:13px;color:#64748b">Total calculado en tu visita</div>
        </div>
        ${compensacion}
        <p><a href="${verificarUrl}" style="background:#28a745;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">Verificar trazabilidad</a></p>
        <p><a href="${informeUrl}" style="color:#0f1f2e;font-size:14px">Descargar informe PDF</a></p>
        <p style="color:#64748b;font-size:13px">Tu contabilidad, tu trazabilidad. Este informe no constituye una verificación de tercera parte acreditada.</p>
      </div>`,
  });
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
