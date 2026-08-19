#!/usr/bin/env node
// ============================================================
// Lista los documentos duplicados que YA están en la base.
//
// POR QUÉ EXISTE. Hasta la migración 104 nada impedía que el mismo
// documento entrara dos veces: el sha256 se calculaba, se guardaba y
// nunca se consultaba. Cada duplicado infló el CO2e de su cliente y dejó
// un eslabón de más en la cadena de hash.
//
// Desde la 104 no entran duplicados nuevos. Este script muestra los
// viejos — y SOLO los muestra: no borra nada. Borrar una factura sellada
// rompe la cadena y es una decisión humana, no algo que deba pasar dentro
// de un script.
//
// Uso EN EL VPS:  cd /opt/sicr3p/backend && node scripts/duplicados.mjs
// Hace solo lecturas.
// ============================================================
import { query, pool } from '../src/lib/db.js';

const nf = (n) => Number(n || 0).toLocaleString('es-CL', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

// 1) Mismo archivo, byte por byte.
const { rows: porSha } = await query(`
  SELECT f.sha256, count(*)::int AS n, sum(f.total_co2e) AS co2e_total,
         min(f.total_co2e) AS co2e_unitario,
         array_agg(DISTINCT s.nombre_cliente) AS empresas,
         array_agg(f.archivo_original ORDER BY f.created_at) AS archivos,
         array_agg(f.eslabon ORDER BY f.created_at) AS eslabones
    FROM facturas f JOIN sesiones s ON s.id = f.sesion_id
   WHERE f.sha256 IS NOT NULL
   GROUP BY f.sha256 HAVING count(*) > 1
   ORDER BY sum(f.total_co2e) DESC`);

// 2) Mismo documento tributario (solo donde hay folio: lo histórico no lo tiene).
const { rows: porDte } = await query(`
  SELECT f.rut_emisor, f.tipo_dte, f.folio, count(*)::int AS n,
         sum(f.total_co2e) AS co2e_total,
         array_agg(DISTINCT s.nombre_cliente) AS empresas
    FROM facturas f JOIN sesiones s ON s.id = f.sesion_id
   WHERE f.rut_emisor IS NOT NULL AND f.tipo_dte IS NOT NULL AND f.folio IS NOT NULL
   GROUP BY f.rut_emisor, f.tipo_dte, f.folio HAVING count(*) > 1
   ORDER BY sum(f.total_co2e) DESC`);

const { rows: [tot] } = await query(`SELECT count(*)::int AS n FROM facturas`);

console.log(`\n  ${tot.n} facturas en total.\n`);

if (!porSha.length && !porDte.length) {
  console.log('  Sin duplicados. La base está limpia.\n');
  console.log('  Con esto se pueden promover los índices de la migración 104 a UNIQUE');
  console.log('  (ver el comentario de esa migración).\n');
} else {
  if (porSha.length) {
    console.log(`  ── MISMO ARCHIVO (${porSha.length} caso${porSha.length === 1 ? '' : 's'}) ──\n`);
    for (const d of porSha) {
      // El exceso es lo que sobra: n copias aportaron n×co2e donde debía
      // aportar 1×co2e.
      const exceso = Number(d.co2e_total) - Number(d.co2e_unitario);
      console.log(`  ${d.sha256.slice(0, 16)}… · ${d.n} copias · ${d.empresas.join(', ')}`);
      console.log(`     archivos : ${d.archivos.join(' | ')}`);
      console.log(`     eslabones: ${d.eslabones.join(', ')}`);
      console.log(`     CO2e contado: ${nf(d.co2e_total)} t — sobra ${nf(exceso)} t\n`);
    }
  }
  if (porDte.length) {
    console.log(`  ── MISMO DOCUMENTO TRIBUTARIO (${porDte.length}) ──\n`);
    for (const d of porDte) {
      console.log(`  DTE ${d.tipo_dte} folio ${d.folio} de ${d.rut_emisor} · ${d.n} veces`);
      console.log(`     ${d.empresas.join(', ')} · CO2e contado: ${nf(d.co2e_total)} t\n`);
    }
  }
  console.log('  QUÉ HACER. Cada uno de estos infló el total de su cliente. Corregirlo');
  console.log('  exige decidir caso a caso: las facturas están encadenadas por hash, así');
  console.log('  que borrarlas rompe la cadena. La vía limpia es un ajuste de');
  console.log('  reclasificación (migración 079), que anula el efecto SIN tocar el');
  console.log('  eslabón sellado — igual que se corrige una categoría mal puesta.\n');
}

await pool.end();
