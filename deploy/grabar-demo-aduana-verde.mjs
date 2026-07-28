#!/usr/bin/env node
// ============================================================
// sicr3p — Grabación REAL (Playwright) del mostrador presencial de sicr3p.
//
// Recorre con un navegador real la app real ya levantada (frontend Vite
// en :5173, backend en :4000, Postgres con seed ya aplicado) siguiendo el
// guion de docs/comercial/guion-video-aduana-verde.md. No es una animación
// ni un mockup: cada clic, cada carga de archivo y cada número que se ve
// en pantalla (incluido el t CO2e) los produce la app real en vivo.
//
// Por qué dos sesiones de navegador (dos .webm) + verificación con
// reintento: en este entorno, una grabación continua de Chromium headless
// de más de ~1 minuto puede (de forma intermitente, no siempre) mostrar un
// artefacto del pipeline de video: durante un tramo el .webm queda
// "pegado" mostrando la pantalla anterior aunque la app ya avanzó, y
// después salta de golpe. La app real y sus tiempos son idénticos en
// todos los casos — es puramente un límite de la técnica de grabación en
// este entorno, e intermitente (no siempre ocurre). Por eso:
//   1. El recorrido se graba en DOS sesiones de navegador más cortas:
//      Sesión A = Escenas 1-6, Sesión B = repetición rápida (recortada
//      del video final) + Escenas 7-10.
//   2. Cada sesión se VERIFICA después de grabarse (se mide el tamaño de
//      un frame real en un punto donde se sabe qué pantalla debería estar
//      visible; una pantalla "congelada" en la anterior da un frame mucho
//      más liviano que el esperado) y, si la verificación falla, esa
//      sesión se vuelve a grabar desde cero (navegador nuevo) hasta un
//      máximo de intentos — nunca se conserva un video con el artefacto.
//
// Salida:
//   - docs/video/raw/*.webm               (videos crudos de Playwright)
//   - docs/video/raw/escenas.json         (metadatos: tiempos reales de
//     cada escena + subtítulos + datos reales capturados, para que
//     render-demo-aduana-verde.mjs arme el video final con esos tiempos)
//
// OBSOLETO (2026-07-28): graba /aduana-verde, que ya no existe — esa ruta
// redirige a "/" y las secciones que este guion busca se plegaron en la
// portada. Se conserva como referencia del pipeline de grabación; para un
// video nuevo hay que reescribir las escenas contra la portada actual. El
// video ya producido sigue en docs/video/aduana-verde-demo.mp4.
//
// Uso: node deploy/grabar-demo-aduana-verde.mjs
// Variables opcionales:
//   FRONT_URL   (default http://localhost:5173)
//   XML_DTE     (default el fixture indicado en la tarea)
// ============================================================
import { mkdir, writeFile, readdir, stat, unlink } from 'node:fs/promises';
import { statSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const RAW_DIR = path.join(REPO_ROOT, 'docs', 'video', 'raw');

const FRONT = (process.env.FRONT_URL || 'http://localhost:5173').replace(/\/$/, '');
const XML_PATH = process.env.XML_DTE
  || '/tmp/claude-0/-home-user-hhhh/38638fff-a633-59e6-92b7-2ef56c95eaec/scratchpad/dte-real.xml';

// Chromium empaquetado en este entorno (revisión que espera el Playwright
// instalado globalmente). Se pasa explícito para no depender de que el
// paquete resuelto coincida en versión con el navegador descargado.
const CHROMIUM_EXECUTABLE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const VIDEO_SIZE = { width: 1280, height: 720 };
const MAX_INTENTOS = 3;

// ---------- Resolver el paquete playwright disponible en este entorno ----------
async function resolvePlaywright() {
  for (const spec of ['playwright-core', 'playwright']) {
    try {
      const mod = await import(spec);
      if (mod?.chromium) return mod;
    } catch { /* no resoluble desde aquí — se intenta el siguiente */ }
  }
  const GLOBAL_PW = '/opt/node22/lib/node_modules/playwright/index.mjs';
  const mod = await import(GLOBAL_PW);
  if (!mod?.chromium) throw new Error('No se encontró un playwright utilizable (ni local ni global).');
  return mod;
}

const fmtCo2e = (n) => Number(n || 0).toLocaleString('es-CL', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

const CLIENTE = {
  rut: '11.111.111-1',
  empresa: 'Cliente Prueba E2E SpA',
  email: 'demo@sicrep.cl',
};

// ---------- Verificación post-grabación: ¿el video real quedó "pegado"? ----------
// Extrae UN frame real del .webm en el segundo indicado y devuelve su
// tamaño en bytes. Una pantalla con contenido (tabla, tarjeta con datos)
// pesa mucho más como PNG que una pantalla de carga/spinner casi en
// blanco — es la misma señal que se usó para diagnosticar el problema a
// mano, ahora automatizada.
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
    console.log(`   verificación: frame en t=${c.segundos}s de ${path.basename(videoPath)} = ${sz} bytes (mínimo ${c.minBytes}) — ${c.label}`);
    if (sz < c.minBytes) {
      return { ok: false, motivo: `${c.label}: frame en t=${c.segundos}s demasiado liviano (${sz} < ${c.minBytes} bytes) — probable congelamiento del video en esa escena` };
    }
  }
  return { ok: true };
}

