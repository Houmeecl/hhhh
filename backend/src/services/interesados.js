// ============================================================
// Interesados del sitio público — validación PURA (sin BD, sin red).
//
// Mismo criterio que services/inscripcion.js: formulario público, la
// validación vive acá y se testea sola. A diferencia de la inscripción,
// acá el ÚNICO obligatorio es el correo — es un primer toque (landing
// del Corredor/Instituto, calculadora de la portada, página de códigos
// de prueba), no una postulación formal con RUT.
// ============================================================

import { config } from '../config.js';

export const ORIGENES = ['calculadora', 'corredor', 'instituto', 'prueba', 'lanzamiento', 'magic_sin_historial', 'otro'];
export const MAX_MENSAJE = 2000;

const texto = (v, max) => String(v ?? '').trim().slice(0, max);

// Honeypot anti-bot: el formulario incluye un campo `sitio_web` invisible
// para humanos (fuera de pantalla, tabIndex -1). Un humano nunca lo llena;
// un bot genérico que rellena todo, sí. La ruta responde 201 falso sin
// insertar — no se le enseña al bot que fue detectado.
export function esBot(body) {
  return Boolean(texto(body?.sitio_web, 200));
}

// Devuelve { ok, error, datos }. Nunca lanza (un formulario público que
// revienta con excepción es un 500 en la cara del interesado).
export function validarInteresado(entrada) {
  const body = entrada && typeof entrada === 'object' ? entrada : {};
  const email = texto(body.email, 200).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: 'Ingresa un correo válido.' };
  }

  // Origen fuera del catálogo cae a 'otro' en vez de rechazar: el origen
  // lo fija el propio frontend, no el usuario — un valor raro es un
  // cliente manipulado y el lead igual vale la pena capturarlo.
  const origen = ORIGENES.includes(body.origen) ? body.origen : 'otro';

  // La estimación solo tiene sentido desde la calculadora, y se re-arma
  // con claves conocidas: jamás se persiste JSON arbitrario del cliente.
  let estimacion = null;
  if (origen === 'calculadora' && body.estimacion && typeof body.estimacion === 'object' && !Array.isArray(body.estimacion)) {
    const e = body.estimacion;
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
    estimacion = {
      total_t: num(e.total_t),
      compensacion_clp: num(e.compensacion_clp),
      usd: num(e.usd),
      entradas: e.entradas && typeof e.entradas === 'object' && !Array.isArray(e.entradas)
        ? Object.fromEntries(Object.entries(e.entradas).slice(0, 12).map(([k, v]) => [texto(k, 40), num(v)]))
        : null,
    };
    if (estimacion.total_t == null) estimacion = null; // sin total no hay estimación que valga
  }

  return {
    ok: true,
    error: null,
    datos: {
      origen,
      nombre: texto(body.nombre, 150) || null,
      email,
      empresa: texto(body.empresa, 200) || null,
      telefono: texto(body.telefono, 40) || null,
      mensaje: texto(body.mensaje, MAX_MENSAJE) || null,
      estimacion,
    },
  };
}

// Etiqueta legible de cada origen para los correos y el panel.
export const ORIGEN_LABEL = {
  calculadora: 'Calculadora de la portada',
  corredor: 'Landing Corredor Bioceánico',
  instituto: 'Landing Instituto',
  prueba: 'Página de códigos de prueba',
  lanzamiento: 'Lista de espera del lanzamiento',
  magic_sin_historial: 'Acceso sin historial',
  otro: 'Sitio web',
};

