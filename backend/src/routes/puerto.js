import express from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../lib/db.js';
import { hashApiKey } from '../services/mandante.js';
import { logActividad } from '../middleware/auth.js';
import { bigquery } from '../services/bigquery.js';
import { filtrarPorVisibilidad, filtrarDocumentosPorVisibilidad, semaforoDocumental } from '../services/pasaporteOrigen.js';
import { verificarCadenaCompleta } from '../services/cadenaHash.js';

// ============================================================
// API para PUERTOS — dos caminos de acceso a los MISMOS datos:
//  1) X-Api-Key (migración 040): integración de sistemas externos.
//  2) Sesión (Bearer JWT, panel='puerto', migración 042): el operador
//     humano del puerto entra por /panel-puerto/login con su propia
//     cuenta (email+contraseña), atada a esta MISMA fila de `puertos`
//     vía usuarios.puerto_id — nunca ve datos de otro puerto.
// A diferencia de mandante.js (acceso por RUT receptor sobre facturas
// nacionales), un puerto ve el tránsito del Corredor Bioceánico que pasa
// por SU punto (lotes tipo 'documental' con al menos un eslabón cuyo
// datos.punto_id coincide) — es un dominio distinto, no una extensión
// del modelo de mandantes.
// ============================================================

const router = express.Router();

async function requirePuerto(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
      let payload;
      try {
        payload = jwt.verify(authHeader.slice(7), config.jwt.accessSecret);
      } catch {
        return res.status(401).json({ error: 'Sesión expirada o inválida.' });
      }
      if (payload.panel !== 'puerto' || !payload.puerto_id) {
        return res.status(403).json({ error: 'Esta cuenta no tiene acceso al panel de puerto.' });
      }
      const { rows } = await query(`SELECT * FROM puertos WHERE id = $1`, [payload.puerto_id]);
      const p = rows[0];
      if (!p || !p.activo) return res.status(401).json({ error: 'Puerto inactivo.' });
      req.puerto = p;
      return next();
    }
    const key = req.headers['x-api-key'];
    if (!key) return res.status(401).json({ error: 'Falta el header X-Api-Key o una sesión.' });
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

    const { rows: documentos } = await query(
      `SELECT id, tipo_documento, estado, visibilidad, archivo_original, extension, tamano_bytes,
              sha256, hash_documento, hash_anterior, hash_cadena, created_at
       FROM lote_documentos WHERE lote_id = $1 ORDER BY created_at DESC`,
      [lote.id]
    );

    res.json({
      lote,
      eslabones: filtrarPorVisibilidad(eslabones, 'cadena'),
      documentos: filtrarDocumentosPorVisibilidad(documentos.filter((d) => d.estado === 'leido'), 'cadena'),
      semaforo: semaforoDocumental(lote, documentos),
      integridad: verificarCadenaCompleta(eslabones),
    });

    const detalle = { punto_id: req.puerto.punto_id, codigo: lote.codigo };
    logActividad({ usuarioId: null, accion: 'consulta_transito_puerto', entidad: 'puerto', entidadId: req.puerto.id, detalle, ip: req.ip });
    bigquery.exportAcceso({ tipo: 'consulta_transito_puerto', actor: { tipo: 'puerto', id: req.puerto.id }, detalle });
  } catch (err) { next(err); }
});

export default router;
