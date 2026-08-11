import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'prelanzamiento.db'));
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS waitlist (
  id          TEXT PRIMARY KEY,
  empresa     TEXT,
  contacto    TEXT,
  email       TEXT UNIQUE NOT NULL,
  rubro       TEXT,
  tamano      TEXT,
  origen      TEXT,
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS codigos_piloto (
  codigo      TEXT PRIMARY KEY,
  usado       INTEGER NOT NULL DEFAULT 0,
  empresa     TEXT,
  usado_at    INTEGER
);
`);

export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);
export const uuid = () => crypto.randomUUID();

// Siembra N códigos de piloto (una sola vez). Devuelve el total.
export function seedCodigos(n = 100) {
  const count = get('SELECT count(*) AS n FROM codigos_piloto').n;
  if (count > 0) return count;
  const insert = db.prepare('INSERT INTO codigos_piloto (codigo) VALUES (?)');
  const usados = new Set();
  while (usados.size < n) {
    // Código legible: PILOTO-XXXX (sin caracteres ambiguos).
    const alfa = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 6; i++) s += alfa[crypto.randomInt(alfa.length)];
    usados.add(`PILOTO-${s}`);
  }
  for (const c of usados) insert.run(c);
  return n;
}
