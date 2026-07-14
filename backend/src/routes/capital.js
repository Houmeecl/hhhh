import express from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole, logActividad } from '../middleware/auth.js';
import { generateBalanceNatural } from '../services/pdf.js';

// ============================================================
// Capital Natural — plan de cuentas ambiental, activos (stock),
// libro de movimientos (flujo) y Estado de Capital Natural (PDF).
// ============================================================

const router = express.Router();
router.use(requireAuth);
const adminOnly = requireRole('admin', 'operador');

const ORDEN = `array_position(ARRAY['AGUA','ENER','CO2E','MATR','SUEL','BIOD'], codigo)`;

// ---------- Plan de cuentas ----------
router.get('/cuentas', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM cuentas_naturales ORDER BY ${ORDEN}`);
    res.json({ cuentas: rows });
  } catch (err) { next(err); }
});

router.put('/cuentas/:codigo', adminOnly, async (req, res, next) => {
  try {
    const codigo = String(req.params.codigo).toUpperCase();
    const { nombre, unidad, activo, factores, marco, fuente, notas } = req.body;
    const { rows } = await query(
      `UPDATE cuentas_naturales SET
         nombre = COALESCE($2,nombre),
         unidad = COALESCE($3,unidad),
         activo = COALESCE($4,activo),
         factores = COALESCE($5,factores),
         marco = COALESCE($6,marco),
         fuente = COALESCE($7,fuente),
         notas = COALESCE($8,notas),
         updated_at = now()
       WHERE codigo = $1 RETURNING *`,
      [codigo, nombre, unidad, typeof activo === 'boolean' ? activo : null,
       factores ? JSON.stringify(factores) : null, marco, fuente, notas]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Cuenta no encontrada' });
    await logActividad({ usuarioId: req.user.sub, accion: 'editar_cuenta_natural', entidad: 'cuenta_natural', entidadId: codigo, ip: req.ip });
    res.json({ cuenta: rows[0] });
  } catch (err) { next(err); }
});

// ---------- Activos naturales (stock) ----------
router.get('/activos', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT a.*, c.nombre AS cuenta_nombre, c.unidad AS cuenta_unidad
       FROM activos_naturales a JOIN cuentas_naturales c ON c.codigo = a.cuenta_codigo
       ORDER BY a.created_at DESC`
    );
    res.json({ activos: rows });
  } catch (err) { next(err); }
});

