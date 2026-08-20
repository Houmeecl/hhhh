#!/usr/bin/env node
// ============================================================
// Revisa el registro de fuentes oficiales, y sella una cuando llega.
//
//   node scripts/verificar-fuentes.mjs
//     Revisa todas. Sale 0 si ninguna está ROTA; 1 si alguna lo está.
//     Las pendientes se listan pero NO hacen fallar: no verificado no es
//     un error, es un estado. Lo que sí es error es declararse verificado
//     sin poder demostrarlo.
//
//   node scripts/verificar-fuentes.mjs --sellar UE-2023-1115 archivo.pdf
//     Con el PDF ya guardado en docs/official/<PAIS>/, calcula su SHA-256
//     y pasa la fuente a 'verificada'. Después hay que commitear el PDF y
//     el manifiesto JUNTOS: separados, el hash del repo apunta a un
//     archivo que no está y la próxima corrida sale ROTA.
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { revisarFuentes, leerManifiesto } from '../src/services/fuentesOficiales.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, '..', '..', 'docs', 'official');
const MANIFIESTO = path.join(RAIZ, 'manifest.json');

const [modo, id, archivo] = process.argv.slice(2);

if (modo === '--sellar') {
  if (!id || !archivo) {
    console.error('Uso: node scripts/verificar-fuentes.mjs --sellar <id> <archivo.pdf>');
    process.exit(1);
  }
  const crudo = JSON.parse(fs.readFileSync(MANIFIESTO, 'utf8'));
  const f = (crudo.fuentes || []).find((x) => x.id === id);
  if (!f) {
    console.error(`No hay ninguna fuente con id "${id}" en el manifiesto. Agrégala primero.`);
    process.exit(1);
  }
  const ruta = path.join(RAIZ, f.pais, archivo);
  if (!fs.existsSync(ruta)) {
    console.error(`No está el archivo: ${path.relative(process.cwd(), ruta)}`);
    console.error('Bájalo primero desde:', f.sourceUrl);
    process.exit(1);
  }
  f.archivo = archivo;
  f.sha256 = crypto.createHash('sha256').update(fs.readFileSync(ruta)).digest('hex');
  f.retrievedAt = new Date().toISOString().slice(0, 10);
  f.estado = 'verificada';
  delete f.motivo;
  fs.writeFileSync(MANIFIESTO, `${JSON.stringify(crudo, null, 2)}\n`);
  console.log(`==> ${id} sellada.`);
  console.log(`    archivo: ${f.pais}/${archivo}`);
  console.log(`    sha256:  ${f.sha256}`);
  console.log('');
  console.log('    Commitea el PDF y el manifiesto en el MISMO commit.');
  process.exit(0);
}

const r = revisarFuentes();
const total = r.total;

console.log(`Fuentes oficiales: ${total} · verificadas ${r.verificadas.length} · pendientes ${r.pendientes.length} · rotas ${r.rotas.length}`);
console.log('');

for (const f of r.verificadas) console.log(`  [verificada] ${f.id} — ${f.titulo}`);
for (const f of r.pendientes) {
  console.log(`  [pendiente ] ${f.id} — ${f.titulo}`);
  console.log(`               ${f.motivo}`);
}
for (const f of r.rotas) {
  console.log(`  [ROTA      ] ${f.id} — ${f.problema}`);
}

if (!r.ok) {
  console.log('');
  console.error(`${r.codigo}: hay ${r.rotas.length} fuente(s) rota(s). El manifiesto afirma algo que el disco no respalda.`);
  process.exit(1);
}

if (r.pendientes.length) {
  console.log('');
  console.log('Ninguna rota. Las pendientes no bloquean: lo que no se puede hacer es');
  console.log('citarlas como verificadas mientras estén así.');
}
process.exit(0);
