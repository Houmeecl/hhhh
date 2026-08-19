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
// ser una casilla del dominio de correo — sicrep.cl, no sicr3p.cl, que es el
// del sitio (ej. no-responder@sicrep.cl) — para que el DKIM firme y el SPF pase.
const FROM = config.resend.from;

// Nombre visible del remitente por ÁREA (admin, terreno, proveedor, puerto,
// mandante, agencia, trazador, cliente, Sube y Suma…), sin cambiar la
// casilla real: mismo dominio autenticado por SPF/DKIM, solo cambia el
// nombre que el destinatario ve en su bandeja. Existen 7 paneles con
// activación de cuenta idéntica — sin esto, un correo de "Proveedor" y uno
// de "Puerto" llegaban indistinguibles como "sicr3p" a secas, y quien
// gestiona varias áreas no podía saber cuál era cuál de un vistazo.
export function construirFrom(area) {
  if (!area) return FROM;
  const email = FROM.match(/<([^>]+)>/)?.[1] || FROM;
  return `sicr3p ${area} <${email}>`;
}

// Qué transporte se usaría según la config: SMTP propio tiene prioridad, luego
// Resend, y si no hay ninguno, modo dev (log). Función pura para poder testear
// la prioridad sin tocar red ni entorno.
export function elegirTransporte(cfg = config) {
  if (cfg.smtp?.host && cfg.smtp?.user && cfg.smtp?.pass) return 'smtp';
  if (cfg.resend?.apiKey) return 'resend';
  return 'dev';
}

// Envía un correo. Prioridad: SMTP propio → Resend → modo dev (log en consola).
// `attachments`: [{ filename, content: Buffer }] (opcional). `area`: nombre
// del panel/área que origina el correo (ver construirFrom arriba) — opcional,
// sin ella se usa el FROM genérico de siempre.
export async function sendMail({ to, subject, html, attachments, area, headers }) {
  const from = construirFrom(area);
  // 1) SMTP propio (servidor de correo del VPS).
  if (smtpTransport) {
    const info = await smtpTransport.sendMail({
      from,
      to,
      subject,
      html,
      headers,
      attachments: attachments?.map((a) => ({ filename: a.filename, content: a.content })),
    });
    return { id: info.messageId, transport: 'smtp' };
  }

  // 2) Resend (transaccional externo).
  if (resend) {
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject,
      html,
      headers,
      attachments: attachments?.map((a) => ({ filename: a.filename, content: a.content })),
    });
    if (error) throw new Error(`Resend: ${error.message || 'error'}`);
    return { ...data, transport: 'resend' };
  }

  // 3) Modo dev: sin SMTP ni Resend, se registra en consola.
  console.log('\n===== CORREO (modo dev, sin SMTP ni Resend) =====');
  console.log('De:', from);
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

// `area`: etiqueta del panel (ej. "Proveedor", "Puerto") — se imprime en el
// asunto y el cuerpo para que quien gestiona varias cuentas (o recibe varias
// invitaciones seguidas) sepa de inmediato para cuál panel es cada una, sin
// tener que abrir el correo o revisar el enlace.
export function activationEmail({ nombre, link, area }) {
  const sufijo = area ? ` — Panel ${area}` : '';
  return {
    subject: `Activa tu cuenta en sicr3p${sufijo}`,
    html: `
      <div style="font-family:system-ui,Arial,sans-serif;color:#0f1f2e;max-width:520px">
        <h2 style="color:#0f1f2e">Bienvenido/a a <b>sicr3p</b>${area ? ` — ${area}` : ''}</h2>
        <p>Hola ${nombre}, se creó una cuenta para ti en la plataforma de contabilidad de carbono trazable${area ? `, panel <b>${area}</b>` : ''}.</p>
        <p>Activa tu cuenta y define tu contraseña con este enlace:</p>
        <p><a href="${link}" style="background:#28a745;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">Activar mi cuenta</a></p>
        <p style="color:#64748b;font-size:13px">El enlace expira en 48 horas. Si no reconoces esta invitación, ignora este correo.</p>
      </div>`,
  };
}

