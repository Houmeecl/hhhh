#!/usr/bin/env node
// ============================================================
// sicr3p — Montaje del video story del proyecto completo, en dos
// formatos, a partir de lo grabado por deploy/grabar-story-proyecto.mjs
// (docs/video/raw/story: .webm + escenas-story.json).
//
// Pipeline (ffmpeg del sistema, mismo estilo que render-demo-aduana-verde.mjs):
//   1. Tarjetas narrativas: fondo navy generado con lavfi + texto centrado
//      quemado como subtítulos .srt (libass, force_style).
//   2. Escena "paneles": capturas PNG reales de docs/manual/fuente/img/
//      con paneo vertical suave (crop animado), 2 pantallas × 6 s.
//   3. Sesiones grabadas: subtítulos .srt por segmento (tiempos que vienen
//      de escenas-story.json) quemados sobre el .webm; la sesión D2 se
//      parte en dos en el borde de escena para intercalar la tarjeta de
//      paneles sin regrabar nada.
//   4. concat + libx264 -crf 20, sin audio (no hay TTS en este entorno).
//
// Salidas:
//   docs/video/sicr3p-proyecto-16x9.mp4   (~2:15, 1280×720)
//   docs/video/sicr3p-proyecto-9x16.mp4   (~70 s, 720×1280)
//
// Uso: node deploy/render-story-proyecto.mjs
// ============================================================
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const RAW_DIR = path.join(REPO_ROOT, 'docs', 'video', 'raw');
const BUILD = path.join(REPO_ROOT, 'docs', 'video', 'build-story');
const IMG_DIR = path.join(REPO_ROOT, 'docs', 'manual', 'fuente', 'img');
const OUT_H = path.join(REPO_ROOT, 'docs', 'video', 'sicr3p-proyecto-16x9.mp4');
const OUT_V = path.join(REPO_ROOT, 'docs', 'video', 'sicr3p-proyecto-9x16.mp4');

const FPS = 25;
const NAVY = '0x0a1a33';

function ff(args) { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' }); }
function probeDur(p) {
  return parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p]).toString().trim());
}

