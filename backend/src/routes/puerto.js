import express from 'express';
import { query } from '../lib/db.js';
import { hashApiKey } from '../services/mandante.js';
import { logActividad } from '../middleware/auth.js';
import { bigquery } from '../services/bigquery.js';
import { filtrarPorVisibilidad } from '../services/pasaporteOrigen.js';
import { verificarCadenaCompleta } from '../services/cadenaHash.js';

// ============================================================
// API pública para PUERTOS (auth por header X-Api-Key, migración 040).
// A diferencia de mandante.js (acceso por RUT receptor sobre facturas
// nacionales), un puerto ve el tránsito del Corredor Bioceánico que pasa
// por SU punto (lotes tipo 'documental' con al menos un eslabón cuyo
// datos.punto_id coincide) — es un dominio distinto, no una extensión
// del modelo de mandantes.
// ============================================================

const router = express.Router();

async function requirePuerto(req, res, next) {
  try {
    const key = req.headers['x-api-key'];
    if (!key) return res.status(401).json({ error: 'Falta el header X-Api-Key.' });
    const { rows } = await query(`SELECT * FROM puertos WHERE token_hash = $1`, [hashApiKey(key)]);
    const p = rows[0];
    if (!p || !p.activo) return res.status(401).json({ error: 'API key inválida o inactiva.' });
    await query(`UPDATE puertos SET ultimo_uso = now() WHERE id = $1`, [p.id]);
    req.puerto = p;
    next();
  } catch (err) { next(err); }
}
router.use(requirePuerto);

// ---------- GET /api/puerto/transitos — lotes documentales que pasan por mi punto ----------
router.get('/transitos', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT DISTINCT l.id, l.codigo, l.tipo, l.material, l.estado, l.n_eslabones, l.updated_at
       FROM lotes_minerales l
       JOIN lote_eslabones e ON e.lote_id = l.id
       WHERE l.tipo = 'documental' AND e.datos->>'punto_id' = $1
       ORDER BY l.updated_at DESC LIMIT 200`,
      [req.puerto.punto_id]
    );
    res.json({ puerto: { nombre: req.puerto.nombre, punto_id: req.puerto.punto_id }, transitos: rows });

    const detalle = { punto_id: req.puerto.punto_id, n_transitos: rows.length };
    logActividad({ usuarioId: null, accion: 'consulta_transitos_puerto', entidad: 'puerto', entidadId: req.puerto.id, detalle, ip: req.ip });
    bigquery.exportAcceso({ tipo: 'consulta_transitos_puerto', actor: { tipo: 'puerto', id: req.puerto.id }, detalle });
  } catch (err) { next(err); }
});

// ---------- GET /api/puerto/transitos/:codigo — detalle completo (solo si pasa por mi punto) ----------
router.get('/transitos/:codigo', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM lotes_minerales WHERE codigo = $1 AND tipo = 'documental'`,
      [req.params.codigo]
    );
    const lote = rows[0];
    if (!lote) return res.status(404).json({ error: 'Tránsito no encontrado.' });

    const { rows: eslabones } = await query(
      `SELECT * FROM lote_eslabones WHERE lote_id = $1 ORDER BY eslabon`, [lote.id]
    );
    const pasaPorMiPunto = eslabones.some((e) => e.datos?.punto_id === req.puerto.punto_id);
    if (!pasaPorMiPunto) return res.status(403).json({ error: 'Este tránsito no pasa por tu punto.' });

    res.json({
      lote,
      eslabones: filtrarPorVisibilidad(eslabones, 'cadena'),
      integridad: verificarCadenaCompleta(eslabones),
    });

    const detalle = { punto_id: req.puerto.punto_id, codigo: lote.codigo };
    logActividad({ usuarioId: null, accion: 'consulta_transito_puerto', entidad: 'puerto', entidadId: req.puerto.id, detalle, ip: req.ip });
    bigquery.exportAcceso({ tipo: 'consulta_transito_puerto', actor: { tipo: 'puerto', id: req.puerto.id }, detalle });
  } catch (err) { next(err); }
});

export default router;
