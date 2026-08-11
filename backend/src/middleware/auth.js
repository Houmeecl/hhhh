import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../lib/db.js';

export function signAccess(user) {
  return jwt.sign(
    { sub: user.id, rol: user.rol, email: user.email, cliente_id: user.cliente_id || null,
      panel: user.panel || 'sicrep', puerto_id: user.puerto_id || null, mandante_id: user.mandante_id || null,
      agencia_id: user.agencia_id || null, trazador_id: user.trazador_id || null, proveedor_id: user.proveedor_id || null,
      es_superadmin: user.es_superadmin === true, nivel_acceso: user.nivel_acceso || 'operador' },
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessTtl }
  );
}

export function signRefresh(user) {
  return jwt.sign({ sub: user.id, type: 'refresh' }, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshTtl,
  });
}

// Exige un JWT de acceso válido.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    req.user = jwt.verify(token, config.jwt.accessSecret);
    next();
  } catch {
    return res.status(401).json({ error: 'Sesión expirada o inválida' });
  }
}

// Exige uno de los roles indicados.
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.rol)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    next();
  };
}

// Exige que la cuenta pertenezca al panel indicado (sicrep | aduana_verde).
// Se combina con requireAuth/requireRole, no los reemplaza: separa el
// panel núcleo sicrep del panel del mostrador presencial sin tocar el rol interno.
export function requireHomePanel(panel) {
  return (req, res, next) => {
    if (!req.user || req.user.panel !== panel) {
      return res.status(403).json({ error: 'Esta cuenta no tiene acceso a este panel' });
    }
    next();
  };
}

// Exige que la cuenta esté marcada como superadmin (migración 069) — un
// nivel por encima de requireRole('admin'), independiente de él: un admin
// de sicrep sin esta marca NO puede canjear un token de vista de otro
// panel (ver POST /api/admin/entrar-a-panel).
export function requireSuperadmin(req, res, next) {
  if (!req.user || req.user.es_superadmin !== true) {
    return res.status(403).json({ error: 'Solo un superadmin puede hacer esto' });
  }
  next();
}

// Exige nivel_acceso='operador' — usado en las 2 mutaciones que hoy
// existen en los paneles externos (ver migración 070). 'lectura' nunca
// puede mutar.
export function requireNivelOperador(req, res, next) {
  if (req.user?.nivel_acceso === 'lectura') {
    return res.status(403).json({ error: 'Tu cuenta es de solo lectura.' });
  }
  next();
}

// El `sub` de una sesión de vista de superadmin es `imp:<uuid>:<panel>`,
// que no entra en actividad_log.usuario_id (UUID). Sin traducirlo, el
// INSERT falla y el catch de abajo lo degrada a un warning: la sesión
// quedaría sin ninguna huella auditable. Se registra al superadmin REAL
// (imp_by) y se deja constancia de la vista en el detalle.
const SUB_IMP = /^imp:([0-9a-f-]{36}):(.+)$/i;
function normalizarActor(usuarioId, detalle) {
  const m = typeof usuarioId === 'string' ? usuarioId.match(SUB_IMP) : null;
  if (!m) return { usuarioId: usuarioId || null, detalle };
  return {
    usuarioId: m[1],
    detalle: { ...(detalle || {}), via: 'vista_superadmin', panel_vista: m[2] },
  };
}

// Registra una acción en actividad_log.
export async function logActividad({ usuarioId, accion, entidad, entidadId, detalle, ip }) {
  try {
    const actor = normalizarActor(usuarioId, detalle);
    await query(
      `INSERT INTO actividad_log (usuario_id, accion, entidad, entidad_id, detalle, ip)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [actor.usuarioId, accion, entidad || null, entidadId || null, actor.detalle ? JSON.stringify(actor.detalle) : null, ip || null]
    );
  } catch (e) {
    console.warn('[actividad_log]', e.message);
  }
}