const ts = (ms) => {
  const t = Math.max(0, ms);
  const h = String(Math.floor(t / 3600000)).padStart(2, '0');
  const m = String(Math.floor((t % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((t % 60000) / 1000)).padStart(2, '0');
  const cs = String(Math.floor(t % 1000)).padStart(3, '0');
  return `${h}:${m}:${s},${cs}`;
};

// Reparte los subtítulos de cada escena en partes iguales de su duración.
function srtDeScenes(scenes, offsetMs = 0) {
  const cues = [];
  for (const sc of scenes) {
    const dur = sc.end - sc.start;
    const n = sc.subtitles.length;
    for (let i = 0; i < n; i++) {
      cues.push({
        from: sc.start - offsetMs + (dur * i) / n,
        to: sc.start - offsetMs + (dur * (i + 1)) / n - 120,
        text: sc.subtitles[i],
      });
    }
  }
  return cues.map((c, i) => `${i + 1}\n${ts(c.from)} --> ${ts(c.to)}\n${c.text}\n`).join('\n');
}

function srtDeLineas(lineas, totalMs) {
  const n = lineas.length;
  return lineas.map((l, i) =>
    `${i + 1}\n${ts((totalMs * i) / n)} --> ${ts((totalMs * (i + 1)) / n - 120)}\n${l}\n`
  ).join('\n');
}

// Estilos libass. PlayResY por defecto (288) escala con la altura del video,
// así que el tamaño de fuente se elige por formato. Ojo: con BorderStyle=3
// y Outline=0 libass NO dibuja la caja de fondo (su tamaño sale de
// Outline), y el texto blanco se pierde sobre páginas claras — por eso los
// subtítulos sobre la app usan contorno oscuro (BorderStyle=1), legible
// sobre cualquier fondo.
// Colores ASS en orden &HAABBGGRR: el navy #0A1A33 es &H..331A0A.
const STYLE_SUB_H = "FontName=DejaVu Sans,FontSize=18,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00331A0A,BackColour=&H80331A0A,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=52,MarginL=40,MarginR=40";
const STYLE_SUB_V = "FontName=DejaVu Sans,FontSize=11,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00331A0A,BackColour=&H80331A0A,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=84,MarginL=18,MarginR=18";
const STYLE_CARD_H = "FontName=DejaVu Sans,FontSize=26,Bold=1,PrimaryColour=&H00FFFFFF,BackColour=&H000A1A33,BorderStyle=3,Outline=0,Shadow=0,Alignment=10,MarginL=90,MarginR=90";
const STYLE_CARD_V = "FontName=DejaVu Sans,FontSize=16,Bold=1,PrimaryColour=&H00FFFFFF,BackColour=&H000A1A33,BorderStyle=3,Outline=0,Shadow=0,Alignment=10,MarginL=30,MarginR=30";

const esc = (p) => p.replace(/'/g, "\\'").replace(/:/g, '\\:');

function tarjeta(nombre, lineas, seg, size, style) {
  const srt = path.join(BUILD, `${nombre}.srt`);
  const out = path.join(BUILD, `${nombre}.mp4`);
  return { srt, out, async render() {
    await writeFile(srt, srtDeLineas(lineas, seg * 1000), 'utf8');
    ff(['-f', 'lavfi', '-i', `color=c=${NAVY}:s=${size}:r=${FPS}:d=${seg}`,
      '-vf', `subtitles=${esc(srt)}:force_style='${style}'`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-an', out]);
    return out;
  } };
}

// Segmento de sesión grabada: recorte [desdeMs, hastaMs] + subtítulos.
async function segmento(nombre, videoPath, scenes, desdeMs, hastaMs, style) {
  const srt = path.join(BUILD, `${nombre}.srt`);
  const out = path.join(BUILD, `${nombre}.mp4`);
  const visibles = scenes.filter((s) => s.start >= desdeMs - 1 && s.end <= (hastaMs ?? Infinity) + 1);
  await writeFile(srt, srtDeScenes(visibles, desdeMs), 'utf8');
  const args = ['-ss', String(desdeMs / 1000), '-i', videoPath];
  if (hastaMs != null) args.push('-t', String((hastaMs - desdeMs) / 1000));
  args.push('-vf', `subtitles=${esc(srt)}:force_style='${style}',fps=${FPS}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-an', out);
  ff(args);
  return out;
}

// Escena "paneles": capturas reales con paneo vertical suave.
async function escenaPaneles(nombre, capturas, segPorImg, lineas) {
  const partes = [];
  for (let i = 0; i < capturas.length; i++) {
    const out = path.join(BUILD, `${nombre}-img${i}.mp4`);
    // Paneo: la captura (1280 de ancho, alto variable) se desplaza hacia
    // abajo dentro del marco 1280×720 durante segPorImg segundos.
    ff(['-loop', '1', '-t', String(segPorImg), '-i', capturas[i],
      '-vf', `scale=1280:-2,crop=1280:720:0:'min(ih-720,(ih-720)*t/${segPorImg})',fps=${FPS}`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-an', out]);
    partes.push(out);
  }
  const concatTxt = path.join(BUILD, `${nombre}-concat.txt`);
  await writeFile(concatTxt, partes.map((p) => `file '${p}'`).join('\n'), 'utf8');
  const sinSub = path.join(BUILD, `${nombre}-sinsub.mp4`);
  ff(['-f', 'concat', '-safe', '0', '-i', concatTxt, '-c', 'copy', sinSub]);
  const srt = path.join(BUILD, `${nombre}.srt`);
  await writeFile(srt, srtDeLineas(lineas, capturas.length * segPorImg * 1000), 'utf8');
  const out = path.join(BUILD, `${nombre}.mp4`);
  ff(['-i', sinSub, '-vf', `subtitles=${esc(srt)}:force_style='${STYLE_SUB_H}'`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-an', out]);
  return out;
}

async function concatFinal(partes, out) {
  const txt = path.join(BUILD, `final-${path.basename(out)}.txt`);
  await writeFile(txt, partes.map((p) => `file '${p}'`).join('\n'), 'utf8');
  ff(['-f', 'concat', '-safe', '0', '-i', txt, '-c', 'copy', out]);
}

async function main() {
  await mkdir(BUILD, { recursive: true });
  const meta = JSON.parse(await readFile(path.join(RAW_DIR, 'escenas-story.json'), 'utf8'));
  console.log(`CO2e real de la grabación: ${meta.co2eTexto}`);

  // ================= Horizontal 16:9 =================
  const [d1, d2] = meta.horizontal;
  const cardH0 = tarjeta('h-card0', [
    'Te piden demostrar tu carbono y tu trazabilidad.',
    'Y las planillas y los PDF sueltos no son evidencia.',
    'Esto es sicr3p.',
  ], 10, '1280x720', STYLE_CARD_H);
  const cardH8 = tarjeta('h-card8', [
    'sicr3p no certifica ni reemplaza a un verificador acreditado.',
    'Deja tu evidencia calculada, citada y sellada —\npara que cualquiera la compruebe.',
    'sicr3p.cl  ·  contacto@sicrep.cl',
  ], 12, '1280x720', STYLE_CARD_H);

  const segD1 = await segmento('h-d1', d1.videoPath, d1.scenes, 0, null, STYLE_SUB_H);
  // D2 se parte en el borde entre la Escena 5 (torre) y la 7 (cadena)
  // para intercalar la tarjeta de paneles siguiendo el orden del guion.
  const e7 = d2.scenes.find((s) => String(s.id) === '7');
  const segD2a = await segmento('h-d2a', d2.videoPath, d2.scenes, 0, e7.start, STYLE_SUB_H);
  const segD2b = await segmento('h-d2b', d2.videoPath, d2.scenes, e7.start, null, STYLE_SUB_H);
  const paneles = await escenaPaneles('h-paneles', [
    path.join(IMG_DIR, 'admin-dashboard.png'),
    path.join(IMG_DIR, 'av-cargar.png'),
  ], 6, [
    'Cada actor tiene su acceso: operación, mostrador presencial,',
    'puerto, mandante y agencia de aduanas — cada uno ve solo lo suyo.',
  ]);

  await concatFinal([
    await cardH0.render(), segD1, segD2a, paneles, segD2b, await cardH8.render(),
  ], OUT_H);

  // ================= Vertical 9:16 =================
  const [mv] = meta.vertical;
  const cardV0 = tarjeta('v-card0', [
    'Te piden demostrar tu carbono\ny tu trazabilidad.',
    'Esto es sicr3p.',
  ], 6, '720x1280', STYLE_CARD_V);
  const cardV8 = tarjeta('v-card8', [
    'sicr3p no certifica ni reemplaza\na un verificador acreditado.',
    'Evidencia calculada, citada y sellada.',
    'sicr3p.cl',
  ], 10, '720x1280', STYLE_CARD_V);
  const segM = await segmento('v-m', mv.videoPath, mv.scenes, 0, null, STYLE_SUB_V);

  await concatFinal([await cardV0.render(), segM, await cardV8.render()], OUT_V);

  for (const out of [OUT_H, OUT_V]) {
    console.log(`✓ ${out} — ${probeDur(out).toFixed(1)} s`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
