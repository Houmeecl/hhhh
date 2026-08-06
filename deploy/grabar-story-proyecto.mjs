#!/usr/bin/env node
// ============================================================
// sicr3p — Grabación REAL (Playwright) del video story del proyecto
// completo, en DOS formatos: horizontal 1280×720 y vertical 720×1280
// (viewport móvil real 360×640 — el sitio es responsive; el corte
// vertical NO es un recorte del horizontal, se graba aparte).
//
// Guion: docs/comercial/guion-video-proyecto.md. Todo lo que aparece
// en pantalla es la app real corriendo (frontend :5173 + backend :4000
// + Postgres): el CO2e del resultado lo calcula el motor en vivo.
//
// Cada sesión de navegador se
// mantiene corta (<60 s) y se VERIFICA después de grabar (peso de un
// frame en un punto donde se sabe qué pantalla debe verse; una pantalla
// "congelada" en un estado anterior pesa mucho menos) — si falla, esa
// sesión se regraba desde cero hasta MAX_INTENTOS.
//
// Salida:
//   - docs/video/raw/story-*.webm       (crudos por sesión/formato)
//   - docs/video/raw/escenas-story.json (tiempos reales + subtítulos +
//     datos reales, para deploy/render-story-proyecto.mjs)
//
// Uso: node deploy/grabar-story-proyecto.mjs
// Variables:
//   FRONT_URL      (default http://localhost:5173)
//   XML_DTE        ruta del XML a cargar en /cargar (obligatoria si no
//                  existe el default de la sesión de trabajo)
//   LOTE_EXPEDIENTE codigo del lote documental con documentos+semáforo
//   LOTE_TORRE      codigo del lote de la flota demo (POST demo-torre)
//   TORRE_SERIAL / TORRE_CLAVE  credenciales del terminal torre demo
// ============================================================
import { mkdir, writeFile, stat, unlink } from 'node:fs/promises';
import { statSync, unlinkSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const RAW_DIR = path.join(REPO_ROOT, 'docs', 'video', 'raw');

const FRONT = (process.env.FRONT_URL || 'http://localhost:5173').replace(/\/$/, '');
const XML_PATH = process.env.XML_DTE
  || '/tmp/claude-0/-home-user-hhhh/38638fff-a633-59e6-92b7-2ef56c95eaec/scratchpad/dte-demo.xml';
const LOTE_EXPEDIENTE = process.env.LOTE_EXPEDIENTE || 'LM-2026-000012';
const LOTE_TORRE = process.env.LOTE_TORRE || '';
const TORRE_SERIAL = process.env.TORRE_SERIAL || '';
const TORRE_CLAVE = process.env.TORRE_CLAVE || '';

const CHROMIUM_EXECUTABLE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DESKTOP = { width: 1280, height: 720 };
// Vertical: viewport = tamaño de video. recordVideo NO escala hacia
// arriba (un viewport menor queda en una esquina con relleno gris), así
// que se graba directo a 720×1280 — el sitio es responsive y a este
// ancho el layout sigue siendo de columna única.
const MOBILE_VIEWPORT = { width: 720, height: 1280 };
const MOBILE_VIDEO = { width: 720, height: 1280 };
const MAX_INTENTOS = 3;

const CLIENTE = {
  rut: '77.665.544-9',
  empresa: 'Comercial Andina Ltda',
  email: 'demo.proyecto@sicrep.cl',
};

async function resolvePlaywright() {
  for (const spec of ['playwright-core', 'playwright']) {
    try {
      const mod = await import(spec);
      if (mod?.chromium) return mod;
    } catch { /* siguiente */ }
  }
  const mod = await import('/opt/node22/lib/node_modules/playwright/index.mjs');
  if (!mod?.chromium) throw new Error('No se encontró un playwright utilizable.');
  return mod;
}

const fmtCo2e = (n) => Number(n || 0).toLocaleString('es-CL', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

function tamanoFrameEn(videoPath, segundos) {
  const tmp = path.join(RAW_DIR, `_check_${process.pid}_${Date.now()}_${Math.round(Math.random() * 1e6)}.png`);
  try {
    execFileSync('ffmpeg', ['-y', '-ss', String(segundos), '-i', videoPath, '-frames:v', '1', tmp], { stdio: 'ignore' });
    return statSync(tmp).size;
  } finally {
    try { unlinkSync(tmp); } catch { /* noop */ }
  }
}

function verificarVideo(videoPath, checks) {
  for (const c of checks) {
    const sz = tamanoFrameEn(videoPath, c.segundos);
    console.log(`   verificación: frame t=${c.segundos}s de ${path.basename(videoPath)} = ${sz} B (mín ${c.minBytes}) — ${c.label}`);
    if (sz < c.minBytes) {
      return { ok: false, motivo: `${c.label}: frame en t=${c.segundos}s demasiado liviano (${sz} < ${c.minBytes})` };
    }
  }
  return { ok: true };
}

// Envuelve una sesión de grabación con verificación + reintento.
async function conReintento(nombre, checksDe, grabarFn) {
  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    console.log(`\n=== ${nombre} (intento ${intento}/${MAX_INTENTOS}) ===`);
    const r = await grabarFn(intento);
    const chk = verificarVideo(r.videoPath, checksDe(r));
    if (chk.ok) { console.log(`✓ ${nombre} válida: ${r.videoPath}`); return r; }
    console.log(`   ✗ ${chk.motivo} — regrabando con navegador nuevo...`);
    await unlink(r.videoPath).catch(() => {});
  }
  throw new Error(`${nombre}: sin grabación válida tras ${MAX_INTENTOS} intentos.`);
}

// Crea contexto+page con helpers de escena; devuelve utilidades comunes.
async function abrirSesion(browser, viewport, videoSize) {
  const ctx = await browser.newContext({ viewport, recordVideo: { dir: RAW_DIR, size: videoSize } });
  const page = await ctx.newPage();
  const t0 = Date.now();
  const scenes = [];
  async function idle(ms) {
    let left = ms;
    while (left > 0) { const c = Math.min(1500, left); await page.waitForTimeout(c); left -= c; }
  }
  async function escena(id, titulo, subtitles, targetMs, fn) {
    const start = Date.now() - t0;
    console.log(`▶ Escena ${id} — ${titulo}`);
    const before = Date.now();
    await fn();
    const elapsed = Date.now() - before;
    if (elapsed < targetMs) await idle(targetMs - elapsed);
    const end = Date.now() - t0;
    scenes.push({ id, titulo, start, end, subtitles });
    console.log(`   duración real: ${((end - start) / 1000).toFixed(1)}s (objetivo ${(targetMs / 1000).toFixed(1)}s)`);
  }
  async function cerrar() {
    const video = page.video();
    await ctx.close();
    return { videoPath: await video.path(), scenes };
  }
  return { page, idle, escena, cerrar };
}

// ---------- Acciones reutilizadas entre formatos ----------
async function accionLanding(page, idle, pasos = 6) {
  await page.goto(`${FRONT}/`, { waitUntil: 'load' });
  await page.waitForSelector('text=sicr3p', { timeout: 15000 });
  await idle(1800);
  for (let i = 0; i < pasos; i++) { await page.mouse.wheel(0, 380); await idle(600); }
}

async function accionCargar(page, idle, delayTexto) {
  // /cargar exige un código de acceso (uso real): la grabación lo deja en
  // sessionStorage vía SICR3P_STORY_CODIGO antes de navegar; sin él, la
  // página redirige a /prueba y esta escena saldría vacía.
  if (process.env.SICR3P_STORY_CODIGO) {
    await page.addInitScript((c) => sessionStorage.setItem('sicr3p_codigo', c), process.env.SICR3P_STORY_CODIGO);
  }
  await page.goto(`${FRONT}/cargar`, { waitUntil: 'load' });
  await page.waitForSelector('input[placeholder="76.123.456-7"]');
  await idle(900);
  const rut = page.locator('input[placeholder="76.123.456-7"]');
  const empresa = page.locator('input[placeholder="Mi Empresa SpA"]');
  const email = page.locator('input[placeholder="contacto@empresa.cl"]');
  await rut.click(); await rut.pressSequentially(CLIENTE.rut, { delay: delayTexto });
  await empresa.click(); await empresa.pressSequentially(CLIENTE.empresa, { delay: Math.round(delayTexto * 0.6) });
  await email.click(); await email.pressSequentially(CLIENTE.email, { delay: Math.round(delayTexto * 0.6) });
  await idle(500);
  // Desktop muestra "Seleccionar archivos"; móvil, "Elegir archivos".
  const btnSel = page.locator('button:has-text("Seleccionar archivos")');
  const btnArchivo = (await btnSel.isVisible().catch(() => false))
    ? btnSel
    : page.locator('button:has-text("Elegir archivos")');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    btnArchivo.click(),
  ]);
  await chooser.setFiles(XML_PATH);
  await idle(1200);
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/sesiones') && r.request().method() === 'POST', { timeout: 60000 }),
    page.locator('button.btn-primary:has-text("Procesar 1 factura")').click(),
  ]);
  const data = await resp.json();
  // La secuencia de envío + redirección a /resultado/:id corren solas.
  await page.waitForURL('**/resultado/**', { timeout: 30000 });
  return data;
}

