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
// La cadena global incluye facturas Y anclajes de lotes cerrados
// (cadena_anclajes, migración 022): comparten la secuencia de
// cadena_estado, por eso se verifica la unión ordenada por eslabón.
router.get('/verificar', async (req, res, next) => {
  try {
    const { rows: eslabones } = await query(
      `SELECT id::text AS id, eslabon, hash_anterior, hash_documento, hash_cadena FROM (
         SELECT id, eslabon, hash_anterior, hash_documento, hash_cadena
         FROM facturas WHERE eslabon IS NOT NULL
         UNION ALL
         SELECT id, eslabon, hash_anterior, hash_documento, hash_cadena
         FROM cadena_anclajes
       ) t ORDER BY eslabon ASC`
    );
    const resultado = verificarCadenaCompleta(eslabones);
    res.json(resultado);
  } catch (err) { next(err); }
});

export default router;
