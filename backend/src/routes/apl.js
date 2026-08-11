import express from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole, requireHomePanel, logActividad } from '../middleware/auth.js';
import {
  validarAcuerdo, validarMeta, evidenciaDisponible, resumenMetas,
} from '../services/apl.js';
import { generateInformeApl } from '../services/pdf.js';

// ============================================================
// Acuerdos de Producción Limpia — /api/admin/apl
// Registro interno de seguimiento del APL de cada cliente. La
// certificación de cumplimiento la otorga la auditoría del sistema
// APL, no esta plataforma: acá solo se registra y se respalda.
// ============================================================

const router = express.Router();
// Todo el módulo (incluidas las lecturas) es de admin/operador: las
// cuentas de portal con rol 'cliente' comparten el panel 'sicrep' y no
// deben ver los APL de otros clientes.
router.use(requireAuth, requireHomePanel('sicrep'), requireRole('admin', 'operador'));


// ---------- Listado de acuerdos (con cliente y avance) ----------
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT a.*, c.nombre_empresa, c.rut AS cliente_rut,
              (SELECT COUNT(*)::int FROM apl_metas m WHERE m.acuerdo_id = a.id) AS metas_total,
              (SELECT COUNT(*)::int FROM apl_metas m WHERE m.acuerdo_id = a.id AND m.estado = 'cumplida') AS metas_cumplidas
         FROM apl_acuerdos a
         JOIN clientes c ON c.id = a.cliente_id
        ORDER BY a.created_at DESC`
    );
    res.json({ acuerdos: rows });
  } catch (err) { next(err); }
});

// ---------- Crear acuerdo ----------
router.post('/', async (req, res, next) => {
  try {
    const { cliente_id, nombre, sector, fecha_adhesion, plazo_meses, estado, notas } = req.body || {};
    if (!cliente_id) return res.status(400).json({ error: 'Falta cliente_id.' });
    const v = validarAcuerdo(req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const { rows: [acuerdo] } = await query(
      `INSERT INTO apl_acuerdos (cliente_id, nombre, sector, fecha_adhesion, plazo_meses, estado, notas)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,'adherido'),$7) RETURNING *`,
      [cliente_id, nombre.trim(), sector || null, fecha_adhesion || null,
        plazo_meses ? Number(plazo_meses) : null, estado || null, notas || null]
    );
    await logActividad({ usuarioId: req.user.sub, accion: 'apl_crear', entidad: 'apl_acuerdo', entidadId: acuerdo.id, ip: req.ip });
    res.status(201).json({ acuerdo });
  } catch (err) {
    if (err.code === '23503') return res.status(400).json({ error: 'El cliente indicado no existe.' });
    next(err);
  }
});

// ---------- Detalle: acuerdo + metas + evidencia disponible ----------
router.get('/:id', async (req, res, next) => {
  try {
    const { rows: [acuerdo] } = await query(
      `SELECT a.*, c.nombre_empresa, c.rut AS cliente_rut
         FROM apl_acuerdos a JOIN clientes c ON c.id = a.cliente_id
        WHERE a.id = $1`,
      [req.params.id]
    );
    if (!acuerdo) return res.status(404).json({ error: 'Acuerdo no encontrado.' });
    const { rows: metas } = await query(
      `SELECT * FROM apl_metas WHERE acuerdo_id = $1 ORDER BY created_at`,
      [acuerdo.id]
    );
    res.json({
      acuerdo,
      metas,
      resumen: await resumenMetas(acuerdo.id),
      evidencia_disponible: await evidenciaDisponible(acuerdo.cliente_rut),
    });
  } catch (err) { next(err); }
});

// ---------- Editar acuerdo ----------
router.put('/:id', async (req, res, next) => {
  try {
    const { nombre, sector, fecha_adhesion, plazo_meses, estado, notas } = req.body || {};
    const v = validarAcuerdo({ nombre: nombre ?? 'x', sector, fecha_adhesion, plazo_meses, estado, notas });
    if (!v.ok) return res.status(400).json({ error: v.error });
    const { rows: [acuerdo] } = await query(
      `UPDATE apl_acuerdos SET
         nombre = COALESCE($2, nombre),
         sector = COALESCE($3, sector),
         fecha_adhesion = COALESCE($4, fecha_adhesion),
         plazo_meses = COALESCE($5, plazo_meses),
         estado = COALESCE($6, estado),
         notas = COALESCE($7, notas),
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [req.params.id, nombre ? nombre.trim() : null, sector ?? null, fecha_adhesion || null,
        plazo_meses ? Number(plazo_meses) : null, estado || null, notas ?? null]
    );
    if (!acuerdo) return res.status(404).json({ error: 'Acuerdo no encontrado.' });
    await logActividad({ usuarioId: req.user.sub, accion: 'apl_editar', entidad: 'apl_acuerdo', entidadId: acuerdo.id, detalle: { estado: acuerdo.estado }, ip: req.ip });
    res.json({ acuerdo });
  } catch (err) { next(err); }
});

