import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { query } from '../lib/db.js';
import { sendMail, activationEmail, elegirTransporte } from './mailer.js';
import { logActividad } from '../middleware/auth.js';

// Qué columna FK de `usuarios` corresponde a cada panel externo, y en qué
// tabla vive la entidad — usado tanto por accesos.js (una ruta por
// entidad) como por admin.js POST /usuarios (una ruta unificada).
export const ENTIDAD_POR_PANEL = {
  puerto: { columnaFk: 'puerto_id', tabla: 'puertos' },
  mandante: { columnaFk: 'mandante_id', tabla: 'mandantes' },
  agencia: { columnaFk: 'agencia_id', tabla: 'agencias_aduana' },
  trazador: { columnaFk: 'trazador_id', tabla: 'trazadores' },
  proveedor: { columnaFk: 'proveedor_id', tabla: 'proveedores' },
};

// ============================================================
// Activación de cuenta compartida por los 7 paneles (sicrep, terreno,
// puerto, mandante, agencia, trazador, proveedor) — la fila de `usuarios`
// y el flujo de token+correo son idénticos; solo cambia a qué login se
// vuelve tras definir la contraseña. Los siete logins comparten
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
  proveedor: '/panel-proveedor/activar',
};

// Etiqueta legible de cada panel — se imprime en el asunto/remitente de los
// correos de activación y de restablecimiento de contraseña (mailer.js
// `area`), para que quien recibe varias invitaciones seguidas (o gestiona
// cuentas de más de un panel) sepa de inmediato cuál es cuál sin abrir el
// correo. Fuente única: antes routes/auth.js tenía su propio mapa
// (NOMBRE_PANEL) con la misma info duplicada — ahora lo importa de acá.
export const PANEL_LABEL = {
  sicrep: 'Admin',
  aduana_verde: 'Terreno',
  puerto: 'Puerto',
  mandante: 'Mandante',
  agencia: 'Agencia',
  trazador: 'Trazador',
  proveedor: 'Proveedor',
};

const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

// Envía (o reenvía) el correo de activación para un usuario ya insertado.
// No lanza si el correo falla: registra el error y avisa al llamador, para
// que la cuenta no quede "atascada" sin ningún enlace visible en ninguna parte.
export async function enviarActivacion({ usuarioId, email, nombre, panel }) {
  const raw = crypto.randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48h
  // La invitación nueva reemplaza a la anterior, no se suma a ella. Reenviar
  // se pide justamente cuando el enlace viejo se perdió o llegó a manos que
  // ya no corresponden (la persona que lo recibió se fue de la empresa);
  // dejarlo vivo 48h más, y acumulando uno por reenvío, sería lo contrario de
  // lo que el admin cree que está haciendo.
  await query(
    `UPDATE tokens_password SET usado = true
     WHERE usuario_id = $1 AND tipo = 'activacion' AND usado = false`,
    [usuarioId]
  );
  await query(
    `INSERT INTO tokens_password (usuario_id, token_hash, tipo, expira_at) VALUES ($1,$2,'activacion',$3)`,
    [usuarioId, hashToken(raw), expira]
  );
  const ruta = RUTA_ACTIVAR[panel] || RUTA_ACTIVAR.sicrep;
  const link = `${config.publicAppUrl}${ruta}?token=${raw}`;
  const area = PANEL_LABEL[panel] || PANEL_LABEL.sicrep;
  let correoEnviado = true;
  try {
    await sendMail({ to: email, area, ...activationEmail({ nombre, link, area }) });
  } catch (err) {
    correoEnviado = false;
    console.error('[activacion] no se pudo enviar el correo:', err.message);
  }
  // Sin ningún transporte de correo (dev) o si el envío real falló:
  // devolvemos el link para que el admin lo pueda compartir a mano en vez de
  // perderlo. Se pregunta por el transporte EFECTIVO y no por la llave de
  // Resend: en un VPS con SMTP propio y sin Resend, mirar `resend.apiKey`
  // daba siempre "no hay correo" y el token de activación volvía en el
  // response —y a la pantalla del admin— aunque el correo se hubiera
  // entregado bien.
  const mostrarLink = elegirTransporte() === 'dev' || !correoEnviado;
  return { link, correoEnviado, dev_activation_link: mostrarLink ? link : undefined };
}

// Alfabeto sin caracteres ambiguos (sin 0/O, 1/l/I) — se pensó para
// transcribirse a mano, no solo para copiar/pegar.
const ALFABETO_PASSWORD = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

