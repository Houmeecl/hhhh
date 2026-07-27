import express from 'express';
import { query } from '../lib/db.js';
import { hashApiKey, normalizarRut } from '../services/mandante.js';
import { logActividad } from '../middleware/auth.js';
import { bigquery } from '../services/bigquery.js';
import { agregarAlcance3, CITA_CATEGORIAS_ALCANCE3 } from '../services/alcanceGhg.js';
import { filasACsv } from '../services/csv.js';

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

// Lista blanca opcional de RUT proveedor para este mandante (vacía = sin restricción).
async function proveedoresPermitidos(mandanteId) {
  const { rows } = await query(
    `SELECT rut_proveedor FROM mandante_proveedores WHERE mandante_id = $1 AND activo = true`,
    [mandanteId]
  );
  return rows.map((r) => r.rut_proveedor);
}

// ---------- GET /api/mandante/proveedores ----------
// Proveedores que emiten documentos al RUT del mandante, con totales.
// Si el mandante tiene permisos finos configurados, se filtra a esa lista.
router.get('/proveedores', async (req, res, next) => {
  try {
    const rn = rutNorm(req.mandante.rut);
    const permitidos = await proveedoresPermitidos(req.mandante.id);
    const params = [rn];
    let filtroPermitidos = '';
    if (permitidos.length) {
      params.push(permitidos);
      filtroPermitidos = ` AND ${NORM('f.rut_emisor')} = ANY($${params.length})`;
    }
    const { rows } = await query(
      `SELECT ${NORM('f.rut_emisor')} AS rut_proveedor,
              COUNT(*)::int AS n_documentos,
              SUM(f.total_co2e)::float AS total_co2e,
              MAX(f.created_at) AS ultimo_documento,
              array_agg(DISTINCT f.categoria) AS categorias
       FROM facturas f
       WHERE ${NORM('f.rut_receptor')} = $1 AND f.rut_emisor IS NOT NULL${filtroPermitidos}
       GROUP BY 1 ORDER BY total_co2e DESC NULLS LAST LIMIT 200`, params
    );
    res.json({ mandante: { rut: req.mandante.rut, empresa: req.mandante.nombre_empresa }, proveedores: rows });

    // Auditoría del cruce: el mandante ve datos de terceros (sus
    // proveedores) — no es un usuario de `usuarios`, así que queda sin
    // usuarioId, identificado por entidad/entidadId.
    const detalle = { rut_mandante: req.mandante.rut, n_proveedores: rows.length };
    logActividad({
      usuarioId: null, accion: 'consulta_proveedores_mandante',
      entidad: 'mandante', entidadId: req.mandante.id, detalle, ip: req.ip,
    });
    bigquery.exportAcceso({ tipo: 'consulta_proveedores_mandante', actor: { tipo: 'mandante', id: req.mandante.id }, rut_consultado: req.mandante.rut, detalle });
  } catch (err) { next(err); }
});

// ---------- GET /api/mandante/proveedor/:rut/resumen?anio=&mes= ----------
router.get('/proveedor/:rut/resumen', async (req, res, next) => {
  try {
    const rnMandante = rutNorm(req.mandante.rut);
    const rnProv = rutNorm(req.params.rut);
    const permitidos = await proveedoresPermitidos(req.mandante.id);
    if (permitidos.length && !permitidos.includes(rnProv)) {
      return res.status(403).json({ error: 'No tienes acceso a este proveedor.' });
    }
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

    {
      const detalle = { rut_mandante: req.mandante.rut, rut_proveedor: req.params.rut, n_documentos: docs.length };
      logActividad({
        usuarioId: null, accion: 'consulta_proveedor_mandante',
        entidad: 'mandante', entidadId: req.mandante.id, detalle, ip: req.ip,
      });
      bigquery.exportAcceso({ tipo: 'consulta_proveedor_mandante', actor: { tipo: 'mandante', id: req.mandante.id }, rut_consultado: req.params.rut, detalle });
    }
  } catch (err) { next(err); }
});

// ---------- GET /api/mandante/export/alcance3?anio=&formato=csv|json ----------
// Export de Alcance 3 (ISSB IFRS S2 / NCG 461 de la CMF) agregado por
// proveedor y categoría GHG Protocol (1-15), para que el mandante lo
// pegue en su memoria anual. Sin LIMIT: a diferencia de /proveedores
// (vista rápida), este es un export contable de cierre — truncar en
// silencio produciría una cifra de Alcance 3 incompleta.
router.get('/export/alcance3', async (req, res, next) => {
  try {
    const rn = rutNorm(req.mandante.rut);
    const permitidos = await proveedoresPermitidos(req.mandante.id);
    const params = [rn];
    const cond = [`${NORM('f.rut_receptor')} = $1`, `f.rut_emisor IS NOT NULL`, `mc.alcance_ghg LIKE 'Alcance 3%'`];
    if (permitidos.length) {
      params.push(permitidos);
      cond.push(`${NORM('f.rut_emisor')} = ANY($${params.length})`);
    }
    if (req.query.anio) {
      params.push(Number(req.query.anio));
      cond.push(`EXTRACT(YEAR FROM f.created_at) = $${params.length}`);
    }

    const { rows } = await query(
      `SELECT ${NORM('f.rut_emisor')} AS rut_proveedor,
              mc.alcance_ghg, f.total_co2e,
              fm.organismo, fm.documento, fm.version_anio
         FROM facturas f
         JOIN motor_categorias mc ON mc.nombre = f.categoria
         LEFT JOIN fuentes_metodologicas fm ON fm.id = mc.fuente_metodologica_id
        WHERE ${cond.join(' AND ')}`,
      params
    );

    const filas = agregarAlcance3(rows);
    const anio = req.query.anio || 'todos';

    if (req.query.formato === 'csv') {
      const headers = ['rut_proveedor', 'categoria_numero', 'categoria_nombre_ghg_protocol', 'descripcion_motor', 'n_documentos', 'total_tco2e', 'fuente_factor'];
      const csv = filasACsv(headers, filas.map((f) => ({
        rut_proveedor: f.rut_proveedor,
        categoria_numero: f.categoria_numero ?? '',
        categoria_nombre_ghg_protocol: f.categoria_nombre ?? '',
        descripcion_motor: f.descripcion_motor,
        n_documentos: f.n_documentos,
        total_tco2e: f.total_tco2e.toFixed(4),
        fuente_factor: f.fuente_factor,
      })));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="alcance3_${rn}_${anio}.csv"`);
      res.send('\uFEFF' + csv); // BOM: Excel abre con tildes/ñ correctas
    } else {
      res.json({
        mandante: { rut: req.mandante.rut, empresa: req.mandante.nombre_empresa },
        periodo: { anio },
        metodologia: { taxonomia_categorias: CITA_CATEGORIAS_ALCANCE3 },
        filas,
      });
    }

    const detalle = { rut_mandante: req.mandante.rut, anio, n_filas: filas.length, formato: req.query.formato === 'csv' ? 'csv' : 'json' };
    logActividad({ usuarioId: null, accion: 'export_alcance3_mandante', entidad: 'mandante', entidadId: req.mandante.id, detalle, ip: req.ip });
    bigquery.exportAcceso({ tipo: 'export_alcance3_mandante', actor: { tipo: 'mandante', id: req.mandante.id }, rut_consultado: req.mandante.rut, detalle });
  } catch (err) { next(err); }
});

export default router;
