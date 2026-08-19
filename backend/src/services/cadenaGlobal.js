import { query } from '../lib/db.js';
import { nuevoVerificadorDeCadena } from './cadenaHash.js';

// ============================================================
// Cadena GLOBAL compartida: facturas + anclajes de lote cerrados +
// declaraciones REP (vigentes e históricas) — todo documento que
// sicr3p cita como legalmente relevante y que se encadena contra la
// misma secuencia (cadena_estado). Se extrajo de routes/cadena.js
// para reusarla también desde el informe mensual (pdf.js).
//
// Se recorre POR TANDAS. Antes esto era un SELECT sin LIMIT sobre la
// unión de cuatro tablas, y corría entero cada vez que se genera un
// informe mensual (pdf.js): con la cadena creciendo mes a mes, el
// backend terminaba armando en memoria un arreglo con todos los
// documentos que sicr3p ha sellado en su historia para imprimir una
// línea de dos frases.
//
// Lo que NO se cambia es el alcance: se sigue verificando desde el
// génesis hasta el último eslabón. Verificar solo el tramo reciente
// sería más barato, pero el informe dice "cadena global íntegra" y eso
// tiene que significar la cadena entera — una alteración en un
// documento viejo no mueve `cadena_estado`, así que no hay caché ni
// atajo que la detecte. Lo que se acota es la memoria, no la promesa.
// ============================================================

export const TANDA_ESLABONES = 2000;

// Un tramo de la cadena, por paginación de llave (`eslabon > desde`).
// `eslabon` es la posición en una secuencia global única; si alguna vez
// se repitiera, el tramo siguiente no calzaría y la verificación lo
// reportaría como rotura — que es lo correcto: dos documentos en la
// misma posición son una cadena rota.
export async function tandaDeEslabones(desde, limite = TANDA_ESLABONES) {
  const { rows } = await query(
    `SELECT id::text AS id, eslabon, hash_anterior, hash_documento, hash_cadena FROM (
       SELECT id, eslabon, hash_anterior, hash_documento, hash_cadena
       FROM facturas WHERE eslabon IS NOT NULL AND eslabon > $1
       UNION ALL
       SELECT id, eslabon, hash_anterior, hash_documento, hash_cadena
       FROM cadena_anclajes WHERE eslabon > $1
       UNION ALL
       SELECT id, eslabon, hash_anterior, hash_documento, hash_cadena
       FROM declaraciones_embalaje WHERE eslabon IS NOT NULL AND eslabon > $1
       UNION ALL
       SELECT id, eslabon, hash_anterior, hash_documento, hash_cadena
       FROM declaraciones_embalaje_historial WHERE eslabon > $1
     ) t ORDER BY eslabon ASC LIMIT $2`,
    [desde, limite]
  );
  return rows;
}

export async function verificarCadenaGlobal() {
  const verificador = nuevoVerificadorDeCadena();
  let desde = 0;
  for (;;) {
    const tanda = await tandaDeEslabones(desde);
    if (!tanda.length) break;
    // Si la cadena ya se rompió, no tiene sentido seguir leyendo: todo lo
    // que viene después cuelga de un eslabón que no cuadra.
    if (verificador.agregar(tanda)) break;
    if (tanda.length < TANDA_ESLABONES) break;
    desde = Number(tanda[tanda.length - 1].eslabon);
  }
  return verificador.resultado();
}
