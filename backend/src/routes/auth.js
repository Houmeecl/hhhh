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

const PANELES_VALIDOS = ['sicrep', 'aduana_verde', 'puerto', 'mandante', 'agencia', 'trazador', 'proveedor'];

// Etiqueta legible de cada panel para el copy visible: 'aduana_verde' es
// el nombre interno histórico del canal que hoy se llama "terreno".
const NOMBRE_PANEL = {
  sicrep: 'sicrep', aduana_verde: 'terreno', puerto: 'Puerto',
  mandante: 'Mandante', agencia: 'Agencia', trazador: 'Trazador', proveedor: 'Proveedor',
};

// ---------- POST /api/auth/login ----------
router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña son obligatorios' });
    // Los siete logins propios de cada panel SIEMPRE mandan su panel
    // esperado y siguen exigiendo coincidencia exacta (comportamiento de
    // siempre: evita que alguien entre "por accidente" a la pantalla de
    // otro panel). El login general (pages/AccesoUnico.jsx) no manda
    // panel: no exige coincidencia, detecta el panel real de la cuenta
    // (ya viaja en `user.panel` de la respuesta) y el frontend redirige
    // solo con ese dato.
    const panelPedido = req.body.panel;
    if (panelPedido !== undefined && !PANELES_VALIDOS.includes(panelPedido)) {
      return res.status(400).json({ error: 'Panel inválido' });
    }

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
    if (panelPedido && user.panel !== panelPedido) {
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
        agencia_id: user.agencia_id,
        proveedor_id: user.proveedor_id,
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
  // Sesión de superadmin "entrando a otro panel" (ver POST
  // /api/admin/entrar-a-panel): el token es sintético, su `sub` NO es un
  // UUID de `usuarios` (es `imp:<superadminId>:<panel>`), así que esta
  // ruta responde directo desde el payload del JWT sin tocar la BD. Sin
  // esta rama, las apps de cada panel (que comparan el `panel` de /me
  // contra el suyo) verían el panel REAL del superadmin (sicrep) y
  // cerrarían la sesión de inmediato.
  if (req.user.imp) {
    return res.json({
      user: {
        id: req.user.sub,
        email: req.user.email,
        // Etiqueta legible, nunca el slug: 'aduana_verde' es el nombre
        // histórico interno del canal que en todo el copy visible se llama
        // "terreno" (ver README).
        nombre: `Superadmin (vista de ${NOMBRE_PANEL[req.user.panel] || req.user.panel})`,
        rol: req.user.rol,
        panel: req.user.panel,
        cliente_id: null,
        puerto_id: req.user.puerto_id,
        mandante_id: req.user.mandante_id,
        agencia_id: req.user.agencia_id,
        trazador_id: req.user.trazador_id,
        proveedor_id: req.user.proveedor_id,
        must_reset_password: false,
      },
    });
  }
  const { rows } = await query(
    `SELECT id, email, nombre, rol, panel, cliente_id, puerto_id, mandante_id, agencia_id, trazador_id, proveedor_id,
            must_reset_password, es_superadmin
     FROM usuarios WHERE id = $1`,
    [req.user.sub]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ user: rows[0] });
});

// ---------- PUT /api/auth/password — cambio de contraseña con sesión activa ----------
// Genérico para los 6 paneles (requireAuth, sin requireHomePanel): a
// diferencia de /activar (token de correo) exige la contraseña actual, así
// que sirve tanto para un cambio voluntario como para saldar
// must_reset_password — el caso de la contraseña temporal que genera
// routes/accesos.js para el panel trazador, que nunca recibe correo.
router.put('/password', requireAuth, async (req, res, next) => {
  try {
    // Sesión de superadmin viendo otro panel (`sub` sintético, no un UUID
    // de `usuarios`): no hay contraseña que cambiar acá.
    if (req.user.imp) {
      return res.status(403).json({ error: 'No se puede cambiar la contraseña desde una sesión de superadmin.' });
    }
    const { actual, nueva } = req.body;
    if (!actual || !nueva) return res.status(400).json({ error: 'Contraseña actual y nueva son obligatorias.' });
    if (String(nueva).length < 10) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 10 caracteres.' });

    const { rows } = await query(`SELECT * FROM usuarios WHERE id = $1`, [req.user.sub]);
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
    const ok = await bcrypt.compare(actual, user.password_hash || '');
    if (!ok) return res.status(401).json({ error: 'La contraseña actual no es correcta.' });

    const hash = await bcrypt.hash(nueva, config.bcryptRounds);
    await query(`UPDATE usuarios SET password_hash = $1, must_reset_password = false WHERE id = $2`, [hash, user.id]);
    await logActividad({ usuarioId: user.id, accion: 'cambio_password', entidad: 'usuario', entidadId: user.id, ip: req.ip });
    res.json({ ok: true });
  } catch (err) { next(err); }
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
// `codigo` (opcional): si viene y corresponde a un codigos_acceso con
// modo_juego=true, el enlace queda marcado para crear/recuperar un
// "jugador" al canjearse (ver /magic/verificar) — igual mecanismo que el
// magic link de siempre, solo que esta vez con una fila persistente que
// puede acumular puntos entre sesiones.
router.post('/magic', loginLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Ingresa un correo válido.' });
    }
    let codigoId = null;
    const codigo = req.body.codigo ? String(req.body.codigo).trim() : '';
    if (codigo) {
      const { rows: cRows } = await query(
        `SELECT id FROM codigos_acceso WHERE upper(codigo) = upper($1) AND activo = true AND modo_juego = true`,
        [codigo]
      );
      if (!cRows[0]) return res.status(400).json({ error: 'Código de invitación inválido o inactivo.' });
      codigoId = cRows[0].id;
    }
    const raw = crypto.randomBytes(32).toString('hex');
    const expira = new Date(Date.now() + 15 * 60 * 1000); // 15 min, un solo uso
    await query(
      `INSERT INTO tokens_magic (email, token_hash, expira_at, codigo_id) VALUES ($1,$2,$3,$4)`,
      [email, hashToken(raw), expira, codigoId]
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

    // Enlace de campaña "Sube y Suma": crea/recupera la fila de jugador
    // (UNIQUE email+codigo_id — idempotente si ya existía) y firma un JWT
    // de rol 'jugador' en vez de 'cliente'. 30 días: es una app de uso
    // repetido, no una consulta puntual de historial.
    if (tok.codigo_id) {
      const { rows: cod } = await query(`SELECT empresa FROM codigos_acceso WHERE id = $1`, [tok.codigo_id]);
      const { rows: existente } = await query(
        `SELECT id FROM jugadores WHERE email = $1 AND codigo_id = $2`, [tok.email, tok.codigo_id]
      );
      let jugadorId = existente[0]?.id;
      if (!jugadorId) {
        const { rows: nuevo } = await query(
          `INSERT INTO jugadores (email, codigo_id, empresa) VALUES ($1,$2,$3) RETURNING id`,
          [tok.email, tok.codigo_id, cod[0]?.empresa || null]
        );
        jugadorId = nuevo[0].id;
      }
      await logActividad({ accion: 'juego_login', entidad: 'jugador', entidadId: jugadorId, ip: req.ip });
      const jugadorToken = jwt.sign(
        { sub: `jugador:${jugadorId}`, rol: 'jugador', email: tok.email, jugadorId },
        config.jwt.accessSecret,
        { expiresIn: '30d' }
      );
      return res.json({ token: jugadorToken, email: tok.email, rol: 'jugador' });
    }

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
