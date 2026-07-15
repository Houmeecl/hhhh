import express from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole, logActividad } from '../middleware/auth.js';

// ============================================================
// Motor propio de cálculo — administración de categorías
// (factores, palabras clave) y estadística de uso propio/externo.
// El cálculo en sí vive en services/motorPropio.js y se aplica
// automáticamente en routes/public.js al subir un DTE XML.
// ============================================================

const router = express.Router();
router.use(requireAuth);
const adminOnly = requireRole('admin', 'operador');

router.get('/categorias', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM motor_categorias ORDER BY codigo`);
    res.json({ categorias: rows });
  } catch (err) { next(err); }
});

router.put('/categorias/:codigo', adminOnly, async (req, res, next) => {
  try {
    const { nombre, unidad_fisica, factor_fisico_kgco2e, factor_gasto_kgco2e_clp1000, palabras_clave, fuente, activo } = req.body;
    const { rows } = await query(
      `UPDATE motor_categorias SET
         nombre = COALESCE($2,nombre),
         unidad_fisica = COALESCE($3,unidad_fisica),
         factor_fisico_kgco2e = COALESCE($4,factor_fisico_kgco2e),
         factor_gasto_kgco2e_clp1000 = COALESCE($5,factor_gasto_kgco2e_clp1000),
         palabras_clave = COALESCE($6,palabras_clave),
         fuente = COALESCE($7,fuente),
         activo = COALESCE($8,activo),
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
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Categoría no encontrada' });
    await logActividad({ usuarioId: req.user.sub, accion: 'editar_categoria_motor', entidad: 'motor_categoria', entidadId: req.params.codigo, ip: req.ip });
    res.json({ categoria: rows[0] });
  } catch (err) { next(err); }
});

router.get('/estadisticas', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT motor, COUNT(*)::int AS n FROM facturas GROUP BY motor`
    );
    const total = rows.reduce((a, r) => a + r.n, 0);
    const propio = rows.find((r) => r.motor === 'propio')?.n || 0;
    const externo = rows.find((r) => r.motor === 'externo')?.n || 0;
    res.json({
      total,
      propio,
      externo,
      porcentaje_propio: total > 0 ? Math.round((propio / total) * 1000) / 10 : 0,
    });
  } catch (err) { next(err); }
});

export default router;
