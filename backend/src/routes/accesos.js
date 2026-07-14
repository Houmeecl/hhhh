import express from 'express';
import crypto from 'crypto';
import { query } from '../lib/db.js';
import { requireAuth, requireRole, logActividad } from '../middleware/auth.js';

// ============================================================
// Administración de accesos externos:
//  - MANDANTES (API keys para consultar proveedores)
//  - CÓDIGOS DE ACCESO con créditos (mini sitio de prueba)
// ============================================================

const router = express.Router();
router.use(requireAuth);
const adminOnly = requireRole('admin');
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

// ---------- MANDANTES ----------
router.get('/mandantes', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, nombre_empresa, rut, email, activo, ultimo_uso, created_at
       FROM mandantes ORDER BY created_at DESC`
    );
    res.json({ mandantes: rows });
  } catch (err) { next(err); }
});

router.post('/mandantes', adminOnly, async (req, res, next) => {
  try {
    const { nombre_empresa, rut, email } = req.body;
    if (!nombre_empresa || !rut) return res.status(400).json({ error: 'Empresa y RUT son obligatorios.' });
    // El token se muestra UNA sola vez; solo se guarda su hash.
    const token = `smk_${crypto.randomBytes(24).toString('base64url')}`;
    const { rows } = await query(
      `INSERT INTO mandantes (nombre_empresa, rut, email, token_hash)
       VALUES ($1,$2,$3,$4) RETURNING id, nombre_empresa, rut, email, activo, created_at`,
      [nombre_empresa, rut, email || null, hashToken(token)]
    );
    await logActividad({ usuarioId: req.user.sub, accion: 'crear_mandante', entidad: 'mandante', entidadId: rows[0].id, ip: req.ip });
    res.status(201).json({ mandante: rows[0], token });
  } catch (err) { next(err); }
});

router.put('/mandantes/:id', adminOnly, async (req, res, next) => {
  try {
    const { activo } = req.body;
    const { rows } = await query(
      `UPDATE mandantes SET activo = COALESCE($2, activo) WHERE id = $1
       RETURNING id, nombre_empresa, rut, activo`,
      [req.params.id, typeof activo === 'boolean' ? activo : null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Mandante no encontrado' });
    res.json({ mandante: rows[0] });
  } catch (err) { next(err); }
});

// ---------- CÓDIGOS DE ACCESO (créditos) ----------
router.get('/codigos', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM codigos_acceso ORDER BY created_at DESC LIMIT 300`
    );
    res.json({ codigos: rows });
  } catch (err) { next(err); }
});

router.post('/codigos', adminOnly, async (req, res, next) => {
  try {
    const n = Math.min(50, Math.max(1, Number(req.body.cantidad) || 1));
    const creditos = Math.min(100, Math.max(1, Number(req.body.creditos) || 5));
    const { empresa, email } = req.body;
    const creados = [];
    for (let i = 0; i < n; i++) {
      const codigo = `SICR3P-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const { rows } = await query(
        `INSERT INTO codigos_acceso (codigo, creditos, empresa, email)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [codigo, creditos, empresa || null, email || null]
      );
      creados.push(rows[0]);
    }
    await logActividad({ usuarioId: req.user.sub, accion: 'crear_codigos', entidad: 'codigo_acceso', entidadId: String(n), ip: req.ip });
    res.status(201).json({ codigos: creados });
  } catch (err) { next(err); }
});

router.put('/codigos/:id', adminOnly, async (req, res, next) => {
  try {
    const { activo, creditos } = req.body;
    const { rows } = await query(
      `UPDATE codigos_acceso SET
         activo = COALESCE($2, activo),
         creditos = COALESCE($3, creditos)
       WHERE id = $1 RETURNING *`,
      [req.params.id, typeof activo === 'boolean' ? activo : null,
       creditos != null ? Number(creditos) : null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Código no encontrado' });
    res.json({ codigo: rows[0] });
  } catch (err) { next(err); }
});

export default router;
