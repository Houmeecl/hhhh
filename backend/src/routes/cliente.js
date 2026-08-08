import express from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { categoriaParaMostrar } from '../services/categoriaPresentacion.js';

// ============================================================
// Portal del cliente (acceso vía magic link, rol 'cliente').
// Solo ve SU historial: todo se filtra por el email del token.
// ============================================================

const router = express.Router();
// El guard va POR RUTA (no router.use): este router se monta en /api y un
// middleware global respondería 403 a todas las rutas montadas después.
const soloCliente = [requireAuth, requireRole('cliente')];

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
      const { rows: facturas } = await query(
        `SELECT id, numero_venta, archivo_original, categoria, categoria_origen, total_co2e
         FROM facturas WHERE sesion_id = $1 ORDER BY created_at`,
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

export default router;
