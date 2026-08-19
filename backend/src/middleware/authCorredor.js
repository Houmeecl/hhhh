import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { queryCorredor, corredorDisponible } from '../lib/dbCorredor.js';

// ============================================================
// Autenticación del Corredor — SEPARADA de la de sicr3p.
//
// SECRETO PROPIO, no el de la app principal. Compartirlo haría que un
// token del Corredor verificara contra sicr3p: lo rechazarían los guardias
// de panel, sí, pero el token sería estructuralmente válido y la
// separación quedaría dependiendo de que ningún guardia se olvide. Con
// secretos distintos ni siquiera pasa la verificación de firma.
//
// SIN DEFAULT DE DESARROLLO. `config.jwt.accessSecret` cae a
// 'dev_access_secret_change_me' cuando falta, y eso está bien para la app
// que ya existe y tiene un chequeo de producción que lo caza. Acá no hay
// default: sin JWT_SECRET_CORREDOR el subsistema queda apagado. Un secreto
// por defecto en un producto nuevo es la clase de cosa que llega a
// producción sin que nadie la mire.
// ============================================================

export function corredorConfigurado() {
  return corredorDisponible() && Boolean(config.corredor.jwtSecret);
}

// Qué falta, dicho por su nombre. Un 503 que dice "no configurado" y nada
// más obliga a ir a leer el código para saber qué variable poner.
export function faltaDeConfiguracion() {
  const faltan = [];
  if (!corredorDisponible()) faltan.push('DATABASE_URL_CORREDOR');
  if (!config.corredor.jwtSecret) faltan.push('JWT_SECRET_CORREDOR');
  return faltan;
}

export function firmarTokenCorredor(usuario) {
  return jwt.sign(
    {
      sub: usuario.id,
      email: usuario.email,
      rol: usuario.rol,
      exportador_id: usuario.exportador_id || null,
      must_reset_password: usuario.must_reset_password === true,
      // Marca explícita del producto. Aunque el secreto ya impide que
      // este token sirva del otro lado, dejarlo escrito hace que un token
      // pegado en un log se pueda identificar de un vistazo.
      app: 'corredor',
    },
    config.corredor.jwtSecret,
    { expiresIn: config.jwt.accessTtl }
  );
}

// Guardia de disponibilidad. Va ANTES que el de autenticación: si el
// Corredor no está configurado, el problema no es que falte el token.
export function requireCorredorActivo(req, res, next) {
  const faltan = faltaDeConfiguracion();
  if (faltan.length) {
    return res.status(503).json({
      error: 'El Corredor no está habilitado en este servidor.',
      codigo: 'corredor_no_configurado',
      falta: faltan,
    });
  }
  next();
}

export function requireAuthCorredor(req, res, next) {
  const cabecera = String(req.headers.authorization || '');
  const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Falta el token de sesión.' });
  try {
    const payload = jwt.verify(token, config.corredor.jwtSecret);
    // Defensa en profundidad: si algún día los secretos coincidieran por
    // error de configuración, un token de sicr3p igual no entra acá.
    if (payload.app !== 'corredor') {
      return res.status(401).json({ error: 'Este token no es del Corredor.' });
    }
    req.usuario = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Sesión inválida o expirada.' });
  }
}

// Mientras la clave siga siendo la temporal, la cuenta solo puede
// cambiarla. Sin esto, una clave que el admin dictó por teléfono queda
// operando indefinidamente.
export function requireClaveDefinida(req, res, next) {
  if (req.usuario?.must_reset_password) {
    return res.status(403).json({
      error: 'Tienes que definir tu contraseña antes de continuar.',
      codigo: 'clave_temporal',
    });
  }
  next();
}

export function requireAdminCorredor(req, res, next) {
  if (req.usuario?.rol !== 'admin') {
    return res.status(403).json({ error: 'Esta acción es solo para la administración del Corredor.' });
  }
  next();
}

// El exportador de la sesión. Un admin puede mirar el de otra empresa
// pasándolo por query; un operador NUNCA — su empresa sale del token y no
// del request, que es lo que impide que vea cargas ajenas cambiando un id
// en la URL.
export function exportadorDeLaSesion(req) {
  if (req.usuario?.rol === 'admin' && req.query?.exportador_id) {
    return String(req.query.exportador_id);
  }
  return req.usuario?.exportador_id || null;
}

// Bitácora del Corredor, en su propia tabla. No lanza: que no se pueda
// registrar una acción no puede hacer fallar la acción.
export async function logCorredor({ usuarioId, email, accion, entidad, entidadId, detalle, ip }) {
  try {
    await queryCorredor(
      `INSERT INTO actividad_corredor (usuario_id, email, accion, entidad, entidad_id, detalle, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [usuarioId || null, email || null, accion, entidad || null, entidadId || null,
       JSON.stringify(detalle || {}), ip || null]
    );
  } catch (err) {
    console.error('[corredor] no se pudo registrar en la bitácora:', err.message);
  }
}
