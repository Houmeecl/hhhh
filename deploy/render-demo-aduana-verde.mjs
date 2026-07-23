#!/usr/bin/env node
// ============================================================
// sicr3p — Post-proceso del video "Aduana Verde" (recorrido real).
//
// Toma los .webm reales + docs/video/raw/escenas.json que produce
// deploy/grabar-demo-aduana-verde.mjs y arma el video final:
//   1. Escena 0 (cortinilla de apertura, sin app real — pantalla sólida
//      de marca con los 4 subtítulos encadenados, ~3 s cada uno).
//   2. Sesión A grabada (Escenas 1-6), recortada desde su propio inicio.
//   3. Sesión B grabada (Escenas 7-10), recortada DESDE donde termina la
//      repetición rápida del trámite (trimStartMs) — esa repetición
//      nunca se muestra, solo existía para llegar al comprobante real.
//   4. Concatenación de las tres piezas, con los subtítulos de cada
//      escena del guion quemados encima (fondo semitransparente).
//
// Sin audio (no hay texto-a-voz ni micrófono en este entorno): el video
// final no lleva pista de voz, solo los subtítulos quemados.
//
// Uso: node deploy/render-demo-aduana-verde.mjs
// (o vía el wrapper deploy/render-demo-aduana-verde.sh)
// ============================================================
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const RAW_DIR = path.join(REPO_ROOT, 'docs', 'video', 'raw');
const BUILD_DIR = path.join(REPO_ROOT, 'docs', 'video', 'build');
const OUT_PATH = path.join(REPO_ROOT, 'docs', 'video', 'aduana-verde-demo.mp4');
const META_PATH = path.join(RAW_DIR, 'escenas.json');

const FFMPEG = 'ffmpeg';
const FFPROBE = 'ffprobe';
const W = 1280;
const H = 720;
const FPS = 25;

// Mismo estilo de subtítulo en toda la pieza: caja semitransparente detrás
// del texto (BorderStyle=3 + BackColour con alfa) para que se lea sobre
// cualquier fondo, claro u oscuro, de la app o de la cortinilla.
const FORCE_STYLE = [
  'FontName=DejaVu Sans',
  'FontSize=22',
  'PrimaryColour=&H00FFFFFF',
  'BackColour=&H90142033',
  'BorderStyle=3',
  'Outline=0',
  'Shadow=0',
  'Alignment=2',
  'MarginV=64',
  'MarginL=40',
  'MarginR=40',
].join(',');

// Escena 0: cortinilla de apertura sin interfaz de la app (fondo navy de
// marca) — 4 subtítulos encadenados de ~3 s cada uno, 12 s en total.
const ESCENA_0 = {
  duracionMs: 12000,
  subtitulos: [
    'Cada mes llegan más boletas y facturas de las que alcanzas a ordenar.',
    'Sin tiempo para pasarlas a una planilla, papel por papel.',
    'Y sin nada real que mostrar cuando te piden el dato.',
    'Esto es Aduana Verde — el mostrador de sicr3p.',
  ],
};