async function main() {
  await mkdir(RAW_DIR, { recursive: true });

  console.log('sicr3p — grabación real del mostrador');
  console.log(`Frontend: ${FRONT}`);
  console.log(`Documento DTE: ${XML_PATH}`);

  const { chromium } = await resolvePlaywright();
  const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM_EXECUTABLE });

  // ========================================================
  // Sesión A — Escenas 1 a 6 (con reintento si la verificación falla)
  // ========================================================
  let resultadoA = null;
  for (let intento = 1; intento <= MAX_INTENTOS && !resultadoA; intento++) {
    console.log(`\n=== Sesión A (intento ${intento}/${MAX_INTENTOS}): Escenas 1-6 ===`);
    const r = await grabarSesionA(browser, intento);
    // Verificación: t=50s debería estar ya en la Escena 5 (Resultado, con
    // tabla — pantalla "pesada"); t=90s debería estar en la Escena 6
    // (Cobro, también con contenido). Si alguna pesa como pantalla de
    // carga casi en blanco, la sesión quedó con el artefacto de video.
    const chk = verificarVideo(r.videoA, [
      { segundos: 50, minBytes: 130000, label: 'Escena 5 (Resultado) visible' },
      { segundos: 90, minBytes: 130000, label: 'Escena 6 (Cobro) visible' },
    ]);
    if (chk.ok) {
      resultadoA = r;
    } else {
      console.log(`   ✗ verificación falló: ${chk.motivo}`);
      console.log('   descartando este video y reintentando la Sesión A con un navegador nuevo...');
      await unlink(r.videoA).catch(() => {});
    }
  }
  if (!resultadoA) throw new Error(`Sesión A: no se logró una grabación válida tras ${MAX_INTENTOS} intentos.`);
  console.log(`\n✓ Sesión A válida: ${resultadoA.videoA}`);

  // ========================================================
  // Sesión B — repetición rápida (recortada) + Escenas 7 a 10
  // ========================================================
  let resultadoB = null;
  for (let intento = 1; intento <= MAX_INTENTOS && !resultadoB; intento++) {
    console.log(`\n=== Sesión B (intento ${intento}/${MAX_INTENTOS}): repetición rápida + Escenas 7-10 ===`);
    const r = await grabarSesionB(browser, intento, resultadoA.totalCo2e);
    // Verificación: unos segundos después de terminar la repetición rápida
    // (trimStartMs) debería verse ya el comprobante (pantalla con QR,
    // "pesada"); bien entrada la Escena 8 debería verse el Pasaporte
    // Digital (también con contenido).
    const tComprobante = (r.trimStartMs / 1000) + 4;
    const chk = verificarVideo(r.videoB, [
      { segundos: tComprobante, minBytes: 130000, label: 'Escena 7 (Comprobante) visible' },
      { segundos: (r.trimStartMs / 1000) + 25, minBytes: 130000, label: 'Escena 8 (Pasaporte Digital) visible' },
    ]);
    if (chk.ok) {
      resultadoB = r;
    } else {
      console.log(`   ✗ verificación falló: ${chk.motivo}`);
      console.log('   descartando este video y reintentando la Sesión B con un navegador nuevo...');
      await unlink(r.videoB).catch(() => {});
    }
  }
  if (!resultadoB) throw new Error(`Sesión B: no se logró una grabación válida tras ${MAX_INTENTOS} intentos.`);
  console.log(`\n✓ Sesión B válida: ${resultadoB.videoB}`);

  await browser.close();

  // El t CO2e debe ser el mismo en A y B (mismo XML, motor determinista) —
  // nunca se muestra un número que no cuadre entre ambas sesiones.
  if (Math.abs(resultadoB.totalCo2e - resultadoA.totalCo2e) > 1e-9) {
    throw new Error(`El motor calculó un t CO2e distinto entre sesiones (A=${resultadoA.totalCo2e} B=${resultadoB.totalCo2e}).`);
  }

  // ---------- Verificación de tamaño de archivo y metadatos ----------
  for (const vp of [resultadoA.videoA, resultadoB.videoB]) {
    const st = await stat(vp).catch(() => null);
    if (!st || st.size === 0) {
      const files = await readdir(RAW_DIR).catch(() => []);
      throw new Error(`Un .webm no quedó escrito o está vacío (${vp}). Archivos en raw/: ${files.join(', ')}`);
    }
    console.log(`Tamaño de ${path.basename(vp)}: ${(st.size / 1024 / 1024).toFixed(2)} MB`);
  }

  const meta = {
    generadoEn: new Date().toISOString(),
    frontend: FRONT,
    docId: resultadoB.docId,
    totalCo2eReal: resultadoA.totalCo2e,
    sesion: resultadoA.sesionData?.sesion
      ? { id: resultadoA.sesionData.sesion.id, total_co2e: resultadoA.sesionData.sesion.total_co2e }
      : null,
    videos: [
      { videoPath: resultadoA.videoA, trimStartMs: 0, scenes: resultadoA.scenesA },
      { videoPath: resultadoB.videoB, trimStartMs: resultadoB.trimStartMs, scenes: resultadoB.scenesB },
    ],
  };
  const metaPath = path.join(RAW_DIR, 'escenas.json');
  await writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
  console.log(`\nMetadatos de escenas escritos en: ${metaPath}`);
  console.log('\nGrabación real completa. Siguiente paso: deploy/render-demo-aduana-verde.sh');
}

