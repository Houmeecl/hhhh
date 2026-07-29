#!/usr/bin/env node
// ============================================================
// sicr3p — Smoke test E2E post-deploy (lo corre actualizar.sh).
//
// Verifica que PRODUCCIÓN funcione de verdad después de un deploy,
// no solo que el proceso responda. Node puro, sin dependencias.
//
// Nivel LECTURA (siempre):
//   1. /api/health responde ok:true.
//   2. /api/publico/calculadora entrega tarifa > 0 y ≥1 categoría activa.
//   3. /api/publico/cadena: la cadena de integridad está INTACTA.
//   4. El frontend sirve la portada.
//   5. Si hay eslabones: la página pública /verificar del último documento
//      y su sello.svg responden.
//
// Nivel ESCRITURA (solo con SICR3P_SMOKE_ESCRITURA=1):
//   6. Sube el fixture de factura (PDF con texto) por el flujo público real
//      y exige motor='propio_texto'. OJO: deja una sesión real ENCADENADA
//      (la cadena no permite borrar) — por eso es opt-in y la empresa de la
//      sesión queda marcada "SMOKE TEST — sicr3p".
//
// Env: SICR3P_SMOKE_API (default http://localhost:4000/api)
//      SICR3P_SMOKE_FRONT (default https://sicr3p.cl/ — NO localhost: el
//        nginx del VPS solo sirve la portada bajo Host sicr3p.cl por HTTPS,
//        cualquier otro Host cae en el 404 fijo de Certbot para el puerto 80)
//      SICR3P_SMOKE_ESCRITURA=1 para el nivel de escritura.
// Salida: una línea por check; exit 0 si todo pasó, 1 si algo falló.
// ============================================================
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = (process.env.SICR3P_SMOKE_API || 'http://localhost:4000/api').replace(/\/$/, '');
const FRONT = (process.env.SICR3P_SMOKE_FRONT || 'https://sicr3p.cl/').replace(/\/$/, '');
const ESCRITURA = process.env.SICR3P_SMOKE_ESCRITURA === '1';
const TIMEOUT_MS = 10_000;

let fallas = 0;
const check = (nombre, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗ FALLA'} smoke: ${nombre}${extra ? ' — ' + extra : ''}`);
  if (!ok) fallas++;
};

// fetch con timeout duro: un deploy jamás debe quedar colgado esperando.
async function pedir(url, opciones = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opciones, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

// ---------- Nivel LECTURA ----------
try {
  const r = await pedir(`${API}/health`);
  const j = await r.json().catch(() => ({}));
  check('backend /health ok:true', r.ok && j.ok === true, `status=${r.status}`);
} catch (e) {
  check('backend /health ok:true', false, String(e.cause?.code || e.message));
}

try {
  const r = await pedir(`${API}/publico/calculadora`);
  const j = await r.json().catch(() => ({}));
  const tarifa = Number(j.tarifa_clp_tco2e ?? j.tarifa ?? 0);
  const nCat = Array.isArray(j.categorias) ? j.categorias.length : 0;
  check('calculadora: tarifa > 0 y categorías del motor activas', r.ok && tarifa > 0 && nCat >= 1,
    `tarifa=${tarifa} categorias=${nCat}`);
} catch (e) {
  check('calculadora: tarifa > 0 y categorías del motor activas', false, String(e.message));
}

let ultimoEslabon = null;
try {
  const r = await pedir(`${API}/publico/cadena`);
  const j = await r.json().catch(() => ({}));
  const intacta = j.estado?.intacta === true;
  const n = Number(j.estado?.n_eslabones ?? 0);
  // Con 0 eslabones (instalación nueva) la cadena vacía también es válida.
  check('cadena de integridad INTACTA', r.ok && (intacta || n === 0), `intacta=${j.estado?.intacta} eslabones=${n}`);
  ultimoEslabon = Array.isArray(j.eslabones) && j.eslabones.length ? j.eslabones[0] : null;
} catch (e) {
  check('cadena de integridad INTACTA', false, String(e.message));
}

try {
  const r = await pedir(FRONT + '/');
  const html = await r.text();
  check('frontend sirve la portada', r.ok && /sicr3p/i.test(html), `status=${r.status}`);
} catch (e) {
  check('frontend sirve la portada', false, String(e.message));
}

if (ultimoEslabon?.factura_id) {
  try {
    const r = await pedir(`${API}/verificar/${ultimoEslabon.factura_id}`);
    check('verificación pública del último documento', r.ok, `status=${r.status}`);
  } catch (e) {
    check('verificación pública del último documento', false, String(e.message));
  }
} else {
  console.log('· smoke: sin eslabones aún — se omiten los checks de verificación/sello (instalación nueva).');
}

// ---------- Nivel ESCRITURA (opt-in) ----------
if (ESCRITURA) {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const fixture = readFileSync(path.join(__dirname, '..', 'backend', 'test', 'fixtures', 'factura-texto.pdf'));
    const fd = new FormData();
    fd.append('rut', '76.123.456-0');
    fd.append('empresa', 'SMOKE TEST — sicr3p');
    fd.append('email', 'smoke@sicrep.cl');
    fd.append('archivos', new Blob([fixture], { type: 'application/pdf' }), 'smoke-factura.pdf');
    const r = await pedir(`${API}/sesiones`, { method: 'POST', body: fd });
    const j = await r.json().catch(() => ({}));
    const f = j.facturas?.[0];
    check('escritura: sesión smoke procesada con motor propio', r.status === 201 && f?.motor === 'propio_texto',
      `status=${r.status} motor=${f?.motor}`);
    if (f?.id) {
      const rv = await pedir(`${API}/verificar/${f.id}`);
      check('escritura: QR público del documento smoke responde', rv.ok, `status=${rv.status}`);
    }
    if (j.sesion?.id) {
      const rs = await pedir(`${API}/sesiones/${j.sesion.id}/sello.svg`);
      const esSvg = (rs.headers.get('content-type') || '').includes('svg');
      check('escritura: sello SVG de la sesión smoke responde', rs.ok && esSvg, `status=${rs.status}`);
    }
  } catch (e) {
    check('escritura: sesión smoke procesada con motor propio', false, String(e.message));
  }
} else {
  console.log('· smoke: nivel de escritura desactivado (SICR3P_SMOKE_ESCRITURA=1 para activarlo; deja una sesión real encadenada).');
}

console.log(fallas === 0 ? 'SMOKE OK' : `SMOKE: ${fallas} check(s) fallaron`);
process.exit(fallas === 0 ? 0 : 1);