export function reporteEmail({ nombre, totalCo2e, nFacturas, cifrado = false }) {
  const total = Number(totalCo2e || 0).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Sin este aviso, quien recibe un PDF que pide contraseña cree que el
  // archivo llegó dañado. Y la contraseña NO va acá a propósito: viaja en
  // el correo de credenciales, que no lleva adjunto. Mandar el archivo y
  // su clave en el mismo mensaje dejaría el cifrado en decoración.
  const avisoCifrado = cifrado ? `
        <div style="background:#f1f5f9;border-left:3px solid #0f1f2e;padding:12px 16px;margin:14px 0">
          <b style="font-size:13px">El PDF adjunto está cifrado.</b>
          <div style="font-size:13px;color:#475569;margin-top:4px">
            Ábrelo con tu clave de informes, que te enviamos en un correo aparte.
            Nunca la mandamos en el mismo correo que el informe —si lo hiciéramos, cifrarlo
            no serviría de nada—. Si no la tienes a mano, respóndenos y te la reenviamos.
          </div>
        </div>` : '';
  return {
    subject: 'Tu contabilidad de carbono · sicr3p',
    html: `
      <div style="font-family:system-ui,Arial,sans-serif;color:#0f1f2e;max-width:520px">
        <h2 style="color:#0f1f2e">Tu informe está listo</h2>
        <p>Hola ${nombre || ''}, adjuntamos tu informe consolidado de contabilidad de carbono.</p>
        ${avisoCifrado}
        <div style="background:#eaf6ef;border:1px solid #28a745;border-radius:10px;padding:14px 18px;margin:12px 0">
          <div style="font-size:12px;color:#218838;font-weight:700">RESULTADO INCORPORADO</div>
          <div style="font-size:22px;font-weight:800">${total} t CO2e</div>
          <div style="font-size:13px;color:#64748b">${nFacturas} factura${nFacturas === 1 ? '' : 's'} procesada${nFacturas === 1 ? '' : 's'}</div>
        </div>
        <p style="color:#64748b;font-size:13px">Tu contabilidad, tu trazabilidad. Este informe no constituye una verificación de tercera parte acreditada.</p>
      </div>`,
  };
}

// Recordatorio de vencimiento de contrato — el mismo aviso sirve para 7/3/1
// día(s) antes y para "ya venció": solo cambia el texto según `dias`.
// `dias < 0` es el caso vencido (nadie renovó y el contrato sigue 'activo').
export function recordatorioVencimientoEmail({ empresa, dias, fechaFin }) {
  const vencido = dias < 0;
  const texto = vencido
    ? `venció el ${fechaFin}`
    : dias === 0 ? 'vence hoy' : `vence en ${dias} día${dias === 1 ? '' : 's'} (${fechaFin})`;
  return {
    subject: vencido ? `Contrato vencido — ${empresa} · sicr3p` : `Tu contrato ${texto} · sicr3p`,
    html: `
      <div style="font-family:system-ui,Arial,sans-serif;color:#0f1f2e;max-width:520px">
        <h2 style="color:#0f1f2e">${vencido ? 'Contrato vencido' : 'Recordatorio de vencimiento'}</h2>
        <p>Hola, el contrato de <b>${empresa}</b> con sicr3p ${texto}.</p>
        <p style="color:#64748b;font-size:13px">Si ya renovaste o la fecha registrada no corresponde, contáctanos para actualizarla y evitar nuevos avisos.</p>
      </div>`,
  };
}