// ============================================================
// Sesión A: Escenas 1-6 (Landing → Cliente → Captura → Resultado → Cobro)
// ============================================================
async function grabarSesionA(browser, intentoNum) {
  const ctx = await browser.newContext({ viewport: VIDEO_SIZE, recordVideo: { dir: RAW_DIR, size: VIDEO_SIZE } });
  const page = await ctx.newPage();
  const t0 = Date.now();
  const scenes = [];
  let sesionData = null;

  async function idle(ms) {
    let left = ms;
    while (left > 0) { const c = Math.min(1500, left); await page.waitForTimeout(c); left -= c; }
  }
  async function escena(id, titulo, subtitles, targetMs, fn) {
    const start = Date.now() - t0;
    console.log(`\n▶ Escena ${id} — ${titulo}`);
    const before = Date.now();
    await fn();
    const elapsed = Date.now() - before;
    if (elapsed < targetMs) await idle(targetMs - elapsed);
    const end = Date.now() - t0;
    scenes.push({ id, titulo, start, end, subtitles });
    console.log(`   duración real: ${((end - start) / 1000).toFixed(1)}s (objetivo ${(targetMs / 1000).toFixed(1)}s)`);
  }

  await escena(1, 'Landing sicr3p', [
    'sicr3p.',
    'Atención presencial: trazabilidad que sí se ve.',
    'Tu factura entra. Tu Pasaporte Digital sale.',
    'Cálculo de CO2e, declaración REP y un QR que cualquiera revisa.',
  ], 15000, async () => {
    await page.goto(`${FRONT}/aduana-verde`, { waitUntil: 'load' });
    await page.waitForSelector('text=sicr3p', { timeout: 15000 });
    await idle(1600);
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 350);
      await idle(550);
    }
    await page.locator('.pasos').first().scrollIntoViewIfNeeded().catch(() => {});
    await idle(1200);
  });

  await escena(2, 'Login del terminal (modo demostración)', [
    'En el mostrador, el operador conecta el terminal.',
    'Cada dispositivo del mostrador tiene su propio ID y clave.',
    'Grabación sin credenciales de dispositivo: modo demostración — el procesamiento que sigue es real.',
  ], 15000, async () => {
    await page.goto(`${FRONT}/pos`, { waitUntil: 'load' });
    await page.waitForSelector('h1:has-text("Terminal sicr3p")');
    await idle(1300);
    await page.locator('button:has-text("Conectar terminal")').click();
    await page.waitForSelector('h2:has-text("Conectar terminal")');
    await idle(1600);
    await page.locator('button:has-text("Entrar en modo demostración")').click();
    await page.waitForSelector('h2:has-text("Datos del cliente")');
    await idle(800);
  });

  await escena(3, 'Datos del cliente', [
    'Paso 1 de 5: datos del cliente.',
    'Solo 3 campos obligatorios: RUT, empresa y email.',
    `${CLIENTE.empresa} — RUT ${CLIENTE.rut}.`,
  ], 15000, async () => {
    const rut = page.locator('input[placeholder="76.123.456-7"]');
    const empresa = page.locator('input[placeholder="Mi Empresa SpA"]');
    const email = page.locator('input[placeholder="contacto@empresa.cl"]');
    await rut.click();
    await rut.pressSequentially(CLIENTE.rut, { delay: 55 });
    await idle(500);
    await empresa.click();
    await empresa.pressSequentially(CLIENTE.empresa, { delay: 30 });
    await idle(500);
    await email.click();
    await email.pressSequentially(CLIENTE.email, { delay: 30 });
    await idle(1000);
    await page.locator('button:has-text("Continuar a captura")').click();
    await page.waitForSelector('h2:has-text("Capturar documentos")');
    await idle(600);
  });

  await escena(4, 'Captura del documento', [
    'Paso 2: capturar documentos.',
    'Foto con la cámara o carga del XML/PDF — hasta 5 documentos.',
    'Factura electrónica folio 9999 — Distribuidora Norte SpA.',
    'sicr3p reconoce el documento y calcula el CO2e en la plataforma.',
  ], 18000, async () => {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('button:has-text("Cargar XML / PDF")').click(),
    ]);
    await chooser.setFiles(XML_PATH);
    await page.waitForSelector('text=1 de 5 documentos');
    await idle(1400);
    const [sesionResp] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/sesiones') && r.request().method() === 'POST'),
      page.getByRole('button', { name: /^Procesar 1 documento/ }).click(),
    ]);
    sesionData = await sesionResp.json();
  });

  const totalCo2e = Number(sesionData?.sesion?.total_co2e ?? 0);
  console.log(`\n   >>> t CO2e real calculado por el motor (Sesión A, intento ${intentoNum}): ${totalCo2e}`);

  await escena(5, 'Resultado del cálculo', [
    'Paso 3: resultado del cálculo.',
    `${fmtCo2e(totalCo2e)} t CO2e — el número real que calculó el motor para este documento.`,
    'Suministro eléctrico SEN — 4.000 kWh.',
    'Cargo fijo servicio — detalle ítem por ítem, con su % del total.',
    'El cálculo lo hace el servidor: el operador no puede alterarlo.',
  ], 20000, async () => {
    await page.waitForSelector('h2:has-text("Resultado del cálculo")', { timeout: 30000 });
    await idle(3000);
    await page.locator('table.data').first().scrollIntoViewIfNeeded().catch(() => {});
    await idle(3000);
  });

  await escena(6, 'Compensación del CO2 calculado', [
    'Paso 4: compensación del CO2 calculado.',
    'Tarifa oficial visible. Compensación siempre voluntaria.',
    'Pago simulado — sin pasarela conectada todavía.',
    'El monto compensa exactamente las toneladas calculadas.',
  ], 18000, async () => {
    await page.locator('button:has-text("Continuar a compensación")').click();
    await page.waitForSelector('h2:has-text("Compensación del CO2 calculado")');
    await idle(1600);
    await page.locator('label:has-text("Tarjeta")').click();
    await idle(1000);
    await Promise.all([
      page.waitForResponse((r) => /\/api\/sesiones\/[^/]+\/compensacion$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST'),
      page.locator('button:has-text("Cobrar $")').click(),
    ]);
  });

  await page.close();
  const videoA = await page.video().path();
  await ctx.close();

  return { videoA, scenesA: scenes, sesionData, totalCo2e };
}

