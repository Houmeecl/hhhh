import pg from 'pg';
import { config } from '../config.js';

// Sin esto, pg parsea las columnas DATE como objetos Date (medianoche UTC) y
// JSON.stringify las serializa como ISO con hora ("2026-07-15T00:00:00.000Z"),
// lo que en Chile (UTC-3/-4) se termina mostrando un día antes en el frontend.
// OID 1082 = date. Se devuelve el string crudo 'YYYY-MM-DD' tal como está en la BD.
pg.types.setTypeParser(1082, (val) => val);

// Neon requiere SSL; el Postgres local no. Detección simple por host.
const needsSsl = /neon\.tech|amazonaws|sslmode=require/i.test(config.databaseUrl || '');

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
  max: 10,
  // Sin esto, con las 10 conexiones del pool ocupadas (pico de tráfico o
  // Postgres caído), una petición nueva esperaba un cliente libre para
  // siempre en vez de fallar rápido con un error claro.
  connectionTimeoutMillis: 5_000,
});

export const query = (text, params) => pool.query(text, params);

export async function withTx(fn) {
  const client = await pool.connect();
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
