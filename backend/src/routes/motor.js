import express from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole, requireHomePanel, logActividad } from '../middleware/auth.js';
import { config } from '../config.js';

// ============================================================
// Motor propio de cálculo — administración de categorías
// (factores, palabras clave) y estadística de uso propio/externo.
// El cálculo en sí vive en services/motorPropio.js y se aplica
// automáticamente en routes/public.js al subir un DTE XML (motor
// 'propio'), un PDF con capa de texto ('propio_texto') o una imagen
// JPG/PNG con OCR local ('propio_ocr').
// ============================================================

const router = express.Router();
router.use(requireAuth, requireHomePanel('sicrep'));
const adminOnly = requireRole('admin', 'operador');

router.get('/categorias', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM motor_categorias ORDER BY codigo`);
    res.json({ categorias: rows });
  } catch (err) { next(err); }
});

router.put('/categorias/:codigo', adminOnly, async (req, res, next) => {
  try {
    const { nombre, unidad_fisica, factor_fisico_kgco2e, factor_gasto_kgco2e_clp1000, palabras_clave, fuente, activo, alcance_ghg } = req.body;
    const { rows } = await query(
      `UPDATE motor_categorias SET
         nombre = COALESCE($2,nombre),
         unidad_fisica = COALESCE($3,unidad_fisica),
         factor_fisico_kgco2e = COALESCE($4,factor_fisico_kgco2e),
         factor_gasto_kgco2e_clp1000 = COALESCE($5,factor_gasto_kgco2e_clp1000),
         palabras_clave = COALESCE($6,palabras_clave),
         fuente = COALESCE($7,fuente),
         activo = COALESCE($8,activo),
         alcance_ghg = COALESCE($9,alcance_ghg),
         updated_at = now()
       WHERE codigo = $1 RETURNING *`,
      [
        req.params.codigo,
        nombre,
        unidad_fisica,
        factor_fisico_kgco2e != null ? Number(factor_fisico_kgco2e) : null,
        factor_gasto_kgco2e_clp1000 != null ? Number(factor_gasto_kgco2e_clp1000) : null,
        Array.isArray(palabras_clave) ? palabras_clave : null,
        fuente,
        activo != null ? Boolean(activo) : null,
        alcance_ghg != null ? String(alcance_ghg) : null,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Categoría no encontrada' });
    await logActividad({ usuarioId: req.user.sub, accion: 'editar_categoria_motor', entidad: 'motor_categoria', entidadId: req.params.codigo, ip: req.ip });
    res.json({ categoria: rows[0] });
  } catch (err) { next(err); }
});

// ---------- Fuentes metodológicas (migración 018) ----------
// Registro citable de los documentos que avalan la METODOLOGÍA (IPCC,
// GHG Protocol, DEFRA, MMA, CEN, GLEC). Honestidad: avalan el método,
// no a sicr3p — nada aquí es un "certificado". Defensivo: si la tabla
// aún no existe (migración sin correr), la lista vuelve vacía en vez
// de romper el panel.
const ESTADOS_FUENTE = ['avalada_referencial', 'validada_oficial'];

router.get('/fuentes', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT f.*, COUNT(mc.codigo)::int AS n_categorias
       FROM fuentes_metodologicas f
       LEFT JOIN motor_categorias mc ON mc.fuente_metodologica_id = f.id
       GROUP BY f.id
       ORDER BY f.organismo, f.codigo`
    );
    res.json({ fuentes: rows });
  } catch (err) {
    if (err.code === '42P01') return res.json({ fuentes: [] }); // tabla aún no migrada
    next(err);
  }
});

// Edita lo administrable de una fuente: url, año/edición, notas y estado.
// 'validada_oficial' SOLO cuando el admin tiene descargada la edición
// vigente del documento; organismo/documento/código no se editan por API
// (son la identidad citable de la fuente).
router.put('/fuentes/:id', adminOnly, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(404).json({ error: 'Fuente no encontrada' });
    }
    const { url, version_anio, estado, notas } = req.body;
    if (estado != null && !ESTADOS_FUENTE.includes(estado)) {
      return res.status(400).json({ error: "El estado debe ser 'avalada_referencial' o 'validada_oficial'." });
    }
    const { rows } = await query(
      `UPDATE fuentes_metodologicas SET
         url = COALESCE($2,url),
         version_anio = COALESCE($3,version_anio),
         estado = COALESCE($4,estado),
         notas = COALESCE($5,notas)
       WHERE id = $1 RETURNING *`,
      [
        id,
        url != null ? String(url).trim() : null,
        version_anio != null ? String(version_anio).trim() : null,
        estado != null ? String(estado) : null,
        notas != null ? String(notas) : null,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Fuente no encontrada' });
    await logActividad({ usuarioId: req.user.sub, accion: 'editar_fuente_metodologica', entidad: 'fuente_metodologica', entidadId: String(id), ip: req.ip });
    res.json({ fuente: rows[0] });
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(503).json({ error: 'El registro de fuentes metodológicas aún no está disponible.' });
    }
    next(err);
  }
});

