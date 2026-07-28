import express from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireHomePanel, logActividad } from '../middleware/auth.js';
import { bigquery } from '../services/bigquery.js';
import { normalizarRut } from '../services/mandante.js';

// ============================================================
// API para TRAZADORES — panel web (migración 058) para un tercero
// externo (auditora, cliente final, organismo) que necesita buscar la
// trazabilidad de un RUT, pero SOLO de los RUT que un admin le puso
// explícitamente en su lista blanca (trazador_ruts). A diferencia de
// puerto/mandante/agencia, no existe camino de X-Api-Key: es siempre
// un humano entrando con su propia cuenta (email+contraseña).
//
// Los datos expuestos son EXACTAMENTE los mismos cruces por RUT que ya
// arma routes/buscar.js (como_cliente / recibe_de / emite_a) sobre las
// mismas tablas reales (sesiones, facturas) — este router no inventa ni
// sintetiza ningún dato, solo acota qué RUT puede consultar cada trazador.
// ============================================================

const router = express.Router();
router.use(requireAuth, requireHomePanel('trazador'));

// requireHomePanel solo valida el panel del JWT; la fila de `trazadores`
// (nombre, activo) se carga aparte porque cada endpoint la necesita.
async function cargarTrazador(req, res, next) {
  try {
    const { rows } = await query(`SELECT * FROM trazadores WHERE id = $1`, [req.user.trazador_id]);
    const t = rows[0];
    if (!t || !t.activo) return res.status(401).json({ error: 'Trazador inactivo.' });
    req.trazador = t;
    next();
  } catch (err) { next(err); }
}
router.use(cargarTrazador);

const rutNorm = normalizarRut;
const NORM = (col) => `regexp_replace(COALESCE(${col},''), '[^0-9kK]', '', 'g')`;

// Lista blanca del trazador: SIEMPRE obligatoria (nunca opcional como en
// mandante_proveedores) — sin filas activas, el trazador no ve ningún RUT.
// Mismo criterio que lotesCbamDelMandante en routes/mandante.js.
async function rutasPermitidas(trazadorId) {
  const { rows } = await query(
    `SELECT rut FROM trazador_ruts WHERE trazador_id = $1 AND activo = true ORDER BY created_at DESC`,
    [trazadorId]
  );
  return rows.map((r) => r.rut);
}

// ---------- GET /api/trazador/rutas-permitidas ----------
router.get('/rutas-permitidas', async (req, res, next) => {
  try {
    const ruts = await rutasPermitidas(req.trazador.id);
    res.json({ trazador: { nombre: req.trazador.nombre }, ruts });
  } catch (err) { next(err); }
});

// ---------- GET /api/trazador/buscar?rut=... ----------
router.get('/buscar', async (req, res, next) => {
  try {
    const rn = rutNorm(req.query.rut);
    if (!rn) return res.status(400).json({ error: 'Falta el parámetro rut.' });

    const permitidos = await rutasPermitidas(req.trazador.id);
    if (!permitidos.includes(rn)) {
      return res.status(403).json({ error: 'No tienes acceso a este RUT.' });
    }

    // Mismos tres cruces que routes/buscar.js, sobre las mismas tablas
    // reales — nada se sintetiza para este panel.
    const [comoCliente, comoComprador, comoProveedor] = await Promise.all([
      // El RUT como cliente de sicr3p (sesiones que procesó).
      query(
        `SELECT COUNT(*)::int AS n_sesiones, COALESCE(SUM(total_co2e),0)::float AS total_co2e,
                MAX(created_at) AS ultima_sesion
         FROM sesiones WHERE ${NORM('rut_cliente')} = $1`, [rn]
      ),
      // El RUT como comprador: quiénes le emiten (sus proveedores).
      query(
        `SELECT ${NORM('f.rut_emisor')} AS rut_emisor,
                COUNT(*)::int AS n_documentos, SUM(f.total_co2e)::float AS total_co2e
         FROM facturas f WHERE ${NORM('f.rut_receptor')} = $1
         GROUP BY 1 ORDER BY total_co2e DESC NULLS LAST LIMIT 20`, [rn]
      ),
      // El RUT como proveedor: a qué clientes les emite documentos.
      query(
        `SELECT ${NORM('f.rut_receptor')} AS rut_receptor,
                MAX(s.nombre_cliente) AS empresa,
                COUNT(*)::int AS n_documentos, SUM(f.total_co2e)::float AS total_co2e
         FROM facturas f LEFT JOIN sesiones s
           ON s.id = f.sesion_id AND ${NORM('s.rut_cliente')} = ${NORM('f.rut_receptor')}
         WHERE ${NORM('f.rut_emisor')} = $1
         GROUP BY 1 ORDER BY total_co2e DESC NULLS LAST LIMIT 20`, [rn]
      ),
    ]);

    const cruces = {
      rut: rn,
      como_cliente: comoCliente.rows[0],
      recibe_de: comoComprador.rows, // proveedores del RUT
      emite_a: comoProveedor.rows,   // clientes del RUT
    };

    res.json({ trazador: { nombre: req.trazador.nombre }, cruces });

    const detalle = {
      rut_consultado: rn,
      n_como_cliente: cruces.como_cliente?.n_sesiones || 0,
      n_recibe_de: cruces.recibe_de.length,
      n_emite_a: cruces.emite_a.length,
    };
    logActividad({
      usuarioId: req.user.sub, accion: 'consulta_cruce_rut_trazador',
      entidad: 'trazador', entidadId: req.trazador.id, detalle, ip: req.ip,
    });
    bigquery.exportAcceso({ tipo: 'consulta_cruce_rut_trazador', actor: { tipo: 'trazador', id: req.trazador.id }, rut_consultado: rn, detalle });
  } catch (err) { next(err); }
});

export default router;
