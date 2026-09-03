import express from 'express';
import { query, withTx } from '../lib/db.js';
import { requireAuth, requireRole, requireHomePanel, requireSeccion, logActividad } from '../middleware/auth.js';
import { generateBalanceContable } from '../services/pdf.js';
import { CUENTAS_BASE, ROLES_BANCARIOS, TIPOS_CUENTA, hashAsiento, perfilFinanciero, validarLineas } from '../services/contabilidad.js';

const router = express.Router();
router.use(requireAuth, requireHomePanel('sicrep'), requireSeccion('contabilidad'));
const puedeEditar = requireRole('admin', 'operador');

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clienteId = (req, res) => {
  const id = String(req.query.cliente_id || req.body?.cliente_id || '');
  if (!uuid.test(id)) { res.status(400).json({ error: 'Selecciona una empresa válida.' }); return null; }
  return id;
};

async function existeCliente(id) {
  const { rows } = await query('SELECT id, nombre_empresa, rut FROM clientes WHERE id = $1', [id]);
  return rows[0] || null;
}

async function balance(cliente_id, periodo_id) {
  const { rows } = await query(
    `SELECT c.id, c.codigo, c.nombre, c.tipo, c.rol_bancario, c.activa,
            COALESCE(SUM(l.debito),0)::numeric AS debito,
            COALESCE(SUM(l.haber),0)::numeric AS haber
       FROM contabilidad_cuentas c
       LEFT JOIN contabilidad_lineas l ON l.cuenta_id = c.id
       LEFT JOIN contabilidad_asientos a ON a.id = l.asiento_id AND a.periodo_id = $2
      WHERE c.cliente_id = $1
      GROUP BY c.id ORDER BY c.codigo`, [cliente_id, periodo_id]
  );
  return rows.map((r) => {
    const debito = Number(r.debito || 0); const haber = Number(r.haber || 0); const saldo = debito - haber;
    return { ...r, debito, haber, saldo_deudor: saldo > 0 ? saldo : 0, saldo_acreedor: saldo < 0 ? Math.abs(saldo) : 0 };
  });
}

router.get('/clientes', async (_req, res, next) => {
  try { res.json({ clientes: (await query('SELECT id, nombre_empresa, rut FROM clientes ORDER BY nombre_empresa LIMIT 500')).rows }); }
  catch (err) { next(err); }
});

router.get('/cuentas', async (req, res, next) => {
  try {
    const id = clienteId(req, res); if (!id) return;
    res.json({ cuentas: (await query('SELECT * FROM contabilidad_cuentas WHERE cliente_id=$1 ORDER BY codigo', [id])).rows });
  } catch (err) { next(err); }
});

router.post('/cuentas/base', puedeEditar, async (req, res, next) => {
  try {
    const id = clienteId(req, res); if (!id) return;
    if (!await existeCliente(id)) return res.status(404).json({ error: 'Empresa no encontrada.' });
    const { rows } = await query(
      `INSERT INTO contabilidad_cuentas (cliente_id,codigo,nombre,tipo,rol_bancario)
       SELECT $1, x.codigo, x.nombre, x.tipo, x.rol_bancario FROM unnest($2::text[], $3::text[], $4::text[], $5::text[]) AS x(codigo,nombre,tipo,rol_bancario)
       ON CONFLICT (cliente_id,codigo) DO NOTHING RETURNING *`,
      [id, CUENTAS_BASE.map((c) => c[0]), CUENTAS_BASE.map((c) => c[1]), CUENTAS_BASE.map((c) => c[2]), CUENTAS_BASE.map((c) => c[3])]
    );
    await logActividad({ usuarioId: req.user.sub, accion: 'crear_plan_cuentas_base', entidad: 'contabilidad', entidadId: id, ip: req.ip });
    res.status(201).json({ creadas: rows });
  } catch (err) { next(err); }
});

router.post('/cuentas', puedeEditar, async (req, res, next) => {
  try {
    const id = clienteId(req, res); if (!id) return;
    const { codigo, nombre, tipo, rol_bancario = 'otro' } = req.body;
    if (!codigo || !nombre || !TIPOS_CUENTA.includes(tipo) || !ROLES_BANCARIOS.includes(rol_bancario)) return res.status(400).json({ error: 'Código, nombre, tipo y rol bancario válidos son obligatorios.' });
    const { rows } = await query('INSERT INTO contabilidad_cuentas (cliente_id,codigo,nombre,tipo,rol_bancario) VALUES ($1,$2,$3,$4,$5) RETURNING *', [id, String(codigo).trim(), String(nombre).trim(), tipo, rol_bancario]);
    res.status(201).json({ cuenta: rows[0] });
  } catch (err) { if (err.code === '23505') return res.status(409).json({ error: 'Ese código ya existe para esta empresa.' }); next(err); }
});

