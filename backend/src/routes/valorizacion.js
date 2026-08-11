import express from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole, requireHomePanel, requireSeccion, logActividad } from '../middleware/auth.js';
import { valorizar } from '../services/valorizacion.js';

// ============================================================
// Valorización de inventario FIFO / PMP (CLP + CO2e).
// Los movimientos entran solos desde DTE XML (precio real) o a mano.
// ============================================================

const router = express.Router();
router.use(requireAuth, requireHomePanel('sicrep'), requireSeccion('trazabilidad'));
const adminOnly = requireRole('admin', 'operador');

const rutNorm = (r) => String(r || '').replace(/[^0-9kK]/g, '').toUpperCase();

// ---------- GET /inventario?rut=&metodo=fifo|pmp&desde=&hasta= ----------
router.get('/inventario', async (req, res, next) => {
  try {
    const { rut } = req.query;
    if (!rut) return res.status(400).json({ error: 'Indica el RUT del cliente.' });
    const metodo = req.query.metodo === 'pmp' ? 'pmp' : 'fifo';
    const params = [rutNorm(rut)];
    let where = `rut_cliente_norm = $1`;
    if (req.query.desde) { params.push(req.query.desde); where += ` AND fecha >= $${params.length}`; }
    if (req.query.hasta) { params.push(req.query.hasta); where += ` AND fecha <= $${params.length}`; }
    const { rows: movimientos } = await query(
      `SELECT descripcion, tipo, cantidad, precio_unitario, co2e_unitario, fecha, origen
       FROM inventario_movimientos WHERE ${where} ORDER BY fecha, created_at`, params
    );
    res.json({ rut, ...valorizar(movimientos, metodo), n_movimientos: movimientos.length });
  } catch (err) { next(err); }
});

// ---------- POST /movimientos — entrada/salida manual ----------
router.post('/movimientos', adminOnly, async (req, res, next) => {
  try {
    const { rut, descripcion, fecha, tipo, cantidad, precio_unitario, co2e_unitario } = req.body;
    if (!rut || !descripcion || !Number(cantidad)) {
      return res.status(400).json({ error: 'RUT, descripción y cantidad son obligatorios.' });
    }
    const t = tipo === 'salida' ? 'salida' : 'entrada';
    const { rows } = await query(
      `INSERT INTO inventario_movimientos
         (rut_cliente_norm, descripcion, fecha, tipo, cantidad, precio_unitario, co2e_unitario, origen)
       VALUES ($1,$2,COALESCE($3::date, CURRENT_DATE),$4,$5,$6,$7,'manual') RETURNING *`,
      [rutNorm(rut), descripcion, fecha || null, t, Number(cantidad),
       t === 'entrada' ? Number(precio_unitario) || 0 : 0,
       t === 'entrada' ? Number(co2e_unitario) || 0 : 0]
    );
    await logActividad({ usuarioId: req.user.sub, accion: 'inventario_manual', entidad: 'inventario', entidadId: rows[0].id, ip: req.ip });
    res.status(201).json({ movimiento: rows[0] });
  } catch (err) { next(err); }
});

export default router;
