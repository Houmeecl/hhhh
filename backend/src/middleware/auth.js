import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../lib/db.js';

export function signAccess(user) {
  return jwt.sign(
    { sub: user.id, rol: user.rol, email: user.email, cliente_id: user.cliente_id || null,
      panel: user.panel || 'sicrep', puerto_id: user.puerto_id || null, mandante_id: user.mandante_id || null,
      agencia_id: user.agencia_id || null, trazador_id: user.trazador_id || null },
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

// Registra una acción en actividad_log.
export async function logActividad({ usuarioId, accion, entidad, entidadId, detalle, ip }) {
  try {
    await query(
      `INSERT INTO actividad_log (usuario_id, accion, entidad, entidad_id, detalle, ip)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [usuarioId || null, accion, entidad || null, entidadId || null, detalle ? JSON.stringify(detalle) : null, ip || null]
    );
  } catch (e) {
    console.warn('[actividad_log]', e.message);
  }
}