router.post('/activos', adminOnly, async (req, res, next) => {
  try {
    const { nombre, cuenta_codigo, descripcion, extension, unidad, condicion, valor_clp, ubicacion, vigencia } = req.body;
    if (!nombre || !cuenta_codigo) return res.status(400).json({ error: 'Nombre y cuenta son obligatorios.' });
    const { rows } = await query(
      `INSERT INTO activos_naturales (nombre, cuenta_codigo, descripcion, extension, unidad, condicion, valor_clp, ubicacion, vigencia)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [nombre, String(cuenta_codigo).toUpperCase(), descripcion || null, Number(extension) || 0,
       unidad || null, condicion != null && condicion !== '' ? Number(condicion) : null,
       valor_clp != null && valor_clp !== '' ? Number(valor_clp) : null, ubicacion || null, vigencia || null]
    );
    await logActividad({ usuarioId: req.user.sub, accion: 'crear_activo_natural', entidad: 'activo_natural', entidadId: rows[0].id, ip: req.ip });
    res.status(201).json({ activo: rows[0] });
  } catch (err) { next(err); }
});

router.put('/activos/:id', adminOnly, async (req, res, next) => {
  try {
    const { nombre, descripcion, extension, unidad, condicion, valor_clp, ubicacion, vigencia } = req.body;
    const { rows } = await query(
      `UPDATE activos_naturales SET
         nombre = COALESCE($2,nombre),
         descripcion = COALESCE($3,descripcion),
         extension = COALESCE($4,extension),
         unidad = COALESCE($5,unidad),
         condicion = COALESCE($6,condicion),
         valor_clp = COALESCE($7,valor_clp),
         ubicacion = COALESCE($8,ubicacion),
         vigencia = COALESCE($9,vigencia)
       WHERE id = $1 RETURNING *`,
      [req.params.id, nombre, descripcion,
       extension != null && extension !== '' ? Number(extension) : null,
       unidad,
       condicion != null && condicion !== '' ? Number(condicion) : null,
       valor_clp != null && valor_clp !== '' ? Number(valor_clp) : null,
       ubicacion, vigencia]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Activo no encontrado' });
    res.json({ activo: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/activos/:id', adminOnly, async (req, res, next) => {
  try {
    const { rowCount } = await query(`DELETE FROM activos_naturales WHERE id = $1`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Activo no encontrado' });
    await logActividad({ usuarioId: req.user.sub, accion: 'eliminar_activo_natural', entidad: 'activo_natural', entidadId: req.params.id, ip: req.ip });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------- Libro de movimientos ----------
function filtrosLibro(qs) {
  const cond = [];
  const params = [];
  if (qs.cuenta) { params.push(String(qs.cuenta).toUpperCase()); cond.push(`m.cuenta_codigo = $${params.length}`); }
  if (qs.desde) { params.push(qs.desde); cond.push(`m.fecha >= $${params.length}`); }
  if (qs.hasta) { params.push(qs.hasta); cond.push(`m.fecha <= $${params.length}`); }
  return { where: cond.length ? `WHERE ${cond.join(' AND ')}` : '', params };
}

router.get('/libro', async (req, res, next) => {
  try {
    const { where, params } = filtrosLibro(req.query);
    const { rows: movimientos } = await query(
      `SELECT m.*, c.nombre AS cuenta_nombre
       FROM movimientos_naturales m JOIN cuentas_naturales c ON c.codigo = m.cuenta_codigo
       ${where} ORDER BY m.fecha DESC, m.created_at DESC LIMIT 500`, params
    );
    const { rows: sRows } = await query(
      `SELECT m.cuenta_codigo, m.unidad,
              SUM(CASE WHEN m.tipo='cargo' THEN m.cantidad ELSE -m.cantidad END) AS saldo
       FROM movimientos_naturales m ${where}
       GROUP BY m.cuenta_codigo, m.unidad`, params
    );
    res.json({ movimientos, saldos: sRows });
  } catch (err) { next(err); }
});

router.post('/movimientos', adminOnly, async (req, res, next) => {
  try {
    const { cuenta_codigo, fecha, glosa, cantidad, unidad, tipo } = req.body;
    if (!cuenta_codigo || !glosa || !Number(cantidad)) {
      return res.status(400).json({ error: 'Cuenta, glosa y cantidad son obligatorios.' });
    }
    const { rows } = await query(
      `INSERT INTO movimientos_naturales (cuenta_codigo, fecha, glosa, cantidad, unidad, tipo, origen)
       VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6, 'manual') RETURNING *`,
      [String(cuenta_codigo).toUpperCase(), fecha || null, glosa, Number(cantidad),
       unidad || '', tipo === 'abono' ? 'abono' : 'cargo']
    );
    await logActividad({ usuarioId: req.user.sub, accion: 'movimiento_natural_manual', entidad: 'movimiento_natural', entidadId: rows[0].id, ip: req.ip });
    res.status(201).json({ movimiento: rows[0] });
  } catch (err) { next(err); }
});

// ---------- Balance ----------
async function computeBalance(desde, hasta) {
  const cond = ['1=1'];
  const params = [];
  if (desde) { params.push(desde); cond.push(`m.fecha >= $${params.length}`); }
  if (hasta) { params.push(hasta); cond.push(`m.fecha <= $${params.length}`); }
  const { rows: cuentas } = await query(`SELECT * FROM cuentas_naturales ORDER BY ${ORDEN}`);
  const { rows: flujos } = await query(
    `SELECT m.cuenta_codigo,
            SUM(CASE WHEN m.tipo='cargo' THEN m.cantidad ELSE -m.cantidad END) AS saldo,
            COUNT(*)::int AS n_movimientos
     FROM movimientos_naturales m WHERE ${cond.join(' AND ')}
     GROUP BY m.cuenta_codigo`, params
  );
  const { rows: stocks } = await query(
    `SELECT cuenta_codigo, COUNT(*)::int AS n_activos,
            SUM(extension) AS extension_total, SUM(valor_clp) AS valor_clp_total,
            AVG(condicion)::numeric(5,1) AS condicion_promedio
     FROM activos_naturales GROUP BY cuenta_codigo`
  );
  const fMap = new Map(flujos.map((f) => [f.cuenta_codigo, f]));
  const sMap = new Map(stocks.map((s) => [s.cuenta_codigo, s]));
  return cuentas.map((c) => ({
    ...c,
    saldo: Number(fMap.get(c.codigo)?.saldo || 0),
    n_movimientos: fMap.get(c.codigo)?.n_movimientos || 0,
    n_activos: sMap.get(c.codigo)?.n_activos || 0,
    extension_total: Number(sMap.get(c.codigo)?.extension_total || 0),
    valor_clp_total: sMap.get(c.codigo)?.valor_clp_total != null ? Number(sMap.get(c.codigo).valor_clp_total) : null,
    condicion_promedio: sMap.get(c.codigo)?.condicion_promedio != null ? Number(sMap.get(c.codigo).condicion_promedio) : null,
  }));
}

router.get('/balance', async (req, res, next) => {
  try {
    res.json({ balance: await computeBalance(req.query.desde, req.query.hasta) });
  } catch (err) { next(err); }
});

router.get('/balance.pdf', async (req, res, next) => {
  try {
    const balance = await computeBalance(req.query.desde, req.query.hasta);
    const { where, params } = filtrosLibro(req.query);
    const { rows: movimientos } = await query(
      `SELECT m.* FROM movimientos_naturales m ${where}
       ORDER BY m.cuenta_codigo, m.fecha, m.created_at LIMIT 400`, params
    );
    const { rows: activos } = await query(
      `SELECT a.*, c.nombre AS cuenta_nombre FROM activos_naturales a
       JOIN cuentas_naturales c ON c.codigo = a.cuenta_codigo ORDER BY a.cuenta_codigo, a.nombre`
    );
    const pdf = await generateBalanceNatural({
      balance, movimientos, activos,
      periodo: { desde: req.query.desde, hasta: req.query.hasta },
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="sicr3p-capital-natural.pdf"');
    res.send(pdf);
  } catch (err) { next(err); }
});

export default router;
