import express from 'express';
import { gunzipSync } from 'zlib';
import { query } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { categoriaParaMostrar } from '../services/categoriaPresentacion.js';
import { generateContrato } from '../services/pdf.js';
import {
  PUNTOS_PENDIENTES, TIPOS, TIPO_POR_DEFECTO, clausulas, clausulasPendientes,
} from '../services/contrato.js';

// ============================================================
// Portal del cliente (acceso vía magic link, rol 'cliente').
// Solo ve SU historial: todo se filtra por el email del token.
// ============================================================

const router = express.Router();
// El guard va POR RUTA (no router.use): este router se monta en /api y un
// middleware global respondería 403 a todas las rutas montadas después.
const soloCliente = [requireAuth, requireRole('cliente')];

function pdfDeContrato(contrato) {
  const meta = TIPOS[contrato.tipo] || TIPOS[TIPO_POR_DEFECTO];
  return generateContrato({
    contrato,
    titulo: meta.titulo.toUpperCase(),
    codigo: meta.codigo,
    clausulas: clausulas(contrato.datos, contrato.tipo),
    pendientes: clausulasPendientes(contrato.datos, contrato.tipo).length ? PUNTOS_PENDIENTES : [],
  });
}

// ---------- GET /api/mi-contrato.pdf ----------
// El contrato se busca únicamente a partir del cliente incluido en el JWT.
// No se recibe un ID por URL: así una cuenta cliente no puede probar IDs de
// otras empresas para descargar condiciones que no le pertenecen.
router.get('/mi-contrato.pdf', soloCliente, async (req, res, next) => {
  try {
    if (!req.user.cliente_id) {
      return res.status(404).json({ error: 'Esta cuenta no tiene un contrato asociado.' });
    }
    const { rows } = await query(
      `SELECT * FROM contratos
       WHERE cliente_id = $1 AND estado <> 'anulado'
       ORDER BY created_at DESC LIMIT 1`,
      [req.user.cliente_id]
    );
    const contrato = rows[0];
    if (!contrato) return res.status(404).json({ error: 'No hay un contrato disponible para esta cuenta.' });
    const pdf = await pdfDeContrato(contrato);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="contrato-${contrato.numero}.pdf"`);
    res.send(pdf);
  } catch (err) { next(err); }
});

// ---------- GET /api/mis-sesiones ----------
router.get('/mis-sesiones', soloCliente, async (req, res, next) => {
  try {
    const email = String(req.user.email || '').toLowerCase();
    const { rows: sesiones } = await query(
      `SELECT id, rut_cliente, nombre_cliente, fecha, total_co2e, created_at
       FROM sesiones WHERE lower(email_cliente) = $1
       ORDER BY created_at DESC LIMIT 100`,
      [email]
    );
    for (const s of sesiones) {
      // `tamano_bytes` sale de `facturas` directo (JOIN aparte, no de la
      // vista): facturas_vigentes no lo expone — ver migración 094 sobre
      // por qué esa vista no se toca. No nulo = hay binario original
      // disponible para descargar (facturas antiguas o del motor externo
      // no lo tienen).
      const { rows: facturas } = await query(
        `SELECT fv.id, fv.numero_venta, fv.archivo_original, fv.categoria, fv.categoria_origen, fv.total_co2e,
                (f.tamano_bytes IS NOT NULL) AS tiene_archivo_original
         FROM facturas_vigentes fv
         JOIN facturas f ON f.id = fv.id
         WHERE fv.sesion_id = $1 ORDER BY fv.created_at`,
        [s.id]
      );
      // La categoría se entrega ya rotulada: el cliente ve el nombre que el
      // motor usó para calcular, marcado cuando no salió de la glosa real del
      // documento (services/categoriaPresentacion.js).
      s.facturas = facturas.map((f) => ({ ...f, categoria: categoriaParaMostrar(f).detalle }));
    }
    res.json({ email, sesiones });
  } catch (err) { next(err); }
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME = {
  pdf: 'application/pdf', xml: 'application/xml', jpg: 'image/jpeg',
  jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic',
};

// ---------- GET /api/mis-facturas/:id/archivo-original ----------
// Descarga el binario original (comprimido con gzip en BD, migración 094).
// Scopeado al email del cliente vía JOIN con sesiones — un cliente no
// puede pedir el archivo de otra empresa cambiando el id en la URL.
router.get('/mis-facturas/:id/archivo-original', soloCliente, async (req, res, next) => {
  try {
    if (!UUID_RE.test(String(req.params.id))) return res.status(404).json({ error: 'Factura no encontrada.' });
    const email = String(req.user.email || '').toLowerCase();
    const { rows } = await query(
      `SELECT f.archivo_binario, f.archivo_original, f.extension
         FROM facturas f
         JOIN sesiones s ON s.id = f.sesion_id
        WHERE f.id = $1 AND lower(s.email_cliente) = $2`,
      [req.params.id, email]
    );
    if (!rows[0] || !rows[0].archivo_binario) {
      return res.status(404).json({ error: 'Esta factura no tiene un archivo original disponible.' });
    }
    const original = gunzipSync(rows[0].archivo_binario);
    res.setHeader('Content-Type', MIME[rows[0].extension] || 'application/octet-stream');
    const nombreSeguro = (rows[0].archivo_original || 'factura').replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreSeguro}"`);
    res.send(original);
  } catch (err) { next(err); }
});

export default router;