function msToSrtTime(ms) {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3600000);
  const m = Math.floor((t % 3600000) / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const msRem = t % 1000;
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(msRem, 3)}`;
}

// Reparte los subtítulos de una escena en partes iguales dentro de
// [start, end] (ms, relativos al inicio del propio clip que los usa).
function subtitulosAIntervalos(subtitulos, start, end) {
  const n = subtitulos.length;
  const dur = (end - start) / n;
  return subtitulos.map((texto, i) => ({
    from: start + i * dur,
    to: i === n - 1 ? end : start + (i + 1) * dur,
    texto,
  }));
}

function construirSrt(entradas) {
  return entradas
    .map((e, i) => `${i + 1}\n${msToSrtTime(e.from)} --> ${msToSrtTime(e.to)}\n${e.texto}\n`)
    .join('\n');
}

function ffmpeg(args, label) {
  console.log(`\n$ ffmpeg ${args.join(' ')}`);
  execFileSync(FFMPEG, args, { stdio: 'inherit' });
  console.log(`   -> ${label} OK`);
}

async function main() {
  if (!existsSync(META_PATH)) {
    throw new Error(`No existe ${META_PATH}. Corre primero deploy/grabar-demo-aduana-verde.mjs.`);
  }
  const meta = JSON.parse(await readFile(META_PATH, 'utf8'));
  if (!Array.isArray(meta.videos) || meta.videos.length === 0) {
    throw new Error('escenas.json no tiene "videos" — ¿se grabó con una versión anterior del script?');
  }
  for (const v of meta.videos) {
    if (!existsSync(v.videoPath)) throw new Error(`No existe el .webm crudo (${v.videoPath}).`);
  }

  await mkdir(BUILD_DIR, { recursive: true });

  console.log('sicr3p — render final "Aduana Verde"');
  console.log(`t CO2e real capturado en la grabación: ${meta.totalCo2eReal}`);
  console.log(`Documento id: ${meta.docId}`);
  console.log(`Videos de origen: ${meta.videos.length}`);

  // ---------- 1) Cortinilla de apertura: fondo navy sólido + subtítulos ----------
  const srt0 = construirSrt(subtitulosAIntervalos(ESCENA_0.subtitulos, 0, ESCENA_0.duracionMs));
  const srt0Path = path.join(BUILD_DIR, 'escena-0.srt');
  await writeFile(srt0Path, srt0, 'utf8');

  const escena0Mp4 = path.join(BUILD_DIR, 'escena-0.mp4');
  ffmpeg([
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=0x0a1a33:s=${W}x${H}:r=${FPS}:d=${ESCENA_0.duracionMs / 1000}`,
    '-vf', `subtitles=${srt0Path}:force_style='${FORCE_STYLE}'`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-r', String(FPS),
    escena0Mp4,
  ], 'Escena 0 (cortinilla) generada');

  const segmentos = [escena0Mp4];

  // ---------- 2) Cada video real: recortar desde trimStartMs + quemar subtítulos ----------
  for (let i = 0; i < meta.videos.length; i++) {
    const v = meta.videos[i];
    const trimS = (v.trimStartMs || 0) / 1000;
    // Los tiempos de escena vienen relativos al inicio del PROPIO video
    // grabado; si se recorta desde trimStartMs, hay que restarlo para que
    // los subtítulos queden alineados al video YA recortado.
    const entradas = v.scenes.flatMap((sc) =>
      subtitulosAIntervalos(sc.subtitles, sc.start - (v.trimStartMs || 0), sc.end - (v.trimStartMs || 0))
    );
    const srtPath = path.join(BUILD_DIR, `video-${i}.srt`);
    await writeFile(srtPath, construirSrt(entradas), 'utf8');

    const outMp4 = path.join(BUILD_DIR, `video-${i}.mp4`);
    const args = ['-y'];
    if (trimS > 0) args.push('-ss', String(trimS));
    args.push(
      '-i', v.videoPath,
      '-vf', `subtitles=${srtPath}:force_style='${FORCE_STYLE}'`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-r', String(FPS),
      '-an',
      outMp4,
    );
    ffmpeg(args, `Video ${i} (${path.basename(v.videoPath)}, recorte desde ${trimS.toFixed(1)}s) con subtítulos`);
    segmentos.push(outMp4);
  }

  // ---------- 3) Concatenar cortinilla + Sesión A + Sesión B ----------
  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  const inputArgs = segmentos.flatMap((s) => ['-i', s]);
  const filterInputs = segmentos.map((_, i) => `[${i}:v]`).join('');
  ffmpeg([
    '-y',
    ...inputArgs,
    '-filter_complex', `${filterInputs}concat=n=${segmentos.length}:v=1:a=0[outv]`,
    '-map', '[outv]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-r', String(FPS),
    '-an',
    OUT_PATH,
  ], `Video final concatenado (${OUT_PATH})`);

  // ---------- 4) Verificación con ffprobe ----------
  const probe = execFileSync(FFPROBE, [
    '-v', 'error',
    '-show_entries', 'format=duration,size:stream=codec_type,codec_name,width,height',
    '-of', 'json',
    OUT_PATH,
  ]).toString('utf8');
  const info = JSON.parse(probe);
  const vStream = (info.streams || []).find((s) => s.codec_type === 'video');
  const durSeg = Number(info.format?.duration || 0);
  const tamMb = Number(info.format?.size || 0) / 1024 / 1024;

  console.log('\n============================================================');
  console.log(`Video final: ${OUT_PATH}`);
  console.log(`Duración: ${durSeg.toFixed(1)} s (${Math.floor(durSeg / 60)}m${Math.round(durSeg % 60)}s)`);
  console.log(`Tamaño: ${tamMb.toFixed(2)} MB`);
  console.log(`Stream de video: ${vStream ? `${vStream.codec_name} ${vStream.width}x${vStream.height}` : 'NO ENCONTRADO — ARCHIVO INVÁLIDO'}`);
  console.log(`t CO2e real mostrado en la Escena 5: ${meta.totalCo2eReal}`);
  console.log('============================================================');

  if (!vStream || durSeg <= 0) {
    throw new Error('El video final no tiene un stream de video válido o duración 0 — revisar el render.');
  }
}

main().catch((err) => {
  console.error('\nFALLÓ el render:', err);
  process.exit(1);
});
