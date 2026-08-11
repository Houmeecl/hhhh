import { query } from '../lib/db.js';
import { verificarCadenaCompleta } from './cadenaHash.js';

// ============================================================
// Cadena GLOBAL compartida: facturas + anclajes de lote cerrados +
// declaraciones REP (vigentes e históricas) — todo documento que
// sicr3p cita como legalmente relevante y que se encadena contra la
// misma secuencia (cadena_estado). Se extrajo de routes/cadena.js
// para reusarla también desde el informe mensual (pdf.js).
// ============================================================

export async function obtenerEslabonesGlobales() {
  const { rows } = await query(
    `SELECT id::text AS id, eslabon, hash_anterior, hash_documento, hash_cadena FROM (
       SELECT id, eslabon, hash_anterior, hash_documento, hash_cadena
       FROM facturas WHERE eslabon IS NOT NULL
       UNION ALL
       SELECT id, eslabon, hash_anterior, hash_documento, hash_cadena
       FROM cadena_anclajes
       UNION ALL
       SELECT id, eslabon, hash_anterior, hash_documento, hash_cadena
       FROM declaraciones_embalaje WHERE eslabon IS NOT NULL
       UNION ALL
       SELECT id, eslabon, hash_anterior, hash_documento, hash_cadena
       FROM declaraciones_embalaje_historial
     ) t ORDER BY eslabon ASC`
  );
  return rows;
}

export async function verificarCadenaGlobal() {
  return verificarCadenaCompleta(await obtenerEslabonesGlobales());
}
