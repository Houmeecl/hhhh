import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db.js';
import { corredorDisponible, poolCorredor } from './dbCorredor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '../../migrations');
const migrationsCorredorDir = path.resolve(__dirname, '../../migrations-corredor');

// ============================================================
// Registro de migraciones aplicadas.
//
// POR QUÉ EXISTE. Hasta el 01-09-2026 no había registro: cada `.sql`
// corría en CADA arranque. Eso obligaba a que todos fueran estrictamente
// idempotentes, y una que no lo era pasó desapercibida durante meses —tres
// migraciones re-imponían el CHECK de `secciones_admin` con listas
// congeladas en su época, así que **marcar la casilla «Cobros» en el panel
// dejaba el servidor sin arrancar en el siguiente despliegue**.
//
// `docs/FOCO-2026-2027.md` §3 pide: «No borrar ni reescribir migraciones
// históricas que hayan podido ejecutarse. Si una estructura deja de usarse,
// hacer una migración nueva.» Esa regla **supone un migrador con registro**:
// sin él, una migración vieja se sigue ejecutando para siempre y no hay
// migración nueva que la pueda corregir. Este archivo es lo que hace que la
// regla sea cierta en vez de un pedido de buena voluntad.
//
// EL SHA256 NO ES DECORACIÓN. Se guarda el hash del archivo aplicado, así
// que si alguien edita una migración ya ejecutada, el arranque lo DICE.
// Es la misma regla del §3, ahora comprobable: el registro no solo evita
// re-ejecutar, también delata que se reescribió historia.
// ============================================================

const TABLA = 'migraciones_aplicadas';

async function asegurarRegistro(cliente) {
  await cliente.query(`
    CREATE TABLE IF NOT EXISTS ${TABLA} (
      archivo     TEXT PRIMARY KEY,
      sha256      TEXT NOT NULL,
      aplicada_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
}

const sha = (texto) => crypto.createHash('sha256').update(texto, 'utf8').digest('hex');

// Aplica los .sql de un directorio en orden alfabético, UNA SOLA VEZ cada
// uno, contra el pool que se le pase.
//
// Cada archivo va en su propia transacción junto con su registro: si el SQL
// falla, no queda anotado y se reintenta en el próximo arranque. Anotar por
// fuera de la transacción dejaría migraciones «aplicadas» que en realidad
// reventaron a la mitad.
async function aplicar(dir, destino, etiqueta) {
  if (!fs.existsSync(dir)) return { aplicadas: 0, omitidas: 0, alteradas: [] };

  const cliente = await destino.connect();
  const resumen = { aplicadas: 0, omitidas: 0, alteradas: [] };
  try {
    await asegurarRegistro(cliente);
    const { rows } = await cliente.query(`SELECT archivo, sha256 FROM ${TABLA}`);
    const yaAplicadas = new Map(rows.map((r) => [r.archivo, r.sha256]));

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      const hash = sha(sql);
      const previo = yaAplicadas.get(file);

      if (previo) {
        resumen.omitidas += 1;
        // Se reescribió una migración ya ejecutada. NO se vuelve a correr
        // —eso es justo lo que el registro evita— pero se avisa fuerte,
        // porque significa que el archivo del repo y lo que hay en la base
        // dejaron de ser la misma cosa.
        if (previo !== hash) {
          resumen.alteradas.push(file);
          console.warn(
            `[migrate${etiqueta}] AVISO: ${file} cambió después de aplicarse. `
            + 'No se re-ejecuta. Si el cambio tiene que llegar a la base, va en una migración NUEVA '
            + '(docs/FOCO-2026-2027.md §3).'
          );
        }
        continue;
      }

      await cliente.query('BEGIN');
      try {
        await cliente.query(sql);
        await cliente.query(
          `INSERT INTO ${TABLA} (archivo, sha256) VALUES ($1, $2)`, [file, hash]
        );
        await cliente.query('COMMIT');
      } catch (err) {
        await cliente.query('ROLLBACK').catch(() => {});
        throw err;
      }
      resumen.aplicadas += 1;
      console.log(`[migrate${etiqueta}] aplicada ${file}`);
    }
  } finally {
    cliente.release();
  }

  if (resumen.omitidas) {
    console.log(`[migrate${etiqueta}] ${resumen.omitidas} ya estaban aplicadas`);
  }
  return resumen;
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
    const r = await aplicar(migrationsCorredorDir, poolCorredor(), ':corredor');
    return { estado: 'ok', archivos: r.aplicadas, ...r };
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
