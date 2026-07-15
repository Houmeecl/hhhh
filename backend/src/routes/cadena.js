import express from 'express';
import { query } from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';
import { verificarCadenaCompleta } from '../services/cadenaHash.js';

// ============================================================
// Cadena de hash tipo blockchain (interna) — estado y verificación.
// El cálculo/encadenado ocurre en routes/public.js al procesar cada
// sesión; aquí solo se consulta y se audita.
// ============================================================

const router = express.Router();
router.use(requireAuth);

router.get('/estado', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT ultimo_hash, n_eslabones, updated_at FROM cadena_estado WHERE id = 1`);
    res.json({ estado: rows[0] });
  } catch (err) { next(err); }
});

// Recalcula la cadena completa desde el génesis (auditoría bajo demanda).
router.get('/verificar', async (req, res, next) => {
  try {
    const { rows: eslabones } = await query(
      `SELECT id, hash_anterior, hash_documento, hash_cadena
       FROM facturas WHERE eslabon IS NOT NULL ORDER BY eslabon ASC`
    );
    const resultado = verificarCadenaCompleta(eslabones);
    res.json(resultado);
  } catch (err) { next(err); }
});

export default router;
