import express from 'express';
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { config } from '../config.js';
import { query } from '../lib/db.js';
import { signAccess, signRefresh, logActividad } from '../middleware/auth.js';
import { loginLimiter } from '../middleware/rateLimit.js';

// ============================================================
// Login sin contraseña con llave USB FIDO2 con sensor de huella (ver
// migración 061). El registro de la llave vive en routes/admin.js (lo
// hace un admin, no este router público); acá solo el camino de LOGIN,
// simétrico al de contraseña de routes/auth.js.
//
// La huella se valida DENTRO de la llave física — este servidor nunca la
// recibe, solo una firma criptográfica que confirma "esta llave, que ya
// conocemos, verificó a su dueño". Por eso la respuesta final tiene
// EXACTAMENTE el mismo shape que POST /api/auth/login: el frontend
// (pages/IngresarPanel.jsx) reutiliza sin cambios su lógica de detectar
// el panel real y redirigir.
// ============================================================

const router = express.Router();

router.post('/login/opciones', loginLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'Correo obligatorio' });

    const { rows } = await query(`SELECT id, estado FROM usuarios WHERE email = $1`, [email]);
    const user = rows[0];
    const { rows: credenciales } = user
      ? await query(`SELECT credential_id, transports FROM credenciales_webauthn WHERE usuario_id = $1`, [user.id])
      : { rows: [] };

    // Respuesta genérica si no existe la cuenta o no tiene ninguna llave
    // registrada — mismo nivel de opacidad que ya usa /api/auth/login.
    if (!user || user.estado !== 'activo' || credenciales.length === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const options = await generateAuthenticationOptions({
      rpID: config.webauthn.rpID,
      userVerification: 'required',
      allowCredentials: credenciales.map((c) => ({
        id: c.credential_id,
        transports: c.transports || undefined,
      })),
    });

    await query(
      `INSERT INTO webauthn_challenges (usuario_id, tipo, challenge, expires_at)
       VALUES ($1,'login',$2,$3)
       ON CONFLICT (usuario_id, tipo) DO UPDATE SET challenge = EXCLUDED.challenge, expires_at = EXCLUDED.expires_at, created_at = now()`,
      [user.id, options.challenge, new Date(Date.now() + config.webauthn.challengeTtlMs)]
    );

    res.json(options);
  } catch (err) { next(err); }
});

router.post('/login/verificar', loginLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').toLowerCase().trim();
    const respuesta = req.body.respuesta;
    if (!email || !respuesta) return res.status(400).json({ error: 'Correo y respuesta son obligatorios' });

    const { rows: usuarios } = await query(`SELECT * FROM usuarios WHERE email = $1`, [email]);
    const user = usuarios[0];
    if (!user) return res.status(401).json({ error: 'Credenciales inválidas' });

    const { rows: desafios } = await query(
      `SELECT * FROM webauthn_challenges WHERE usuario_id = $1 AND tipo = 'login'`,
      [user.id]
    );
    const desafio = desafios[0];
    if (!desafio || new Date(desafio.expires_at) < new Date()) {
      return res.status(400).json({ error: 'El desafío expiró, intenta nuevamente' });
    }

    const { rows: credenciales } = await query(
      `SELECT * FROM credenciales_webauthn WHERE usuario_id = $1 AND credential_id = $2`,
      [user.id, respuesta.id]
    );
    const credencial = credenciales[0];
    if (!credencial) return res.status(401).json({ error: 'Credenciales inválidas' });

    let verificacion;
    try {
      verificacion = await verifyAuthenticationResponse({
        response: respuesta,
        expectedChallenge: desafio.challenge,
        expectedOrigin: config.webauthn.origin,
        expectedRPID: config.webauthn.rpID,
        credential: {
          id: credencial.credential_id,
          publicKey: Buffer.from(credencial.public_key, 'base64'),
          counter: Number(credencial.counter),
          transports: credencial.transports || undefined,
        },
      });
    } catch {
      return res.status(400).json({ error: 'Respuesta de la llave inválida' });
    }
    if (!verificacion.verified) return res.status(401).json({ error: 'Credenciales inválidas' });

    await query(`DELETE FROM webauthn_challenges WHERE id = $1`, [desafio.id]);
    await query(
      `UPDATE credenciales_webauthn SET counter = $1, last_used_at = now() WHERE id = $2`,
      [verificacion.authenticationInfo.newCounter, credencial.id]
    );

    if (user.estado !== 'activo') {
      return res.status(403).json({ error: 'Cuenta inactiva. Contacta al administrador.' });
    }

    await query(`UPDATE usuarios SET ultimo_login = now() WHERE id = $1`, [user.id]);
    await logActividad({ usuarioId: user.id, accion: 'login_webauthn', entidad: 'usuario', entidadId: user.id, ip: req.ip });

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
        must_reset_password: user.must_reset_password,
      },
    });
  } catch (err) { next(err); }
});

export default router;
