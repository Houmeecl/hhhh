import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// La base vive en el propio dispositivo (pendrive). Aislada por dispositivo.
const dataDir = path.resolve(__dirname, '../data');
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'sicr3p.db');

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS dispositivo (
  id            TEXT PRIMARY KEY,
  rut           TEXT UNIQUE NOT NULL,
  dispositivo   TEXT,
  clave_hash    TEXT NOT NULL,   -- verificador scrypt
  clave_enc     TEXT NOT NULL,   -- clave SII cifrada (AES-256-GCM), "bajo código"
  intentos      INTEGER NOT NULL DEFAULT 0,
  bloqueado_hasta INTEGER,
  ultimo_login  INTEGER,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sesiones (
  id            TEXT PRIMARY KEY,
  rut_cliente   TEXT,
  nombre_cliente TEXT,
  email_cliente TEXT,
  fecha         TEXT NOT NULL,
  total_co2e    REAL NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS facturas (
  id            TEXT PRIMARY KEY,
  sesion_id     TEXT NOT NULL,
  numero_venta  TEXT,
  archivo_original TEXT,
  rut_emisor    TEXT,
  rut_receptor  TEXT,
  total_co2e    REAL NOT NULL DEFAULT 0,
  categoria     TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS line_items (
  id            TEXT PRIMARY KEY,
  factura_id    TEXT NOT NULL,
  descripcion   TEXT NOT NULL,
  cantidad      REAL NOT NULL DEFAULT 1,
  co2e          REAL NOT NULL DEFAULT 0,
  porcentaje_total REAL NOT NULL DEFAULT 0
);
`);

// Helpers finos sobre node:sqlite.
export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

// ¿Ya hay un dueño enrolado?
export const dueno = () => get('SELECT * FROM dispositivo LIMIT 1');
