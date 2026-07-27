import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../lib/db.js';
import { signAccess, signRefresh, requireAuth, logActividad } from '../middleware/auth.js';
import { loginLimiter } from '../middleware/rateLimit.js';
import { sendMail, resetEmail, magicEmail } from '../services/mailer.js';
import { RUTA_ACTIVAR } from '../services/cuentas.js';

const router = express.Router();

const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

const PANELES_VALIDOS = ['sicrep', 'aduana_verde', 'puerto', 'mandante'];

// ---------- POST /api/auth/login ----------
router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    // El frontend de cada panel siempre manda el panel esperado; sin
    // panel en el body (clientes API viejos) se asume 'sicrep'.
    const panelEsperado = PANELES_VALIDOS.includes(req.body.panel) ? req.body.panel : 'sicrep';
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña son obligatorios' });

    const { rows } = await query(`SELECT * FROM usuarios WHERE email = $1`, [String(email).toLowerCase()]);
    const user = rows[0];
    // Respuesta genérica para no filtrar existencia de cuentas.
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    if (user.estado !== 'activo') {
      return res.status(403).json({ error: 'Cuenta inactiva. Contacta al administrador.' });
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });
    if (user.panel !== panelEsperado) {
      return res.status(403).json({ error: 'Esta cuenta no pertenece a este panel.' });
    }

    await query(`UPDATE usuarios SET ultimo_login = now() WHERE id = $1`, [user.id]);
    await logActividad({ usuarioId: user.id, accion: 'login', entidad: 'usuario', entidadId: user.id, ip: req.ip });

    res.json({
      accessToken: signAccess(user),
      refreshToken: signRefresh(user),
      user: {
        id: user.id,
        email: user.email,
        nombre: user.nombre,
        rol: user.rol,
        panel: user.panel,
        puerto_id: user.puerto_id,
        mandante_id: user.mandante_id,
        must_reset_password: user.must_reset_password,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/auth/refresh ----------
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(401).json({ error: 'Falta refresh token' });
  try {
    const payload = jwt.verify(refreshToken, config.jwt.refreshSecret);
    const { rows } = await query(`SELECT * FROM usuarios WHERE id = $1`, [payload.sub]);
    const user = rows[0];
    if (!user || user.estado !== 'activo') return res.status(401).json({ error: 'Sesión inválida' });
    res.json({ accessToken: signAccess(user) });
  } catch {
    return res.status(401).json({ error: 'Refresh token inválido' });
  }
});

// ---------- GET /api/auth/me ----------
router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT id, email, nombre, rol, panel, cliente_id, puerto_id, mandante_id, must_reset_password FROM usuarios WHERE id = $1`,
    [req.user.sub]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ user: rows[0] });
});

// ---------- POST /api/auth/activar — define contraseña con token ----------
// Sirve para activación inicial y para reset (ambos usan token hasheado).
router.post('/activar', async (req, res, next) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token y contraseña son obligatorios' });
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }
    const th = hashToken(token);
    const { rows } = await query(
      `SELECT * FROM tokens_password WHERE token_hash = $1 AND usado = false AND expira_at > now()`,
      [th]
    );
    const tok = rows[0];
    if (!tok) return res.status(400).json({ error: 'Enlace inválido o expirado' });

    const hash = await bcrypt.hash(password, config.bcryptRounds);
    await query(
      `UPDATE usuarios SET password_hash = $1, must_reset_password = false, estado = 'activo' WHERE id = $2`,
      [hash, tok.usuario_id]
    );
    await query(`UPDATE tokens_password SET usado = true WHERE id = $1`, [tok.id]);
    await logActividad({ usuarioId: tok.usuario_id, accion: `password_${tok.tipo}`, entidad: 'usuario', entidadId: tok.usuario_id, ip: req.ip });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/auth/solicitar-reset ----------
router.post('/solicitar-reset', loginLimiter, async (req, res, next) => {
  try {
    const { email } = req.body;
    const { rows } = await query(`SELECT * FROM usuarios WHERE email = $1`, [String(email || '').toLowerCase()]);
    const user = rows[0];
    // Respuesta genérica (no revela si el correo existe).
    if (user && user.estado === 'activo') {
      const raw = crypto.randomBytes(32).toString('hex');
      const expira = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2h
      await query(
        `INSERT INTO tokens_password (usuario_id, token_hash, tipo, expira_at) VALUES ($1,$2,'reset',$3)`,
        [user.id, hashToken(raw), expira]
      );
      const ruta = RUTA_ACTIVAR[user.panel] || RUTA_ACTIVAR.sicrep;
      const link = `${config.publicAppUrl}${ruta}?token=${raw}`;
      const mail = resetEmail({ nombre: user.nombre, link });
      await sendMail({ to: user.email, ...mail });
    }
    res.json({ ok: true, mensaje: 'Si el correo existe, enviamos instrucciones.' });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// MAGIC LINK — acceso de clientes sin contraseña.
// El cliente ingresa su email y recibe un enlace de un solo uso
// que le da acceso a SU historial (filtrado por email).
// ============================================================

// ---------- POST /api/auth/magic — solicita el enlace ----------
router.post('/magic', loginLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Ingresa un correo válido.' });
    }
    const raw = crypto.randomBytes(32).toString('hex');
    const expira = new Date(Date.now() + 15 * 60 * 1000); // 15 min, un solo uso
    await query(
      `INSERT INTO tokens_magic (email, token_hash, expira_at) VALUES ($1,$2,$3)`,
      [email, hashToken(raw), expira]
    );
    const link = `${config.publicAppUrl}/acceso?token=${raw}`;
    await sendMail({ to: email, ...magicEmail({ link }) });
    // Respuesta genérica: no revela si el correo tiene historial.
    res.json({ ok: true, mensaje: 'Te enviamos un enlace de acceso. Revisa tu correo.' });
  } catch (err) { next(err); }
});

// ---------- POST /api/auth/magic/verificar — canjea el token ----------
router.post('/magic/verificar', async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Falta el token.' });
    const { rows } = await query(
      `SELECT * FROM tokens_magic WHERE token_hash = $1 AND usado = false AND expira_at > now()`,
      [hashToken(token)]
    );
    const tok = rows[0];
    if (!tok) return res.status(401).json({ error: 'Enlace inválido o expirado. Solicita uno nuevo.' });
    await query(`UPDATE tokens_magic SET usado = true WHERE id = $1`, [tok.id]);
    await logActividad({ accion: 'magic_login', entidad: 'cliente', entidadId: tok.email, ip: req.ip });

    // JWT de rol cliente (no es cuenta de usuarios; solo ve su propio historial).
    const clienteToken = jwt.sign(
      { sub: `cliente:${tok.email}`, rol: 'cliente', email: tok.email },
      config.jwt.accessSecret,
      { expiresIn: '7d' }
    );
    res.json({ token: clienteToken, email: tok.email });
  } catch (err) { next(err); }
});

export default router;