// ---------- Agregar meta ----------
router.post('/:id/metas', async (req, res, next) => {
  try {
    const v = validarMeta(req.body || {});
    if (!v.ok) return res.status(400).json({ error: v.error });
    const { descripcion, numero, tipo, estado, fuente_evidencia, evidencia } = req.body;
    const { rows: [meta] } = await query(
      `INSERT INTO apl_metas (acuerdo_id, numero, descripcion, tipo, estado, fuente_evidencia, evidencia)
       VALUES ($1,$2,$3,COALESCE($4,'otro'),COALESCE($5,'pendiente'),$6,$7) RETURNING *`,
      [req.params.id, numero || null, descripcion.trim(), tipo || null, estado || null,
        fuente_evidencia || null, evidencia || null]
    );
    await logActividad({ usuarioId: req.user.sub, accion: 'apl_meta_crear', entidad: 'apl_meta', entidadId: meta.id, ip: req.ip });
    res.status(201).json({ meta });
  } catch (err) {
    if (err.code === '23503') return res.status(404).json({ error: 'Acuerdo no encontrado.' });
    next(err);
  }
});

// ---------- Editar meta (avance / evidencia) ----------
router.put('/metas/:metaId', async (req, res, next) => {
  try {
    const { descripcion, numero, tipo, estado, fuente_evidencia, evidencia } = req.body || {};
    const v = validarMeta({ descripcion: descripcion ?? 'x', numero, tipo, estado, fuente_evidencia, evidencia });
    if (!v.ok) return res.status(400).json({ error: v.error });
    const { rows: [meta] } = await query(
      `UPDATE apl_metas SET
         descripcion = COALESCE($2, descripcion),
         numero = COALESCE($3, numero),
         tipo = COALESCE($4, tipo),
         estado = COALESCE($5, estado),
         fuente_evidencia = COALESCE($6, fuente_evidencia),
         evidencia = COALESCE($7, evidencia),
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [req.params.metaId, descripcion ? descripcion.trim() : null, numero ?? null,
        tipo || null, estado || null, fuente_evidencia || null, evidencia ?? null]
    );
    if (!meta) return res.status(404).json({ error: 'Meta no encontrada.' });
    await logActividad({ usuarioId: req.user.sub, accion: 'apl_meta_editar', entidad: 'apl_meta', entidadId: meta.id, detalle: { estado: meta.estado }, ip: req.ip });
    res.json({ meta });
  } catch (err) { next(err); }
});

// ---------- Eliminar meta ----------
router.delete('/metas/:metaId', async (req, res, next) => {
  try {
    const { rowCount } = await query('DELETE FROM apl_metas WHERE id = $1', [req.params.metaId]);
    if (!rowCount) return res.status(404).json({ error: 'Meta no encontrada.' });
    await logActividad({ usuarioId: req.user.sub, accion: 'apl_meta_eliminar', entidad: 'apl_meta', entidadId: req.params.metaId, ip: req.ip });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------- Informe PDF de estado de avance ----------
router.get('/:id/informe.pdf', async (req, res, next) => {
  try {
    const { rows: [acuerdo] } = await query(
      `SELECT a.*, c.nombre_empresa, c.rut AS cliente_rut
         FROM apl_acuerdos a JOIN clientes c ON c.id = a.cliente_id
        WHERE a.id = $1`,
      [req.params.id]
    );
    if (!acuerdo) return res.status(404).json({ error: 'Acuerdo no encontrado.' });
    const { rows: metas } = await query(
      `SELECT * FROM apl_metas WHERE acuerdo_id = $1 ORDER BY created_at`,
      [acuerdo.id]
    );
    const pdf = await generateInformeApl({
      acuerdo,
      metas,
      resumen: await resumenMetas(acuerdo.id),
      evidencia: await evidenciaDisponible(acuerdo.cliente_rut),
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="apl-avance-${acuerdo.id.slice(0, 8)}.pdf"`);
    res.send(pdf);
  } catch (err) { next(err); }
});

export default router;