const CLP = (n) => Number(n || 0).toLocaleString('es-CL', { maximumFractionDigits: 0 });
const T = (n) => Number(n || 0).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Los correos del proyecto son HTML: todo texto que escribió el usuario
// se escapa antes de interpolarse — sin esto, un "lead" malicioso podría
// inyectar HTML (links de phishing incluidos) en la alerta que le llega
// al equipo, o en su propio acuse.
export function escaparHtml(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

// Correo al lead con SU estimación de la calculadora. Sin eco de texto
// libre del usuario (anti-abuso: este correo va a una casilla arbitraria
// y no puede servir de vehículo para mensajes de terceros) y sin la
// palabra prohibida del proyecto.
export function correoEstimacion({ nombre, estimacion }) {
  const total = T(estimacion?.total_t);
  const clp = estimacion?.compensacion_clp != null ? CLP(estimacion.compensacion_clp) : null;
  return {
    subject: 'Tu estimación de CO2e · sicr3p',
    html: `
      <div style="font-family:system-ui,Arial,sans-serif;color:#0f1f2e;max-width:520px">
        <h2 style="color:#0f1f2e">Tu estimación quedó guardada</h2>
        <p>Hola${nombre ? ` ${escaparHtml(nombre)}` : ''}, esta es la estimación que hiciste en sicr3p:</p>
        <div style="background:#eaf6ef;border:1px solid #28a745;border-radius:10px;padding:14px 18px;margin:12px 0">
          <div style="font-size:12px;color:#218838;font-weight:700">ESTIMACIÓN REFERENCIAL</div>
          <div style="font-size:22px;font-weight:800">${total} t CO2e</div>
          ${clp ? `<div style="font-size:13px;color:#64748b">Compensación estimada: $ ${clp} CLP al mes</div>` : ''}
        </div>
        <p style="color:#64748b;font-size:13px">Es una estimación referencial — el número exacto sale de tus documentos reales cuando inscribes tu empresa.</p>
        <p><a href="${config.publicAppUrl}/inscripcion" style="background:#28a745;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">Inscribir mi empresa</a></p>
        <p style="color:#64748b;font-size:12px">Usaremos tu correo solo para responderte. Si no hiciste esta estimación, ignora este mensaje.</p>
      </div>`,
  };
}

// Alerta interna al equipo: llegó un lead. Compartida por /interesados y
// /inscripcion — una sola forma de enterarse, un solo formato.
export function alertaLeadEmail({ tipo, datos }) {
  const d = datos || {};
  const origen = tipo === 'inscripcion' ? 'Formulario de inscripción' : (ORIGEN_LABEL[d.origen] || 'Sitio web');
  const quien = d.empresa || d.nombre_empresa || d.nombre || d.email || d.contacto_email || '—';
  const filas = [
    ['Origen', origen],
    ['Empresa', d.empresa || d.nombre_empresa],
    ['Nombre', d.nombre || d.contacto_nombre],
    ['Correo', d.email || d.contacto_email],
    ['Teléfono', d.telefono || d.contacto_telefono],
    ['RUT', d.rut],
    ['Interés', Array.isArray(d.intereses) && d.intereses.length ? d.intereses.join(', ') : null],
    ['Mensaje', d.mensaje],
    ['Estimación', d.estimacion?.total_t != null
      ? `≈ ${T(d.estimacion.total_t)} t CO2e${d.estimacion.compensacion_clp != null ? ` · $ ${CLP(d.estimacion.compensacion_clp)} CLP/mes` : ''}`
      : null],
  ].filter(([, v]) => v);
  return {
    subject: `Nuevo lead — ${origen} — ${quien}`,
    html: `
      <div style="font-family:system-ui,Arial,sans-serif;color:#0f1f2e;max-width:520px">
        <h2 style="color:#0f1f2e">Nuevo lead en el sitio</h2>
        <table style="border-collapse:collapse;font-size:14px">
          ${filas.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#64748b">${k}</td><td style="padding:4px 0"><b>${escaparHtml(v)}</b></td></tr>`).join('')}
        </table>
        <p style="margin-top:14px"><a href="${config.publicAppUrl}/admin/prospectos" style="background:#0f1f2e;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Ver en el panel</a></p>
      </div>`,
  };
}