router.get('/estadisticas', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT motor, COUNT(*)::int AS n FROM facturas GROUP BY motor`
    );
    const total = rows.reduce((a, r) => a + r.n, 0);
    const n = (motor) => rows.find((r) => r.motor === motor)?.n || 0;
    const propio = n('propio');
    const propio_texto = n('propio_texto');
    const propio_ocr = n('propio_ocr');
    const propio_ia = n('propio_ia');
    const propio_revisado = n('propio_revisado');
    const revision = n('revision');
    const externo = n('externo');
    // "Propio" para el % de independencia = XML + texto de PDF + OCR + IA
    // (+ conteos históricos de la revisión, hoy eliminada).
    const propioTotal = propio + propio_texto + propio_ocr + propio_ia + propio_revisado;

    // Bitácora de rechazos (migración 030) — documentos ilegibles que
    // nunca llegaron a ser factura. Defensivo si la migración no corrió.
    let rechazadosTotal = 0;
    let rechazados30d = 0;
    const rechazosPorMotivo = {};
    const rechazosPorEtapa = {};
    try {
      const { rows: rRows } = await query(
        `SELECT motivo, etapa_alcanzada,
                COUNT(*)::int AS n,
                COUNT(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS n30
         FROM documentos_rechazados GROUP BY motivo, etapa_alcanzada`
      );
      for (const r of rRows) {
        rechazadosTotal += r.n;
        rechazados30d += r.n30;
        rechazosPorMotivo[r.motivo] = (rechazosPorMotivo[r.motivo] || 0) + r.n;
        rechazosPorEtapa[r.etapa_alcanzada] = (rechazosPorEtapa[r.etapa_alcanzada] || 0) + r.n;
      }
    } catch (err) {
      if (err.code !== '42P01') throw err; // tabla aún no migrada → todo en 0
    }

    // Análisis con IA (migración 033) — llamadas, éxito, latencia y costo
    // estimado, para transparencia del admin. Defensivo si aún no migró.
    let ia = { llamadas_30d: 0, exitosas_30d: 0, latencia_prom_ms: null, costo_estimado_clp_30d: 0 };
    try {
      const { rows: iaRows } = await query(
        `SELECT COUNT(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS llamadas,
                COUNT(*) FILTER (WHERE exito AND created_at > now() - interval '30 days')::int AS exitosas,
                COALESCE(AVG(latencia_ms) FILTER (WHERE created_at > now() - interval '30 days'), 0)::int AS latencia_prom,
                COALESCE(SUM(costo_estimado_clp) FILTER (WHERE created_at > now() - interval '30 days'), 0)::numeric AS costo
         FROM analisis_ia_uso`
      );
      const r = iaRows[0];
      ia = {
        llamadas_30d: r.llamadas,
        exitosas_30d: r.exitosas,
        latencia_prom_ms: r.llamadas > 0 ? r.latencia_prom : null,
        costo_estimado_clp_30d: Number(r.costo),
      };
    } catch (err) {
      if (err.code !== '42P01') throw err; // tabla aún no migrada → todo en 0
    }

    res.json({
      total,
      propio,
      propio_texto,
      propio_ocr,
      propio_ia,
      propio_revisado,
      revision,
      externo,
      motor_externo_activo: String(process.env.MOTOR_EXTERNO || 'on').toLowerCase() !== 'off',
      analisis_ia_activo: config.analisisIA.enabled,
      analisis_ia: ia,
      porcentaje_propio: total > 0 ? Math.round((propioTotal / total) * 1000) / 10 : 0,
      rechazados_total: rechazadosTotal,
      rechazados_30d: rechazados30d,
      rechazos_por_motivo: rechazosPorMotivo,
      rechazos_por_etapa: rechazosPorEtapa,
      tasa_rechazo: (rechazadosTotal + total) > 0
        ? Math.round((rechazadosTotal / (rechazadosTotal + total)) * 1000) / 10
        : 0,
    });
  } catch (err) { next(err); }
});

export default router;
