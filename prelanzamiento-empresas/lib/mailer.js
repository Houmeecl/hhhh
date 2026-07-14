import { Resend } from 'resend';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAIL_FROM = process.env.MAIL_FROM || 'sicr3p <no-responder@sicr3p.cl>';
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// El PDF de muestra es siempre el mismo (datos de ejemplo, no de un cliente real);
// se lee una sola vez y se reutiliza en cada envío.
const MUESTRA_PATH = path.resolve(__dirname, '../public/muestra-informe.pdf');
let muestraPdf = null;
try { muestraPdf = fs.readFileSync(MUESTRA_PATH); } catch { /* no bloquea el arranque si falta el archivo */ }

// Confirmación de lista de reserva con el informe de muestra adjunto (1 solo PDF).
export async function enviarConfirmacionWaitlist({ email, empresa }) {
  const subject = 'Quedaste en la lista de reserva · sicr3p';
  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;color:#0f1f2e;max-width:520px">
      <h2 style="color:#0f1f2e">¡Listo${empresa ? `, ${empresa}` : ''}!</h2>
      <p>Quedaste en la <b>lista de reserva</b> de sicr3p. Te avisaremos apenas abramos tu cupo de piloto.</p>
      <p>Mientras tanto, te adjuntamos una <b>muestra</b> de cómo se ve tu contabilidad de carbono
      trazable — con datos de ejemplo, para que veas el formato del informe real.</p>
      <p style="color:#64748b;font-size:13px">Tu contabilidad, tu trazabilidad.</p>
    </div>`;

  if (!resend) {
    console.log('\n===== CORREO (modo dev, sin Resend) =====');
    console.log('Para:', email);
    console.log('Asunto:', subject);
    console.log(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    console.log('Adjuntos:', muestraPdf ? 'sicr3p-informe-de-muestra.pdf' : '(sin PDF de muestra: falta generarlo)');
    console.log('=========================================\n');
    return { dev: true };
  }
  if (!muestraPdf) return null; // sin PDF no se envía el correo (evita mandar uno incompleto)

  const { error } = await resend.emails.send({
    from: MAIL_FROM,
    to: email,
    subject,
    html,
    attachments: [{ filename: 'sicr3p-informe-de-muestra.pdf', content: muestraPdf }],
  });
  if (error) throw new Error(`Resend: ${error.message || 'error'}`);
  return { ok: true };
}
