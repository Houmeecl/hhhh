// ============================================================
// Avisa por correo cuando un deploy falla.
//
// POR QUÉ EXISTE. `actualizar.sh` corre por cron cada 30 minutos y, al
// fallar, escribía la razón SOLO en /var/log/sicr3p-actualizar.log. Nadie
// se enteraba. El resultado real: producción quedó decenas de commits
// atrás durante días, con el cron reportando su fracaso a un archivo que
// nadie abría, y el diagnóstico exigía entrar por SSH a leer un log.
//
// Un despliegue que falla en silencio es peor que uno que no existe: da
// la impresión de que lo que subiste está arriba.
//
// CÓMO. Se apoya en el mailer del propio backend
// (backend/src/services/mailer.js), así que usa exactamente el mismo SMTP
// que el resto de la plataforma — sin una segunda configuración que
// mantener ni credenciales repetidas en un script de shell.
//
// NUNCA FALLA HACIA AFUERA. Sale con código 0 pase lo que pase: este
// script se llama DESDE el manejo de un error, y hacerlo abortar ahí
// dejaría el deploy a medias por no haber podido mandar un correo. Si no
// puede avisar, lo dice por stdout —que va al mismo log— y se retira.
//
// Uso:  node deploy/avisar-deploy.mjs "<asunto>" "<detalle>" [rutaDelLog]
// ============================================================

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const [asunto, detalle, rutaLog] = process.argv.slice(2);

// Cuántas líneas finales del log se adjuntan. Suficiente para ver la
// causa —el error del build, el health que no levantó, el check del
// smoke que falló— sin mandar un correo de megabytes.
const LINEAS_LOG = 60;

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function colaDelLog(ruta) {
  if (!ruta) return '';
  try {
    return readFileSync(ruta, 'utf8').trimEnd().split('\n').slice(-LINEAS_LOG).join('\n');
  } catch (e) {
    return `(no se pudo leer ${ruta}: ${e.message})`;
  }
}

try {
  // Import dinámico y relativo al repo: el script vive en deploy/ y el
  // mailer en backend/. Se hace acá adentro, no arriba, para que un fallo
  // al cargar el módulo caiga en el mismo catch que todo lo demás.
  const { sendMail } = await import(path.join(AQUI, '..', 'backend', 'src', 'services', 'mailer.js'));
  const { config } = await import(path.join(AQUI, '..', 'backend', 'src', 'config.js'));

  const para = process.env.DEPLOY_NOTIFY_EMAIL || config.leads?.notifyEmail;
  if (!para) {
    console.log('[avisar-deploy] sin destinatario (DEPLOY_NOTIFY_EMAIL ni ADMIN_EMAIL): no se avisa.');
    process.exit(0);
  }

  const cola = colaDelLog(rutaLog);
  const r = await sendMail({
    to: para,
    area: 'Despliegue',
    subject: `[sicr3p] ${asunto || 'el deploy falló'}`,
    html: `
      <div style="font-family:system-ui,Arial,sans-serif;color:#0f1f2e;max-width:680px">
        <h2 style="color:#b91c1c;margin-bottom:4px">${esc(asunto || 'El deploy falló')}</h2>
        <p style="margin:0 0 14px">${esc(detalle || '')}</p>
        ${cola ? `
        <p style="font-size:13px;color:#64748b;margin-bottom:6px">
          Últimas ${LINEAS_LOG} líneas de <code>${esc(rutaLog)}</code>:
        </p>
        <pre style="background:#0f1f2e;color:#e2e8f0;padding:14px;border-radius:8px;font-size:11.5px;line-height:1.5;overflow-x:auto;white-space:pre-wrap;word-break:break-word">${esc(cola)}</pre>` : ''}
        <p style="font-size:13px;color:#64748b">
          Producción NO se actualizó: sigue corriendo el commit anterior. El cron no
          reintenta este commit solo. Cuando la causa esté corregida, sube un commit
          nuevo o levanta la cuarentena con
          <code>bash deploy/actualizar.sh --reintentar</code>.
        </p>
      </div>`,
  });
  console.log(`[avisar-deploy] aviso enviado a ${para} (${r?.transport || (r?.dev ? 'dev' : 'ok')}).`);
} catch (e) {
  console.log(`[avisar-deploy] no se pudo avisar por correo: ${e.message}`);
}

// Siempre 0: ver el encabezado.
process.exit(0);