// Contraseña temporal para cualquier creación de cuenta (todos los
// paneles): el correo no es confiable, así que el admin la genera y la ve
// UNA sola vez en el mismo response de creación, para entregarla a mano.
// La cuenta queda con must_reset_password=true.
//
// Con SEED_DEMO=true (mismo flag que guarda la siembra de clientes/
// prospectos ficticios en este archivo, nunca activo en producción) se
// devuelve un valor fijo "demo123" en vez de aleatorio — solo para que
// probar el flujo de creación de cuentas en local no obligue a copiar una
// contraseña generada cada vez. En producción SEED_DEMO no está definido:
// siempre sale la aleatoria real.
export function generarPasswordTemporal(largo = 12) {
  if (config.seedDemo) return 'demo123';
  const bytes = crypto.randomBytes(largo);
  let out = '';
  for (let i = 0; i < largo; i++) out += ALFABETO_PASSWORD[bytes[i] % ALFABETO_PASSWORD.length];
  return out;
}

// Crea el login web de un actor externo (puerto, mandante, agencia,
// trazador o proveedor): una fila de `usuarios` atada a SU entidad vía
// puerto_id/mandante_id/agencia_id/trazador_id/proveedor_id (migraciones
// 042/046/058/062). Compartida por routes/accesos.js (una ruta por
// entidad) y routes/admin.js POST /usuarios (alta unificada).
//
// El correo no se envía: el admin genera aquí una contraseña temporal que
// se muestra UNA sola vez en el response — la cuenta queda activa de
// inmediato con must_reset_password=true. Un solo login por entidad
// (UNIQUE parcial en la migración de cada panel).
// `nombrePorDefecto`: nombre a usar cuando el llamador no manda uno. Lo ocupa
// el enrolamiento de empresas en un solo paso (admin/Enrolar.jsx), que a
// propósito solo pide RUT y correo: el nombre de la PERSONA de contacto no se
// conoce todavía — la empresa lo completa después en su propio onboarding
// (representante). Sin esto el enrolamiento fallaba con "Email y nombre son
// obligatorios" y la empresa nunca recibía su invitación.
export async function crearCuentaEntidad({ req, res, panel, columnaFk, entidadId, nivelAcceso = 'operador', enviarCorreo = false, nombrePorDefecto = '' }) {
  const email = String(req.body.email || '').toLowerCase().trim();
  const nombre = String(req.body.nombre || '').trim() || String(nombrePorDefecto || '').trim();
  if (!email || !nombre) return res.status(400).json({ error: 'Email y nombre son obligatorios.' });

  const password = generarPasswordTemporal();
  const hash = await bcrypt.hash(password, config.bcryptRounds);
  let rows;
  try {
    ({ rows } = await query(
      `INSERT INTO usuarios (email, nombre, rol, panel, ${columnaFk}, nivel_acceso, estado, password_hash, must_reset_password)
       VALUES ($1,$2,'operador',$3,$4,$5,'activo',$6,true)
       ON CONFLICT (email) DO NOTHING RETURNING id`,
      [email, nombre, panel, entidadId, nivelAcceso, hash]
    ));
  // Los dos 409 tienen causas distintas y el llamador necesita distinguirlas:
  // "esta entidad ya tiene acceso" se resuelve reenviando la invitación
  // (admin/Enrolar.jsx lo hace solo), mientras que "el correo ya está en uso"
  // apunta a OTRA cuenta y no se arregla reenviando nada. El `codigo` es lo
  // que permite decidir sin leer el texto del mensaje.
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ codigo: 'entidad_con_cuenta', error: 'Esta entidad ya tiene un acceso web creado.' });
    }
    throw e;
  }
  if (!rows[0]) return res.status(409).json({ codigo: 'email_en_uso', error: 'Ya existe un usuario con ese correo.' });

  // La contraseña NUNCA se guarda en el log de actividad, solo su hash en `usuarios`.
  await logActividad({
    usuarioId: req.user.sub, accion: `crear_cuenta_${panel}`, entidad: 'usuario',
    entidadId: rows[0].id, detalle: { email }, ip: req.ip,
  });

  // Con enviarCorreo=true (panel proveedor): además del password temporal se
  // envía un correo con enlace de activación, para que el proveedor pueda
  // entrar solo, sin que el admin tenga que transcribirle la clave.
  let correo;
  if (enviarCorreo) {
    correo = await enviarActivacion({ usuarioId: rows[0].id, email, nombre, panel });
  }
  res.status(201).json({
    ok: true, usuario_id: rows[0].id, email, password,
    ...(correo ? { correo_enviado: correo.correoEnviado, dev_activation_link: correo.dev_activation_link } : {}),
  });
}