// `area`: "Sube y Suma" cuando el magic link viene de un código de campaña
// del juego (modo_juego=true), sin ella es el acceso genérico de cliente —
// mismo mecanismo de token, pero el contenido que desbloquea es distinto
// (historial de contabilidad vs. perfil de jugador) y sin distinguirlos el
// correo no decía a qué se estaba entrando.
export function magicEmail({ link, area }) {
  return {
    subject: `Tu enlace de acceso${area ? ` a ${area}` : ''} · sicr3p`,
    html: `
      <div style="font-family:system-ui,Arial,sans-serif;color:#0f1f2e;max-width:520px">
        <h2 style="color:#0f1f2e">Ingresa a <b>sicr3p</b>${area ? ` — ${area}` : ''}</h2>
        <p>Usa este enlace para entrar${area ? ` a ${area}` : ' a tu historial de contabilidad de carbono'}. No necesitas contraseña.</p>
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
    area: 'Terreno',
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

// `area`: mismo criterio que activationEmail — de qué panel es la cuenta
// cuya contraseña se está restableciendo.
export function resetEmail({ nombre, link, area }) {
  return {
    subject: `Restablece tu contraseña${area ? ` — Panel ${area}` : ''} · sicr3p`,
    html: `
      <div style="font-family:system-ui,Arial,sans-serif;color:#0f1f2e;max-width:520px">
        <h2 style="color:#0f1f2e">Restablecer contraseña${area ? ` — ${area}` : ''}</h2>
        <p>Hola ${nombre}, recibimos una solicitud para restablecer tu contraseña${area ? ` del panel <b>${area}</b>` : ''}.</p>
        <p><a href="${link}" style="background:#28a745;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">Definir nueva contraseña</a></p>
        <p style="color:#64748b;font-size:13px">El enlace expira en 2 horas.</p>
      </div>`,
  };
}

// ---------- Campaña de cobro ----------

// Escape de HTML para todo lo que viene de la planilla. Los nombres de
// empresa de una lista real traen `&`, comillas y hasta `<`; sin esto un
// "Ríos & Cía." rompe el marcado y una celda con `<script>` viajaría
// intacta al cliente de correo de quien la recibe.
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// El ASUNTO es una cabecera, no HTML: un salto de línea ahí permite
// inyectar cabeceras nuevas (un Bcc, otro From). Tanto el nombre de la
// campaña como la razón social vienen de texto que escribe una persona,
// así que se aplanan a una sola línea y se acotan antes de interpolarse.
const asunto = (s, max = 120) =>
  String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// Pie legal obligatorio de todo correo comercial: quién escribe y cómo
// dejar de recibirlos (art. 28 B de la Ley 19.628). No es decorativo —
// sin la salida visible, el destinatario que no quiere el correo solo
// tiene un camino: marcarlo como spam, y eso arrastra la reputación del
// dominio del que dependen los correos de activación de la plataforma.
function pieComercial(bajaUrl) {
  return `
    <hr style="border:none;border-top:1px solid #e6e9ed;margin:22px 0 12px">
    <p style="color:#94a3b8;font-size:12px;line-height:1.6;margin:0">
      Le escribe <b>sicr3p</b> · contabilidad de carbono trazable · Chile.<br>
      Recibe este correo porque su empresa figura en nuestro registro de contactos del rubro.
      Si no desea recibir más comunicaciones comerciales,
      <a href="${bajaUrl}" style="color:#64748b">dese de baja aquí</a> — es inmediato y no requiere responder.
    </p>`;
}

/**
 * Correo con el link de pago. `montoClp` ya viene en pesos enteros.
 *
 * El link NO lleva credenciales ni entra a ninguna cuenta: solo abre la
 * página de pago. Lo que se recibe al pagar llega en otro correo, a esta
 * misma dirección (ver credencialesEmail).
 */
export function linkPagoEmail({ empresa, contacto, montoClp, creditos, campana, link, bajaUrl, bajaPostUrl }) {
  const saludo = contacto ? `Hola ${esc(contacto)}` : 'Hola';
  return {
    subject: `${asunto(campana, 70)} — acceso a sicr3p para ${asunto(empresa, 60) || 'su empresa'}`,
    // Baja en un clic (RFC 8058). Gmail y Yahoo lo EXIGEN a quien envía
    // en volumen: sin estas dos cabeceras, el botón "cancelar suscripción"
    // no aparece en la bandeja y al destinatario que no quiere el correo
    // solo le queda marcarlo como spam — lo que arrastra la reputación
    // del dominio del que también salen los correos de activación y de
    // recuperación de clave de toda la plataforma.
    //
    // El destino es el BACKEND, no la página: el cliente de correo hace
    // un POST servidor-a-servidor y nunca ejecuta el JavaScript del sitio.
    headers: bajaPostUrl ? {
      'List-Unsubscribe': `<${bajaPostUrl}>, <${bajaUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    } : undefined,
    html: `
      <div style="font-family:system-ui,Arial,sans-serif;color:#0f1f2e;max-width:520px">
        <h2 style="color:#0f1f2e;margin-bottom:4px">${esc(campana)}</h2>
        <p>${saludo}${empresa ? `, de <b>${esc(empresa)}</b>` : ''}:</p>
        <p>Puede activar el acceso de su empresa a <b>sicr3p</b>, la plataforma de contabilidad
           de carbono trazable: sube sus facturas y obtiene su inventario de emisiones
           (Alcances 1, 2 y 3) con respaldo documental.</p>
        <div style="background:#eaf6ef;border:1px solid #28a745;border-radius:10px;padding:14px 18px;margin:16px 0">
          <div style="font-size:12px;color:#218838;font-weight:700">SU ACCESO INCLUYE</div>
          <div style="font-size:22px;font-weight:800">${creditos} documento${creditos === 1 ? '' : 's'}</div>
          <div style="font-size:13px;color:#64748b">Valor: $ ${nfClp(montoClp)} CLP (IVA incluido)</div>
        </div>
        <p><a href="${link}" style="background:#28a745;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600">Pagar y activar el acceso</a></p>
        <p style="color:#64748b;font-size:13px">Apenas se confirme el pago le llegará su clave de
           acceso a esta misma dirección, de forma automática.</p>
        ${pieComercial(bajaUrl)}
      </div>`,
  };
}