router.get('/periodos', async (req, res, next) => {
  try { const id = clienteId(req, res); if (!id) return; res.json({ periodos: (await query('SELECT * FROM contabilidad_periodos WHERE cliente_id=$1 ORDER BY desde DESC', [id])).rows }); }
  catch (err) { next(err); }
});

router.post('/periodos', puedeEditar, async (req, res, next) => {
  try {
    const id = clienteId(req, res); if (!id) return;
    const { nombre, desde, hasta } = req.body;
    if (!nombre || !desde || !hasta) return res.status(400).json({ error: 'Nombre, fecha inicial y fecha final son obligatorios.' });
    const { rows } = await query('INSERT INTO contabilidad_periodos (cliente_id,nombre,desde,hasta,creado_por) VALUES ($1,$2,$3,$4,$5) RETURNING *', [id, String(nombre).trim(), desde, hasta, req.user.sub]);
    res.status(201).json({ periodo: rows[0] });
  } catch (err) { if (err.code === '23505') return res.status(409).json({ error: 'Ese período ya existe para la empresa.' }); next(err); }
});

router.get('/asientos', async (req, res, next) => {
  try {
    const id = clienteId(req, res); if (!id) return;
    const periodo_id = String(req.query.periodo_id || '');
    if (!uuid.test(periodo_id)) return res.status(400).json({ error: 'Selecciona un período válido.' });
    const { rows } = await query(
      `SELECT a.*, COALESCE(json_agg(json_build_object('cuenta_codigo',c.codigo,'cuenta_nombre',c.nombre,'debito',l.debito,'haber',l.haber,'glosa',l.glosa) ORDER BY l.id) FILTER (WHERE l.id IS NOT NULL),'[]') AS lineas
       FROM contabilidad_asientos a LEFT JOIN contabilidad_lineas l ON l.asiento_id=a.id LEFT JOIN contabilidad_cuentas c ON c.id=l.cuenta_id
       WHERE a.cliente_id=$1 AND a.periodo_id=$2 GROUP BY a.id ORDER BY a.fecha DESC,a.numero DESC LIMIT 200`, [id, periodo_id]
    );
    res.json({ asientos: rows });
  } catch (err) { next(err); }
});

