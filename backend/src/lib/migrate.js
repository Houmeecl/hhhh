import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db.js';
import { corredorDisponible, poolCorredor } from './dbCorredor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '../../migrations');
const migrationsCorredorDir = path.resolve(__dirname, '../../migrations-corredor');

// Aplica todos los .sql de un directorio, en orden alfabético, contra el
// pool que se le pase. No hay registro de migraciones aplicadas: cada
// archivo corre en CADA arranque, así que todos tienen que ser
// estrictamente idempotentes. Ojo con la trampa conocida:
// `CREATE TABLE IF NOT EXISTS` NO agrega columnas a una tabla que ya
// existe — cada columna posterior necesita su ALTER explícito.
async function aplicar(dir, destino, etiqueta) {
  if (!fs.existsSync(dir)) return 0;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await destino.query(sql);
    console.log(`[migrate${etiqueta}] aplicada ${file}`);
  }
  return files.length;
}

export async function runMigrations() {
  return aplicar(migrationsDir, pool, '');
}

// Migraciones del Corredor — base APARTE (ver lib/dbCorredor.js).
//
// A diferencia de runMigrations(), esta NO lanza: devuelve un estado. El
// arranque de index.js mata el proceso ante cualquier excepción, y el
// Corredor es un subsistema opcional — que su base no esté creada, o que
// una migración suya falle, no puede dejar sin backend a una empresa que
// solo usa la contabilidad de carbono. El problema se avisa fuerte y las
// rutas del Corredor responden 503 hasta que se arregle.
export async function runMigrationsCorredor() {
  if (!corredorDisponible()) {
    return { estado: 'apagado', motivo: 'sin DATABASE_URL_CORREDOR' };
  }
  try {
    const n = await aplicar(migrationsCorredorDir, poolCorredor(), ':corredor');
    return { estado: 'ok', archivos: n };
  } catch (err) {
    console.error(`[migrate:corredor] FALLÓ — las rutas del Corredor van a responder 503: ${err.message}`);
    return { estado: 'error', error: err.message };
  }
}

// Ejecutable directamente: `npm run migrate`
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(async () => {
      const c = await runMigrationsCorredor();
      console.log(`[migrate] corredor: ${c.estado}${c.motivo ? ` (${c.motivo})` : ''}`);
      console.log('[migrate] listo');
      return pool.end();
    })
    .catch((err) => {
      console.error('[migrate] error', err);
      process.exit(1);
    });
}