async function main() {
  await mkdir(RAW_DIR, { recursive: true });
  if (!existsSync(XML_PATH)) throw new Error(`No existe el XML a cargar: ${XML_PATH} (define XML_DTE).`);
  if (!TORRE_SERIAL || !TORRE_CLAVE || !LOTE_TORRE) {
    throw new Error('Faltan TORRE_SERIAL / TORRE_CLAVE / LOTE_TORRE (salida de POST /api/admin/origen/demo-torre).');
  }

  console.log('sicr3p — grabación del video story (16:9 + 9:16)');
  console.log(`Frontend: ${FRONT}\nXML: ${XML_PATH}\nExpediente: ${LOTE_EXPEDIENTE}\nTorre: ${LOTE_TORRE} (${TORRE_SERIAL})`);

  const { chromium } = await resolvePlaywright();
  const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM_EXECUTABLE });

  let sesionHorizontal = null;

  // ========================================================
  // Horizontal — Sesión D1: E1 landing + E2 cargar/resultado + E3 verificar
  // Línea de tiempo objetivo: E1 0-18 s, E2 18-43 s, E3 43-58 s.
  // ========================================================
  const d1 = await conReintento('Horizontal D1', () => [
    { segundos: 40, minBytes: 110000, label: 'E2 resultado visible' },
    { segundos: 52, minBytes: 110000, label: 'E3 verificación visible' },
  ], async () => {
    const s = await abrirSesion(browser, DESKTOP, DESKTOP);
    const { page, idle, escena, cerrar } = s;
    let data = null;

    await escena(1, 'Qué es (landing real)', [
      'sicr3p lee tus documentos reales — facturas, PDF, fotos.',
      'Calcula tu CO2e con factores que citan su fuente.',
      'Y sella cada registro en una cadena de integridad pública.',
    ], 18000, async () => { await accionLanding(page, idle, 6); });

    await escena(2, 'Contabilidad de carbono en vivo', [
      'Cargas el documento. Nada se digita a mano.',
      'La plataforma lo lee y clasifica cada ítem.',
      'El CO2e que ves lo calculó el motor recién, con este documento.',
    ], 25000, async () => { data = await accionCargar(page, idle, 45); await idle(1500); });

    const totalCo2e = Number(data?.sesion?.total_co2e ?? 0);
    console.log(`   >>> t CO2e real (horizontal): ${totalCo2e}`);

    await escena(3, 'Verificación del trámite + REP', [
      'Cada trámite queda sellado: hash, eslabón, cadena.',
      'Con la declaración REP (Ley 20.920) cuando corresponde.',
    ], 15000, async () => {
      await page.goto(`${FRONT}/verificar/${data.sesion.id}`, { waitUntil: 'load' });
      await page.waitForSelector('text=Verificaci', { timeout: 15000 }).catch(() => {});
      await idle(2500);
      await page.mouse.wheel(0, 420); await idle(900);
      await page.mouse.wheel(0, 420);
    });

    const fin = await cerrar();
    return { videoPath: fin.videoPath, scenes: fin.scenes, data, totalCo2e };
  });
  sesionHorizontal = d1;

  // ========================================================
  // Horizontal — Sesión D2: E4 lote + E5 torre + E7 cadena
  // Línea de tiempo objetivo: E4 0-15 s, E5 15-32 s, E7 32-44 s.
  // (Sin check de peso en la torre: si las teselas del mapa no cargan en
  // este entorno, el frame es liviano aunque la pantalla esté bien.)
  // ========================================================
  const d2 = await conReintento('Horizontal D2', () => [
    { segundos: 8, minBytes: 110000, label: 'E4 expediente visible' },
    { segundos: 40, minBytes: 90000, label: 'E7 cadena visible' },
  ], async () => {
    const s = await abrirSesion(browser, DESKTOP, DESKTOP);
    const { page, idle, escena, cerrar } = s;

    await escena(4, 'Pasaporte de Origen y expediente del Corredor', [
      'Para carga que cruza fronteras: el Corredor Bioceánico.',
      'Expediente documental completo, con semáforo de completitud.',
      'Los archivos siguen privados; el estado es público.',
    ], 15000, async () => {
      await page.goto(`${FRONT}/lote/${LOTE_EXPEDIENTE}`, { waitUntil: 'load' });
      await page.waitForSelector(`text=${LOTE_EXPEDIENTE}`, { timeout: 15000 });
      await idle(2200);
      for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, 380); await idle(700); }
    });

    await escena(5, 'Torre de control', [
      'La torre de control sigue cada camión, paso a paso.',
      'Cada paso queda sellado en la cadena del lote.',
    ], 17000, async () => {
      await page.goto(`${FRONT}/torre/${LOTE_TORRE}`, { waitUntil: 'load' });
      const serial = page.locator('input[placeholder="AV-XXXX"]');
      await serial.waitFor({ timeout: 15000 });
      await serial.click(); await serial.pressSequentially(TORRE_SERIAL, { delay: 60 });
      const clave = page.locator('input[type="password"]');
      await clave.click(); await clave.pressSequentially(TORRE_CLAVE, { delay: 40 });
      await page.locator('button:has-text("Ingresar")').click();
      await idle(2500);
      // Las teselas del mapa (OSM) no cargan en este entorno sin salida
      // directa a internet — se muestra lo que sí es el corazón de la
      // torre: los pasos sellados en la cadena y el panel del operador.
      await page.mouse.wheel(0, 480);
      await idle(1200);
    });

    await escena(7, 'Nada pide confianza', [
      'Nada de esto pide que confíes en nuestra palabra.',
      'La cadena completa es pública: cualquiera la puede recorrer.',
    ], 12000, async () => {
      await page.goto(`${FRONT}/cadena`, { waitUntil: 'load' });
      await idle(2500);
      await page.mouse.wheel(0, 420); await idle(900);
      await page.mouse.wheel(0, 420);
    });

    const fin = await cerrar();
    return { videoPath: fin.videoPath, scenes: fin.scenes };
  });

  // ========================================================
  // Vertical — Sesión M (una sola, ~52 s): landing + cargar + lote + cadena
  // Línea de tiempo objetivo: M1 0-12, M2 12-34, M4 34-46, M7 46-54.
  // ========================================================
  const m = await conReintento('Vertical M', () => [
    { segundos: 30, minBytes: 60000, label: 'M2 resultado visible' },
    { segundos: 42, minBytes: 60000, label: 'M4 expediente visible' },
  ], async () => {
    const s = await abrirSesion(browser, MOBILE_VIEWPORT, MOBILE_VIDEO);
    const { page, idle, escena, cerrar } = s;
    let data = null;

    await escena('M1', 'Qué es (landing móvil)', [
      'sicr3p lee tus documentos reales.',
      'Calcula tu CO2e. Sella la evidencia.',
    ], 12000, async () => { await accionLanding(page, idle, 4); });

    await escena('M2', 'Cálculo en vivo', [
      'Cargas el documento.',
      'El CO2e lo calcula el motor, recién.',
    ], 22000, async () => { data = await accionCargar(page, idle, 30); await idle(1200); });

    const totalCo2e = Number(data?.sesion?.total_co2e ?? 0);
    console.log(`   >>> t CO2e real (vertical): ${totalCo2e}`);

    await escena('M4', 'Expediente del Corredor', [
      'Carga que cruza fronteras:',
      'expediente completo, semáforo público.',
    ], 12000, async () => {
      await page.goto(`${FRONT}/lote/${LOTE_EXPEDIENTE}`, { waitUntil: 'load' });
      await page.waitForSelector(`text=${LOTE_EXPEDIENTE}`, { timeout: 15000 });
      await idle(1800);
      for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 420); await idle(650); }
    });

    await escena('M7', 'Cadena pública', [
      'Todo se comprueba, sin cuenta.',
    ], 8000, async () => {
      await page.goto(`${FRONT}/cadena`, { waitUntil: 'load' });
      await idle(2200);
      await page.mouse.wheel(0, 420);
    });

    const fin = await cerrar();
    return { videoPath: fin.videoPath, scenes: fin.scenes, totalCo2e };
  });

  await browser.close();

  // Mismo XML → el motor es determinista: ambos formatos deben mostrar
  // el mismo CO2e. Si difiere, algo se leyó mal — no se publica.
  if (Math.abs(m.totalCo2e - sesionHorizontal.totalCo2e) > 1e-9) {
    throw new Error(`CO2e distinto entre formatos (16:9=${sesionHorizontal.totalCo2e}, 9:16=${m.totalCo2e}).`);
  }

  for (const vp of [d1.videoPath, d2.videoPath, m.videoPath]) {
    const st = await stat(vp).catch(() => null);
    if (!st || st.size === 0) throw new Error(`Un .webm quedó vacío: ${vp}`);
    console.log(`Tamaño ${path.basename(vp)}: ${(st.size / 1024 / 1024).toFixed(2)} MB`);
  }

  const meta = {
    generadoEn: new Date().toISOString(),
    frontend: FRONT,
    totalCo2eReal: sesionHorizontal.totalCo2e,
    co2eTexto: `${fmtCo2e(sesionHorizontal.totalCo2e)} t CO2e`,
    loteExpediente: LOTE_EXPEDIENTE,
    loteTorre: LOTE_TORRE,
    horizontal: [
      { videoPath: d1.videoPath, trimStartMs: 0, scenes: d1.scenes },
      { videoPath: d2.videoPath, trimStartMs: 0, scenes: d2.scenes },
    ],
    vertical: [
      { videoPath: m.videoPath, trimStartMs: 0, scenes: m.scenes },
    ],
  };
  const metaPath = path.join(RAW_DIR, 'escenas-story.json');
  await writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
  console.log(`\nMetadatos: ${metaPath}\nSiguiente paso: node deploy/render-story-proyecto.mjs`);
}

main().catch((e) => { console.error(e); process.exit(1); });