// ============================================================
// Sesión B: repetición rápida (recortada) + Escenas 7-10
// ============================================================
async function grabarSesionB(browser, intentoNum, totalCo2eEsperado) {
  const ctx = await browser.newContext({ viewport: VIDEO_SIZE, recordVideo: { dir: RAW_DIR, size: VIDEO_SIZE } });
  const page = await ctx.newPage();
  const t0 = Date.now();

  console.log('   repitiendo el trámite (rápido, se recorta del video final)...');
  await page.goto(`${FRONT}/pos`, { waitUntil: 'load' });
  await page.waitForSelector('h1:has-text("Terminal sicr3p")');
  await page.locator('button:has-text("Conectar terminal")').click();
  await page.waitForSelector('h2:has-text("Conectar terminal")');
  await page.locator('button:has-text("Entrar en modo demostración")').click();
  await page.waitForSelector('h2:has-text("Datos del cliente")');
  await page.locator('input[placeholder="76.123.456-7"]').fill(CLIENTE.rut);
  await page.locator('input[placeholder="Mi Empresa SpA"]').fill(CLIENTE.empresa);
  await page.locator('input[placeholder="contacto@empresa.cl"]').fill(CLIENTE.email);
  await page.locator('button:has-text("Continuar a captura")').click();
  await page.waitForSelector('h2:has-text("Capturar documentos")');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('button:has-text("Cargar XML / PDF")').click(),
  ]);
  await chooser.setFiles(XML_PATH);
  await page.waitForSelector('text=1 de 5 documentos');
  const [sesionResp] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/sesiones') && r.request().method() === 'POST'),
    page.getByRole('button', { name: /^Procesar 1 documento/ }).click(),
  ]);
  const sesionData = await sesionResp.json();
  const totalCo2e = Number(sesionData?.sesion?.total_co2e ?? 0);
  await page.waitForSelector('h2:has-text("Resultado del cálculo")', { timeout: 30000 });
  await page.locator('button:has-text("Continuar a compensación")').click();
  await page.waitForSelector('h2:has-text("Compensación del CO2 calculado")');
  await page.locator('label:has-text("Tarjeta")').click();
  await Promise.all([
    page.waitForResponse((r) => /\/api\/sesiones\/[^/]+\/compensacion$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST'),
    page.locator('button:has-text("Cobrar $")').click(),
  ]);

  if (Math.abs(totalCo2e - totalCo2eEsperado) > 1e-9) {
    throw new Error(`El motor calculó un t CO2e distinto en la repetición de la Sesión B (esperado=${totalCo2eEsperado} obtenido=${totalCo2e}) — no se continúa para no mostrar un número inconsistente.`);
  }

  const trimStartMs = Date.now() - t0;
  console.log(`   repetición terminada en ${(trimStartMs / 1000).toFixed(1)}s reales (se recortará del video final)`);

  const scenes = [];
  async function idle(ms) {
    let left = ms;
    while (left > 0) { const c = Math.min(1500, left); await page.waitForTimeout(c); left -= c; }
  }
  async function escena(id, titulo, subtitles, targetMs, fn) {
    const start = Date.now() - t0;
    console.log(`\n▶ Escena ${id} — ${titulo}`);
    const before = Date.now();
    await fn();
    const elapsed = Date.now() - before;
    if (elapsed < targetMs) await idle(targetMs - elapsed);
    const end = Date.now() - t0;
    scenes.push({ id, titulo, start, end, subtitles });
    console.log(`   duración real: ${((end - start) / 1000).toFixed(1)}s (objetivo ${(targetMs / 1000).toFixed(1)}s)`);
  }

  let docId = null;
  await escena(7, 'Comprobante con QR', [
    'Paso 5: la entrega.',
    'Trámite registrado — con el QR de verificación al frente.',
    'Eslabón de la cadena y hash, a la vista de cualquiera.',
  ], 15000, async () => {
    await page.waitForSelector('h2:has-text("Trámite registrado")', { timeout: 15000 });
    await idle(1500);
    const link = page.getByRole('link', { name: /Verificar trazabilidad/ });
    await link.scrollIntoViewIfNeeded();
    const href = await link.getAttribute('href');
    const m = href && href.match(/\/verificar\/([^/?#]+)/);
    docId = m ? m[1] : null;
    await idle(1500);
    await page.locator('text=Carpeta física para el mandante').scrollIntoViewIfNeeded().catch(() => {});
    await idle(1500);
  });

  if (!docId) throw new Error('No se pudo obtener el id del documento desde el comprobante real.');
  console.log(`   >>> documento id (mismo que apunta el QR): ${docId}`);

  await escena(8, 'Pasaporte Digital', [
    'El QR lleva al Pasaporte Digital — página pública, sin cuenta ni clave.',
    'Emisiones, declaración REP y estado de la cadena, en una sola pantalla.',
    'Evidencia trazable y verificable — no solo un número.',
  ], 15000, async () => {
    await page.goto(`${FRONT}/pasaporte/${docId}`, { waitUntil: 'load' });
    await page.waitForSelector('text=Pasaporte Digital de Producto');
    await idle(2200);
    await page.mouse.wheel(0, 480);
    await idle(1800);
    await page.mouse.wheel(0, 480);
    await idle(1800);
  });

  // Nota de honestidad: el badge de ESTE documento (Verificar) y el estado
  // GLOBAL de la cadena (/cadena, todos los eslabones de este entorno de
  // pruebas) son dos cosas distintas — si el entorno acumuló algún eslabón
  // roto de pruebas anteriores, el subtítulo no puede decir "todo intacto"
  // sin más. Por eso los subtítulos se escriben para ser ciertos en
  // cualquiera de los dos casos (revisar más abajo qué se ve realmente).
  await escena(9, 'Verificación pública y cadena', [
    'Cualquiera puede comprobarlo por su cuenta, sin pedir permiso.',
    'Este documento: trazabilidad verificada, su propio eslabón intacto.',
    'La cadena pública: cualquier alteración pasada queda marcada de inmediato, se vea aquí o no.',
  ], 15000, async () => {
    await page.goto(`${FRONT}/verificar/${docId}`, { waitUntil: 'load' });
    await page.waitForSelector('text=Trazabilidad verificada');
    await idle(2600);
    await page.goto(`${FRONT}/cadena`, { waitUntil: 'load' });
    await page.waitForSelector('text=Cadena de integridad sicr3p');
    await idle(1200);
    await idle(2000);
  });

  await escena(10, 'Cierre', [
    'sicr3p no certifica ni reemplaza a un verificador acreditado.',
    'Entrega evidencia trazable y verificable de tu contabilidad de carbono.',
    'Un trámite. Un mostrador presencial. Un Pasaporte Digital.',
    'sicr3p.cl',
  ], 12000, async () => {
    await page.goto(`${FRONT}/aduana-verde`, { waitUntil: 'load' });
    await page.waitForSelector('text=sicr3p');
    await idle(3200);
  });

  await page.close();
  const videoB = await page.video().path();
  await ctx.close();

  return { videoB, scenesB: scenes, docId, trimStartMs, totalCo2e };
}

main().catch((err) => {
  console.error('\nFALLÓ la grabación:', err);
  process.exit(1);
});
