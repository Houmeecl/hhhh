import express from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireHomePanel, logActividad } from '../middleware/auth.js';
import { bigquery } from '../services/bigquery.js';

// ============================================================
// Búsqueda unificada por RUT / texto con CRUCES de clientes.
// Un solo buscador: escribe un RUT, un N° de documento, un
// archivo o el nombre de una empresa, y devuelve todas sus
// apariciones + las relaciones (cliente / proveedor / comprador).
// ============================================================

const router = express.Router();
router.use(requireAuth, requireHomePanel('sicrep'));

const rutNorm = (r) => String(r || '').replace(/[^0-9kK]/g, '').toUpperCase();
const NORM = (col) => `regexp_replace(COALESCE(${col},''), '[^0-9kK]', '', 'g')`;

router.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 3) return res.status(400).json({ error: 'Escribe al menos 3 caracteres.' });
    const like = `%${q}%`;
    const rn = rutNorm(q);
    const esRut = rn.length >= 7; // parece un RUT (con o sin formato)

    const [clientes, sesiones, facturas, documentos] = await Promise.all([
      query(
        `SELECT id, rut, nombre_empresa, estado_contrato, plan FROM clientes
         WHERE nombre_empresa ILIKE $1 OR ${NORM('rut')} ILIKE $2 LIMIT 20`,
        [like, esRut ? `%${rn}%` : like]
      ),
      query(
        `SELECT id, rut_cliente, nombre_cliente, email_cliente, total_co2e, created_at FROM sesiones
         WHERE nombre_cliente ILIKE $1 OR email_cliente ILIKE $1 OR ${NORM('rut_cliente')} ILIKE $2
         ORDER BY created_at DESC LIMIT 20`,
        [like, esRut ? `%${rn}%` : like]
      ),
      query(
        `SELECT f.id, f.numero_venta, f.archivo_original, f.rut_emisor, f.rut_receptor,
                f.categoria, f.total_co2e, f.created_at, s.nombre_cliente
         FROM facturas f LEFT JOIN sesiones s ON s.id = f.sesion_id
         WHERE f.numero_venta ILIKE $1 OR f.archivo_original ILIKE $1
            OR ${NORM('f.rut_emisor')} ILIKE $2 OR ${NORM('f.rut_receptor')} ILIKE $2
         ORDER BY f.created_at DESC LIMIT 30`,
        [like, esRut ? `%${rn}%` : like]
      ),
      query(
        `SELECT id, pais_origen, pais_destino, tramo, tipo_documento, numero_documento,
                estado, total_co2e, created_at
         FROM documentos_corredor
         WHERE numero_documento ILIKE $1 OR tramo ILIKE $1 OR archivo_original ILIKE $1
            OR ${NORM('rut_emisor')} ILIKE $2 OR ${NORM('rut_receptor')} ILIKE $2
         ORDER BY created_at DESC LIMIT 20`,
        [like, esRut ? `%${rn}%` : like]
      ),
    ]);

    // ---------- CRUCES: el RUT visto desde todos los roles ----------
    let cruces = null;
    if (esRut) {
      const [comoCliente, comoProveedor, comoComprador] = await Promise.all([
        // El RUT como cliente de sicr3p (sesiones que procesó).
        query(
          `SELECT COUNT(*)::int AS n_sesiones, COALESCE(SUM(total_co2e),0)::float AS total_co2e,
                  MAX(created_at) AS ultima_sesion
           FROM sesiones WHERE ${NORM('rut_cliente')} = $1`, [rn]
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
        // El RUT como comprador: quiénes le emiten (sus proveedores).
        query(
          `SELECT ${NORM('f.rut_emisor')} AS rut_emisor,
                  COUNT(*)::int AS n_documentos, SUM(f.total_co2e)::float AS total_co2e
           FROM facturas f WHERE ${NORM('f.rut_receptor')} = $1
           GROUP BY 1 ORDER BY total_co2e DESC NULLS LAST LIMIT 20`, [rn]
        ),
      ]);
      cruces = {
        rut: rn,
        como_cliente: comoCliente.rows[0],
        recibe_de: comoComprador.rows,   // proveedores del RUT
        emite_a: comoProveedor.rows,     // clientes del RUT
      };
    }

    res.json({
      q,
      clientes: clientes.rows,
      sesiones: sesiones.rows,
      facturas: facturas.rows,
      documentos: documentos.rows,
      cruces,
    });

    // Auditoría del cruce de datos: quién consultó qué RUT y qué encontró.
    // Solo se registra cuando hubo cruce real (esRut) — una búsqueda de
    // texto libre sin coincidencias de RUT no cruza datos entre partes.
    if (cruces) {
      const detalle = {
        query: q,
        n_como_cliente: cruces.como_cliente?.n_sesiones || 0,
        n_recibe_de: cruces.recibe_de.length,
        n_emite_a: cruces.emite_a.length,
      };
      logActividad({
        usuarioId: req.user.sub, accion: 'consulta_cruce_rut',
        entidad: 'busqueda', entidadId: rn, detalle, ip: req.ip,
      });
      bigquery.exportAcceso({ tipo: 'consulta_cruce_rut', actor: { tipo: 'usuario', id: req.user.sub }, rut_consultado: rn, detalle });
    }
  } catch (err) { next(err); }
});

export default router;
