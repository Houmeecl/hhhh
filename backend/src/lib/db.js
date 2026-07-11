import pg from 'pg';
import { config } from '../config.js';

// Neon requiere SSL; el Postgres local no. Detección simple por host.
const needsSsl = /neon\.tech|amazonaws|sslmode=require/i.test(config.databaseUrl || '');

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
  max: 10,
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
