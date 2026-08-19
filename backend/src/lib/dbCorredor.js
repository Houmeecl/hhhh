import pg from 'pg';
import { config } from '../config.js';

// ============================================================
// Conexión a la base del Corredor Bioceánico — SEPARADA de la de sicr3p.
//
// POR QUÉ HAY DOS POOLS Y NO UNO. Son dos productos distintos y sus datos
// no se mezclan. `sicr3p_corredor` vive en el mismo servidor Postgres que
// `sicr3p`, pero es OTRA BASE, y esa es toda la gracia: Postgres no puede
// hacer un JOIN entre bases distintas. La separación queda garantizada por
// el motor, no por que nadie escriba la consulta equivocada — que es lo
// que pasaría con un esquema aparte, donde `corredor.cargas JOIN
// public.facturas` compila perfecto.
//
// Consecuencia que hay que tener presente al escribir cualquier cosa acá:
// **no existen las claves foráneas entre los dos mundos**. La base del
// Corredor tiene sus propios usuarios, sus propias cargas y su propia
// cadena de hash. Nada apunta a una fila de `sicr3p`, y nada de `sicr3p`
// apunta acá.
//
// ES OPCIONAL A PROPÓSITO. Sin DATABASE_URL_CORREDOR el subsistema queda
// apagado y la app principal arranca igual. El Corredor es producto nuevo;
// que su ausencia tumbara el backend de una empresa que solo usa la
// contabilidad sería el peor intercambio posible — y `index.js` mata el
// proceso ante cualquier error de arranque, así que esto no es teórico.
// ============================================================

let pool = null;

export function corredorDisponible() {
  return Boolean(config.corredor.databaseUrl);
}

// El pool se crea la primera vez que se usa, no al importar el módulo.
// Importar este archivo en un entorno sin Corredor configurado no debe
// abrir ninguna conexión ni dejar un handle vivo que impida que el proceso
// termine — cosa que rompería la suite de tests.
export function poolCorredor() {
  if (!corredorDisponible()) {
    const e = new Error(
      'El Corredor no está configurado en este entorno: falta DATABASE_URL_CORREDOR.'
    );
    e.status = 503;
    e.codigo = 'corredor_no_configurado';
    throw e;
  }
  if (!pool) {
    const url = config.corredor.databaseUrl;
    const needsSsl = /neon\.tech|amazonaws|sslmode=require/i.test(url);
    pool = new pg.Pool({
      connectionString: url,
      ssl: needsSsl ? { rejectUnauthorized: false } : false,
      // Más chico que el de sicr3p (10): el Corredor mueve cargas, no el
      // flujo de facturas de todas las empresas. Dos pools de 10 sobre el
      // mismo Postgres son 20 conexiones para un VPS que atiende una sola
      // instancia — y el default de Postgres son 100 en total.
      max: 5,
      connectionTimeoutMillis: 5_000,
    });
  }
  return pool;
}

export const queryCorredor = (text, params) => poolCorredor().query(text, params);

export async function withTxCorredor(fn) {
  const client = await poolCorredor().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Para los tests y para el apagado ordenado. No falla si nunca se abrió.
export async function cerrarCorredor() {
  if (pool) {
    const p = pool;
    pool = null;
    await p.end();
  }
}
