import express from 'express';
import { query } from '../lib/db.js';
import { hashApiKey, normalizarRut } from '../services/mandante.js';

// ============================================================
// API pública para MANDANTES (auth por header X-Api-Key).
// Una empresa mandante consulta la trazabilidad y CO2e que sus
// proveedores le han emitido. Solo ve relaciones donde ella es
// la receptora de los documentos.
// ============================================================

const router = express.Router();
const rutNorm = normalizarRut;
const NORM = (col) => `regexp_replace(COALESCE(${col},''), '[^0-9kK]', '', 'g')`;

// Autenticación por API key.
async function requireMandante(req, res, next) {
  try {
    const key = req.headers['x-api-key'];
    if (!key) return res.status(401).json({ error: 'Falta el header X-Api-Key.' });
    const { rows } = await query(`SELECT * FROM mandantes WHERE token_hash = $1`, [hashApiKey(key)]);
    const m = rows[0];
    if (!m || !m.activo) return res.status(401).json({ error: 'API key inválida o inactiva.' });
    await query(`UPDATE mandantes SET ultimo_uso = now() WHERE id = $1`, [m.id]);
    req.mandante = m;
    next();
  } catch (err) { next(err); }
}
router.use(requireMandante);

// ---------- GET /api/mandante/proveedores ----------
// Proveedores que emiten documentos al RUT del mandante, con totales.
router.get('/proveedores', async (req, res, next) => {
  try {
    const rn = rutNorm(req.mandante.rut);
    const { rows } = await query(
      `SELECT ${NORM('f.rut_emisor')} AS rut_proveedor,
              COUNT(*)::int AS n_documentos,
              SUM(f.total_co2e)::float AS total_co2e,
              MAX(f.created_at) AS ultimo_documento,
              array_agg(DISTINCT f.categoria) AS categorias
       FROM facturas f
       WHERE ${NORM('f.rut_receptor')} = $1 AND f.rut_emisor IS NOT NULL
       GROUP BY 1 ORDER BY total_co2e DESC NULLS LAST LIMIT 200`, [rn]
    );
    res.json({ mandante: { rut: req.mandante.rut, empresa: req.mandante.nombre_empresa }, proveedores: rows });
  } catch (err) { next(err); }
});

// ---------- GET /api/mandante/proveedor/:rut/resumen?anio=&mes= ----------
router.get('/proveedor/:rut/resumen', async (req, res, next) => {
  try {
    const rnMandante = rutNorm(req.mandante.rut);
    const rnProv = rutNorm(req.params.rut);
    const cond = [`${NORM('f.rut_receptor')} = $1`, `${NORM('f.rut_emisor')} = $2`];
    const params = [rnMandante, rnProv];
    if (req.query.anio) { params.push(Number(req.query.anio)); cond.push(`EXTRACT(YEAR FROM f.created_at) = $${params.length}`); }
    if (req.query.mes) { params.push(Number(req.query.mes)); cond.push(`EXTRACT(MONTH FROM f.created_at) = $${params.length}`); }

    const { rows: docs } = await query(
      `SELECT f.numero_venta, f.categoria, f.total_co2e, f.created_at
       FROM facturas f WHERE ${cond.join(' AND ')} ORDER BY f.created_at DESC LIMIT 200`, params
    );
    const porCategoria = {};
    let total = 0;
    for (const d of docs) {
      total += Number(d.total_co2e || 0);
      const c = d.categoria || 'Sin categoría';
      porCategoria[c] = (porCategoria[c] || 0) + Number(d.total_co2e || 0);
    }
    res.json({
      proveedor: req.params.rut,
      periodo: { anio: req.query.anio || 'todos', mes: req.query.mes || 'todos' },
      n_documentos: docs.length,
      total_co2e: Math.round(total * 10000) / 10000,
      por_categoria: porCategoria,
      documentos: docs,
    });
  } catch (err) { next(err); }
});

export default router;