/**
 * Correo con la clave, después de pagar. Este SÍ lleva el acceso, y por
 * eso va SIEMPRE a la dirección registrada en el cobro y nunca a la que
 * usó quien pagó: el link de pago es compartible, la clave no.
 */
export function credencialesEmail({ empresa, codigo, creditos, link, claveInforme = null }) {
  // LA CLAVE DE INFORMES VIAJA ACÁ Y EN NINGÚN OTRO LADO.
  //
  // Este correo es el único que puede llevarla, porque es el único que NO
  // lleva adjunto: la regla que sostiene todo el cifrado es que la clave y
  // el archivo nunca vayan en el mismo mensaje — no que la clave nunca se
  // mande. Si nunca se mandara, nadie podría abrir su informe y el cliente
  // terminaría pidiéndola por el mismo canal, o peor, nosotros se la
  // mandaríamos de vuelta adjunta al PDF.
  const bloqueInforme = claveInforme ? `
        <div style="border:1px solid #cbd5e1;border-radius:10px;padding:14px 18px;margin:16px 0">
          <div style="font-size:12px;color:#64748b;font-weight:700;letter-spacing:.06em">CLAVE PARA ABRIR SUS INFORMES</div>
          <div style="font-size:19px;font-weight:800;letter-spacing:.06em;margin:6px 0;font-family:ui-monospace,Menlo,Consolas,monospace">${esc(claveInforme)}</div>
          <div style="font-size:13px;color:#475569">
            Los informes en PDF salen cifrados. Esta clave los abre, es distinta de su
            código de acceso y no cambia. <b>Guárdela aparte</b>: nunca la enviamos en el
            mismo correo que un informe.
          </div>
        </div>` : '';
  return {
    subject: 'Su acceso a sicr3p está activo — clave adentro',
    html: `
      <div style="font-family:system-ui,Arial,sans-serif;color:#0f1f2e;max-width:520px">
        <h2 style="color:#0f1f2e">Pago recibido — su acceso está activo</h2>
        <p>Gracias${empresa ? `, <b>${esc(empresa)}</b>` : ''}. Ya puede empezar a cargar sus documentos.</p>
        <div style="background:#0f1f2e;border-radius:10px;padding:18px;margin:16px 0;text-align:center">
          <div style="font-size:12px;color:#8fd3a8;font-weight:700;letter-spacing:.08em">SU CLAVE DE ACCESO</div>
          <div style="font-size:26px;font-weight:800;color:#fff;letter-spacing:.06em;margin:6px 0">${esc(codigo)}</div>
          <div style="font-size:13px;color:#94a3b8">${creditos} documento${creditos === 1 ? '' : 's'} disponibles</div>
        </div>
        ${bloqueInforme}
        <p><a href="${link}" style="background:#28a745;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600">Entrar y subir mi primer documento</a></p>
        <p style="color:#64748b;font-size:13px">Guarde esta clave: es la que identifica el acceso de su
           empresa. Si la pierde, respóndanos este correo y se la reenviamos.</p>
        <p style="color:#64748b;font-size:13px">Tu contabilidad, tu trazabilidad.</p>
      </div>`,
  };
}

/**
 * Entrega de la clave con que se abren los informes cifrados.
 *
 * NO LLEVA ADJUNTO, y esa es toda la razón de que exista como correo
 * aparte: la regla que sostiene el cifrado es que la clave y el archivo
 * nunca viajen en el mismo mensaje. Si se mandara junto al informe, el
 * cifrado sería decoración.
 *
 * Lo dispara una persona desde "Accesos externos" (o sale solo en el
 * correo de credenciales de un cobro pagado). Hasta que alguien la
 * entregue, los informes de esa empresa salen EN CLARO a propósito:
 * cifrar con una clave que el destinatario nunca vio le dejaría un PDF
 * que no puede abrir, que es peor que uno legible.
 */
