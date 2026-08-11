import express from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole, requireHomePanel, logActividad } from '../middleware/auth.js';
import { calcularCo2eViaje, validarViaje } from '../services/transporte.js';
import { rutValido } from '../services/dte.js';

// ============================================================
// Transporte de personal — GHG Protocol Categoría 7.
// Fórmula en services/transporte.js (calcularCo2eViaje, con tests).
// Cada viaje también carga la cuenta CO2E del Capital Natural.
// ============================================================

const router = express.Router();
router.use(requireAuth, requireHomePanel('sicrep'));
const adminOnly = requireRole('admin', 'operador');

// ---------- Modos y factores ----------
router.get('/modos', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM transporte_modos ORDER BY array_position(ARRAY['bus','camioneta','auto','tren','avion'], codigo)`
    );
    res.json({ modos: rows });
  } catch (err) { next(err); }
});

router.put('/modos/:codigo', adminOnly, async (req, res, next) => {
  try {
    const { nombre, factor_kgco2e_pkm, fuente } = req.body;
    const { rows } = await query(
      `UPDATE transporte_modos SET
         nombre = COALESCE($2,nombre),
         factor_kgco2e_pkm = COALESCE($3,factor_kgco2e_pkm),
         fuente = COALESCE($4,fuente),
         updated_at = now()
       WHERE codigo = $1 RETURNING *`,
      [req.params.codigo, nombre, factor_kgco2e_pkm != null ? Number(factor_kgco2e_pkm) : null, fuente]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Modo no encontrado' });
    await logActividad({ usuarioId: req.user.sub, accion: 'editar_modo_transporte', entidad: 'transporte_modo', entidadId: req.params.codigo, ip: req.ip });
    res.json({ modo: rows[0] });
  } catch (err) { next(err); }
});

// ---------- Viajes ----------
router.get('/viajes', async (req, res, next) => {
  try {
    const cond = ['1=1'];
    const params = [];
    if (req.query.rut) { params.push(`%${String(req.query.rut).replace(/[^0-9kK]/g, '')}%`); cond.push(`regexp_replace(COALESCE(rut_cliente,''),'[^0-9kK]','','g') ILIKE $${params.length}`); }
    if (req.query.desde) { params.push(req.query.desde); cond.push(`fecha >= $${params.length}`); }
    if (req.query.hasta) { params.push(req.query.hasta); cond.push(`fecha <= $${params.length}`); }
    // Columnas explícitas, no v.*: la migración 090 agregó la evidencia
    // BYTEA (hasta 15 MB por fila) de los viajes que registran los
    // proveedores — con v.* el listado admin arrastraría esos binarios
    // completos en cada carga sin que el frontend los use.
    const { rows: viajes } = await query(
      `SELECT v.id, v.rut_cliente, v.fecha, v.modo, v.origen, v.destino, v.km,
              v.pasajeros, v.ida_vuelta, v.co2e, v.notas, v.proveedor_id,
              v.archivo_nombre, v.created_at, m.nombre AS modo_nombre
       FROM transporte_viajes v
       JOIN transporte_modos m ON m.codigo = v.modo
       WHERE ${cond.join(' AND ')} ORDER BY v.fecha DESC, v.created_at DESC LIMIT 300`, params
    );
    const { rows: totales } = await query(
      `SELECT modo, COUNT(*)::int AS n_viajes, SUM(co2e)::float AS co2e
       FROM transporte_viajes WHERE ${cond.join(' AND ')} GROUP BY modo`, params
    );
    res.json({ viajes, totales });
  } catch (err) { next(err); }
});

router.post('/viajes', adminOnly, async (req, res, next) => {
  try {
    // Validación autoritativa compartida con la ruta del proveedor
    // (validarViaje, services/transporte.js, con tests): km > 0 con tope
    // de cordura, pasajeros entero positivo acotado, fecha no futura,
    // origen/destino con largo máximo. Antes `!Number(km)` dejaba pasar
    // un km NEGATIVO hasta el CHECK de Postgres (error 500 en vez de un
    // 400 claro) y un typo tipo "2150000" entraba directo al inventario.
    const v = validarViaje(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    const { modo, fecha, origen, destino, km, pasajeros: pax, ida_vuelta, notas } = v.datos;

    // RUT del cliente (opcional): si viene, debe pasar módulo 11 — hasta
    // ahora solo se formateaba en el frontend, sin validar el dígito
    // verificador en ninguna parte, y un RUT mal tecleado quedaba pegado
    // a los viajes (y a las búsquedas por RUT que filtran sobre él).
    const rutCliente = req.body.rut_cliente ? String(req.body.rut_cliente).trim() : null;
    if (rutCliente && !rutValido(rutCliente)) {
      return res.status(400).json({ error: 'El RUT del cliente no es válido — revisa el dígito verificador.' });
    }

    const { rows: mRows } = await query(`SELECT * FROM transporte_modos WHERE codigo = $1`, [modo]);
    if (!mRows[0]) return res.status(400).json({ error: 'Modo de transporte desconocido.' });

    const co2e = calcularCo2eViaje({ km, pasajeros: pax, ida_vuelta, factor_kgco2e_pkm: mRows[0].factor_kgco2e_pkm });

    const { rows } = await query(
      `INSERT INTO transporte_viajes (rut_cliente, fecha, modo, origen, destino, km, pasajeros, ida_vuelta, co2e, notas)
       VALUES ($1,COALESCE($2::date,CURRENT_DATE),$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [rutCliente, fecha, modo, origen, destino, km, pax, ida_vuelta, co2e, notas]
    );

    // Capital Natural: el traslado carga la cuenta de carbono (si está activa).
    const { rows: cn } = await query(`SELECT activo FROM cuentas_naturales WHERE codigo = 'CO2E'`);
    if (cn[0]?.activo) {
      await query(
        `INSERT INTO movimientos_naturales (cuenta_codigo, fecha, glosa, cantidad, unidad, tipo, origen)
         VALUES ('CO2E', COALESCE($1::date,CURRENT_DATE), $2, $3, 'tCO2e', 'cargo', 'manual')`,
        // '->' y no '→': la glosa se imprime en el balance de Capital
        // Natural (services/pdf.js, fuente Courier/WinAnsi sin ese glifo).
        [fecha, `Transporte personal — ${origen} -> ${destino}`, co2e]
      );
    }

    await logActividad({ usuarioId: req.user.sub, accion: 'crear_viaje_cat7', entidad: 'transporte_viaje', entidadId: rows[0].id, ip: req.ip });
    res.status(201).json({ viaje: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/viajes/:id', adminOnly, async (req, res, next) => {
  try {
    const { rowCount } = await query(`DELETE FROM transporte_viajes WHERE id = $1`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Viaje no encontrado' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
