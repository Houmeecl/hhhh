import express from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole, logActividad } from '../middleware/auth.js';

// ============================================================
// Motor propio de cálculo — administración de categorías
// (factores, palabras clave) y estadística de uso propio/externo.
// El cálculo en sí vive en services/motorPropio.js y se aplica
// automáticamente en routes/public.js al subir un DTE XML (motor
// 'propio'), un PDF con capa de texto ('propio_texto') o una imagen
// JPG/PNG con OCR local ('propio_ocr').
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
    const externo = n('externo');
    // "Propio" para el % de independencia = XML + texto de PDF + OCR.
    const propioTotal = propio + propio_texto + propio_ocr;
    res.json({
      total,
      propio,
      propio_texto,
      propio_ocr,
      externo,
      porcentaje_propio: total > 0 ? Math.round((propioTotal / total) * 1000) / 10 : 0,
    });
  } catch (err) { next(err); }
});

export default router;
