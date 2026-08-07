import express from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../lib/db.js';
import { signAccess, signRefresh, logActividad } from '../middleware/auth.js';
import { loginLimiter } from '../middleware/rateLimit.js';
import { tokenCoincide } from '../services/llaveArchivo.js';

// ============================================================
// Login con la llave de archivo (ver migración 068 y el registro en
// routes/admin.js): un archivo .sicr3p-llave guardado en un pendrive +
// un PIN de 6 dígitos verificado ACÁ, en el servidor — nunca cifrando
// el archivo (un PIN corto se rompería offline en segundos). Camino
// simétrico al de routes/webauthn.js: la respuesta final tiene
// EXACTAMENTE el mismo shape que POST /api/auth/login.
//
// Solo los fallos de PIN con un token VÁLIDO cuentan para el bloqueo:
// si un token cualquiera contara, alguien con solo el serial (visible
// en el panel admin y en el log de actividad) podría bloquear la
// credencial de otro a voluntad.
// ============================================================

const router = express.Router();

const MAX_INTENTOS = 5;
const BLOQUEO_MS = 15 * 60 * 1000;

router.post('/', loginLimiter, async (req, res, next) => {
  try {
    const serial = String(req.body.serial || '').trim();
    const token = req.body.token;
    const pin = String(req.body.pin || '');
    if (!serial || !token || !pin) {
      return res.status(400).json({ error: 'Serial, archivo y PIN son obligatorios' });
    }

    const { rows } = await query(
      `SELECT ca.id AS credencial_id, ca.token_hash, ca.pin_hash, ca.activo AS credencial_activa,
              ca.intentos_fallidos, ca.bloqueado_hasta,
              u.id, u.email, u.nombre, u.rol, u.panel, u.estado, u.cliente_id,
              u.puerto_id, u.mandante_id, u.agencia_id, u.trazador_id, u.proveedor_id, u.must_reset_password,
              -- Sin estas dos, signAccess() cae a sus defaults (false /
              -- 'operador'): una cuenta de solo lectura entrando por llave
              -- de archivo quedaría habilitada para escribir.
              u.es_superadmin, u.nivel_acceso
       FROM credenciales_archivo ca JOIN usuarios u ON u.id = ca.usuario_id
       WHERE ca.serial = $1`,
      [serial]
    );
    const fila = rows[0];
    // Respuesta genérica: no se distingue serial inexistente de revocado.
    if (!fila || !fila.credencial_activa) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    if (fila.bloqueado_hasta && new Date(fila.bloqueado_hasta) > new Date()) {
      return res.status(429).json({ error: 'Llave bloqueada por demasiados intentos. Intenta más tarde.' });
    }
    if (!tokenCoincide(token, fila.token_hash)) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Igual que en /auth/login: el login general (AccesoUnico) no manda
    // panel; los logins propios de cada panel sí y exigen coincidencia.
    const panelPedido = req.body.panel;
    if (panelPedido && fila.panel !== panelPedido) {
      return res.status(403).json({ error: 'Esta cuenta no pertenece a este panel.' });
    }

    const pinOk = await bcrypt.compare(pin, fila.pin_hash);
    if (!pinOk) {
      const intentos = fila.intentos_fallidos + 1;
      const bloquear = intentos >= MAX_INTENTOS;
      await query(
        `UPDATE credenciales_archivo
         SET intentos_fallidos = $1, bloqueado_hasta = CASE WHEN $2 THEN now() + interval '15 minutes' ELSE bloqueado_hasta END
         WHERE id = $3`,
        [intentos, bloquear, fila.credencial_id]
      );
      if (bloquear) return res.status(429).json({ error: 'Llave bloqueada por demasiados intentos. Intenta más tarde.' });
      return res.status(401).json({ error: 'PIN incorrecto' });
    }

    if (fila.estado !== 'activo') {
      return res.status(403).json({ error: 'Cuenta inactiva. Contacta al administrador.' });
    }

    await query(
      `UPDATE credenciales_archivo SET intentos_fallidos = 0, bloqueado_hasta = NULL, last_used_at = now() WHERE id = $1`,
      [fila.credencial_id]
    );
    await query(`UPDATE usuarios SET ultimo_login = now() WHERE id = $1`, [fila.id]);
    await logActividad({ usuarioId: fila.id, accion: 'login_llave_archivo', entidad: 'usuario', entidadId: fila.id, ip: req.ip });

    res.json({
      accessToken: signAccess(fila),
      refreshToken: signRefresh(fila),
      user: {
        id: fila.id,
        email: fila.email,
        nombre: fila.nombre,
        rol: fila.rol,
        panel: fila.panel,
        puerto_id: fila.puerto_id,
        mandante_id: fila.mandante_id,
        agencia_id: fila.agencia_id,
        proveedor_id: fila.proveedor_id,
        must_reset_password: fila.must_reset_password,
      },
    });
  } catch (err) { next(err); }
});

export default router;