router.post('/asientos', puedeEditar, async (req, res, next) => {
  try {
    const id = clienteId(req, res); if (!id) return;
    const { periodo_id, fecha, glosa, referencia, origen_tipo = 'manual', lineas } = req.body;
    if (!uuid.test(String(periodo_id || '')) || !fecha || !String(glosa || '').trim()) return res.status(400).json({ error: 'Período, fecha y glosa son obligatorios.' });
    if (!['manual','sii','documento','ajuste'].includes(origen_tipo)) return res.status(400).json({ error: 'Origen inválido.' });
    const validacion = validarLineas(lineas); if (!validacion.ok) return res.status(400).json({ error: validacion.error });
    const asiento = await withTx(async (db) => {
      const { rows: pRows } = await db.query('SELECT * FROM contabilidad_periodos WHERE id=$1 AND cliente_id=$2 FOR UPDATE', [periodo_id, id]);
      const periodo = pRows[0];
      if (!periodo) { const e = new Error('Período no encontrado para esta empresa.'); e.status = 404; throw e; }
      if (periodo.estado !== 'abierto') { const e = new Error('El período está cerrado. Registra el ajuste en un período abierto.'); e.status = 409; throw e; }
      if (fecha < periodo.desde || fecha > periodo.hasta) { const e = new Error('La fecha debe pertenecer al período contable.'); e.status = 400; throw e; }
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [id]);
      const ids = lineas.map((l) => l.cuenta_id);
      const { rows: cuentas } = await db.query('SELECT id FROM contabilidad_cuentas WHERE cliente_id=$1 AND activa=true AND id=ANY($2::uuid[])', [id, ids]);
      if (cuentas.length !== new Set(ids).size) { const e = new Error('Una o más cuentas no pertenecen a la empresa o están inactivas.'); e.status = 400; throw e; }
      const { rows: nRows } = await db.query('SELECT COALESCE(MAX(numero),0)+1 AS numero FROM contabilidad_asientos WHERE cliente_id=$1 AND periodo_id=$2', [id, periodo_id]);
      const numero = Number(nRows[0].numero);
      const hash = hashAsiento({ cliente_id:id, periodo_id, numero, fecha, glosa, referencia, lineas });
      const { rows: aRows } = await db.query(
        `INSERT INTO contabilidad_asientos (cliente_id,periodo_id,numero,fecha,glosa,referencia,origen_tipo,hash_asiento,creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [id,periodo_id,numero,fecha,String(glosa).trim(),referencia || null,origen_tipo,hash,req.user.sub]
      );
      for (const l of lineas) await db.query('INSERT INTO contabilidad_lineas (asiento_id,cuenta_id,glosa,debito,haber) VALUES ($1,$2,$3,$4,$5)', [aRows[0].id,l.cuenta_id,l.glosa || null,Number(l.debito || 0),Number(l.haber || 0)]);
      return aRows[0];
    });
    await logActividad({ usuarioId:req.user.sub, accion:'registrar_asiento_contable', entidad:'asiento_contable', entidadId:asiento.id, detalle:{ cliente_id:id, numero:asiento.numero }, ip:req.ip });
    res.status(201).json({ asiento });
  } catch (err) { if (err.status) return res.status(err.status).json({ error:err.message }); next(err); }
});

router.get('/balance', async (req, res, next) => {
  try {
    const id = clienteId(req, res); if (!id) return;
    const periodo_id = String(req.query.periodo_id || ''); if (!uuid.test(periodo_id)) return res.status(400).json({ error: 'Selecciona un período válido.' });
    const periodo = (await query('SELECT * FROM contabilidad_periodos WHERE id=$1 AND cliente_id=$2', [periodo_id,id])).rows[0];
    if (!periodo) return res.status(404).json({ error: 'Período no encontrado.' });
    const cuentas = await balance(id, periodo_id);
    const totales = cuentas.reduce((a,c) => ({ debito:a.debito+c.debito, haber:a.haber+c.haber, saldo_deudor:a.saldo_deudor+c.saldo_deudor, saldo_acreedor:a.saldo_acreedor+c.saldo_acreedor }), {debito:0,haber:0,saldo_deudor:0,saldo_acreedor:0});
    res.json({ periodo, cuentas, totales });
  } catch (err) { next(err); }
});

// Ficha para analista financiero. Expone ratios reproducibles y alertas de
// calidad de información; no predice default, no aprueba crédito y no reemplaza
// el análisis, política ni autorización de una institución financiera.
router.get('/riesgo', async (req, res, next) => {
  try {
    const id = clienteId(req, res); if (!id) return;
    const periodo_id = String(req.query.periodo_id || ''); if (!uuid.test(periodo_id)) return res.status(400).json({ error: 'Selecciona un período válido.' });
    const periodo = (await query('SELECT * FROM contabilidad_periodos WHERE id=$1 AND cliente_id=$2', [periodo_id,id])).rows[0];
    if (!periodo) return res.status(404).json({ error: 'Período no encontrado.' });
    const { rows: evidencia } = await query(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE referencia IS NOT NULL OR origen_tipo <> 'manual')::int AS respaldados, max(fecha)::text AS ultimo_asiento
       FROM contabilidad_asientos WHERE cliente_id=$1 AND periodo_id=$2`, [id, periodo_id]
    );
    const total = evidencia[0].total || 0;
    res.json({ periodo, ...perfilFinanciero({ cuentas: await balance(id, periodo_id), nAsientos: total, coberturaRespaldo: total ? Number(evidencia[0].respaldados || 0) / total : 0, ultimoAsiento: evidencia[0].ultimo_asiento }) });
  } catch (err) { next(err); }
});

router.get('/balance.pdf', async (req, res, next) => {
  try {
    const id = clienteId(req, res); if (!id) return;
    const periodo_id = String(req.query.periodo_id || ''); if (!uuid.test(periodo_id)) return res.status(400).json({ error: 'Selecciona un período válido.' });
    const cliente = await existeCliente(id); const periodo = (await query('SELECT * FROM contabilidad_periodos WHERE id=$1 AND cliente_id=$2', [periodo_id,id])).rows[0];
    if (!cliente || !periodo) return res.status(404).json({ error: 'Empresa o período no encontrado.' });
    const pdf = await generateBalanceContable({ cliente, periodo, cuentas: await balance(id, periodo_id) });
    res.setHeader('Content-Type','application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="balance-comprobacion-${periodo.nombre.replace(/[^a-z0-9]+/gi,'-')}.pdf"`); res.send(pdf);
  } catch (err) { next(err); }
});

export default router;