export function claveInformeEmail({ empresa, clave, rotada = false }) {
  return {
    subject: rotada
      ? 'Su clave de informes cambió · sicr3p'
      : 'Su clave para abrir los informes · sicr3p',
    html: `
      <div style="font-family:system-ui,Arial,sans-serif;color:#0f1f2e;max-width:520px">
        <h2 style="color:#0f1f2e">${rotada ? 'Su clave de informes cambió' : 'Su clave para abrir los informes'}</h2>
        <p>Hola${empresa ? `, <b>${esc(empresa)}</b>` : ''}. Los informes en PDF que le entregamos
           salen cifrados. Esta es la clave que los abre.</p>
        <div style="border:1px solid #cbd5e1;border-radius:10px;padding:16px 18px;margin:16px 0;text-align:center">
          <div style="font-size:12px;color:#64748b;font-weight:700;letter-spacing:.06em">CLAVE DE INFORMES</div>
          <div style="font-size:22px;font-weight:800;letter-spacing:.08em;margin:8px 0;font-family:ui-monospace,Menlo,Consolas,monospace">${esc(clave)}</div>
        </div>
        ${rotada ? `
        <p style="font-size:13px;color:#475569">
          <b>Los informes que ya recibió siguen abriéndose con la clave anterior.</b> No se
          vuelven a cifrar: esta clave nueva aplica a los que le enviemos de ahora en adelante.
        </p>` : ''}
        <p style="font-size:13px;color:#475569">
          Es distinta de su código de acceso y no cambia sola. <b>Guárdela aparte</b>: nunca se
          la enviamos en el mismo correo que un informe, justamente para que el cifrado sirva
          de algo. Si la pierde, pídanosla y se la reenviamos.
        </p>
        <p style="color:#64748b;font-size:13px">Tu contabilidad, tu trazabilidad.</p>
      </div>`,
  };
}

// Comprobante de transporte (viaje en bus, camioneta, etc.) para empresa/cliente.
export function comprobanteTransporteEmail({ empresa, viaje, modoNombre, co2e, cifrado = false }) {
  const total = nfClp(co2e, 2);
  // Sin este aviso, quien recibe un PDF que pide contraseña cree que el
  // archivo llegó dañado. Y la contraseña NO va acá a propósito: mandarla
  // en el mismo correo que el archivo dejaría el cifrado en decoración.
  const avisoCifrado = cifrado ? `
        <div style="background:#f1f5f9;border-left:3px solid #0f1f2e;padding:12px 16px;margin:14px 0">
          <b style="font-size:13px">El PDF adjunto está cifrado.</b>
          <div style="font-size:13px;color:#475569;margin-top:4px">
            Ábralo con la clave de informes de su empresa — la misma que le entregamos al activar su cuenta.
            Si no la tiene a mano, pídala desde su panel; nunca la enviamos por correo.
          </div>
        </div>` : '';
  return {
    subject: `Comprobante de transporte — ${empresa}`,
    html: `
      <div style="font-family:system-ui,Arial,sans-serif;color:#0f1f2e;max-width:520px">
        <h2 style="color:#0f1f2e">Comprobante de transporte de personal</h2>
        <p>Hola, te adjuntamos el comprobante del traslado registrado en sicr3p.</p>
        <div style="background:#f0fdfa;border:1px solid #14b8a6;border-radius:10px;padding:14px 18px;margin:12px 0">
          <div style="font-size:12px;color:#0d9488;font-weight:700">EMISIONES CALCULADAS</div>
          <div style="font-size:22px;font-weight:800">${total} tCO2e</div>
          <div style="font-size:13px;color:#64748b">${modoNombre || 'Transporte'} · ${viaje.origen} → ${viaje.destino}</div>
        </div>
        ${avisoCifrado}
        <table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:13px">
          <tr style="border-bottom:1px solid #e6e9ed">
            <td style="padding:8px 0;color:#64748b">Modo:</td>
            <td style="padding:8px 0;text-align:right;font-weight:600">${modoNombre || viaje.modo}</td>
          </tr>
          <tr style="border-bottom:1px solid #e6e9ed">
            <td style="padding:8px 0;color:#64748b">Distancia:</td>
            <td style="padding:8px 0;text-align:right;font-weight:600">${viaje.km} km${viaje.ida_vuelta ? ' (ida y vuelta)' : ''}</td>
          </tr>
          <tr style="border-bottom:1px solid #e6e9ed">
            <td style="padding:8px 0;color:#64748b">Pasajeros:</td>
            <td style="padding:8px 0;text-align:right;font-weight:600">${viaje.pasajeros}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#64748b">Fecha:</td>
            <td style="padding:8px 0;text-align:right;font-weight:600">${viaje.fecha}</td>
          </tr>
        </table>
        <p style="color:#64748b;font-size:13px">Tu contabilidad, tu trazabilidad. Este informe no constituye una verificación de tercera parte acreditada (ISO 14064-3).</p>
      </div>`,
  };
}
