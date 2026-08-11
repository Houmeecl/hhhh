import express from 'express';
import { query } from '../lib/db.js';
import { requireAuth, requireHomePanel } from '../middleware/auth.js';
import { verificarCadenaGlobal } from '../services/cadenaGlobal.js';

// ============================================================
// Cadena de hash tipo blockchain (interna) — estado y verificación.
// El cálculo/encadenado ocurre en routes/public.js al procesar cada
// sesión; aquí solo se consulta y se audita.
// ============================================================

const router = express.Router();
// Sin requireSeccion a propósito (excepción como la de capacitacion.js):
// estas dos rutas alimentan el widget de integridad del Dashboard — la
// sección universal que toda cuenta sicrep ve — y solo exponen metadata
// de la cadena de hash, ningún dato de negocio.
router.use(requireAuth, requireHomePanel('sicrep'));

router.get('/estado', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT ultimo_hash, n_eslabones, updated_at FROM cadena_estado WHERE id = 1`);
    res.json({ estado: rows[0] });
  } catch (err) { next(err); }
});

// Recalcula la cadena completa desde el génesis (auditoría bajo demanda).
// La cadena global incluye facturas, anclajes de lotes cerrados
// (cadena_anclajes, migración 022) y declaraciones REP vigentes +
// históricas (migración 028): comparten la secuencia de cadena_estado,
// por eso se verifica la unión ordenada por eslabón.
router.get('/verificar', async (req, res, next) => {
  try {
    res.json(await verificarCadenaGlobal());
  } catch (err) { next(err); }
});

export default router;
