#!/usr/bin/env node
// ============================================================
// sicr3p — Narración sintética (espeak-ng, es-419) para el video story
// del proyecto, sincronizada con los subtítulos ya quemados.
//
// Toma los segmentos y .srt que dejó deploy/render-story-proyecto.mjs en
// docs/video/build-story/ (la lista de concat final define el orden), y:
//   1. Calcula el instante ABSOLUTO de cada subtítulo en el video final
//      (offset acumulado de segmentos + tiempo del cue en su .srt).
//   2. Genera un .wav por cue con espeak-ng (voz es-419), con reemplazos
//      de pronunciación (sicr3p→sicrep, CO2e→"ce o dos equivalente", etc.).
//   3. Mezcla todos los cues en la línea de tiempo (adelay + amix) y los
//      muxea al .mp4 SIN recodificar el video (-c:v copy).
//
// Voz: sintética de espeak-ng — NO es una locución humana. El guion
// (docs/comercial/guion-video-proyecto.md) sigue siendo la base para
// grabar una voz en off profesional cuando se quiera reemplazarla.
//
// Uso: node deploy/narrar-story-proyecto.mjs
// ============================================================
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const BUILD = path.join(REPO_ROOT, 'docs', 'video', 'build-story');
const VOZ_DIR = path.join(BUILD, 'voz');

const VIDEOS = [
  { final: path.join(REPO_ROOT, 'docs', 'video', 'sicr3p-proyecto-16x9.mp4') },
  { final: path.join(REPO_ROOT, 'docs', 'video', 'sicr3p-proyecto-9x16.mp4') },
];

const VOICE = 'es-419';
const RATE = '150';   // palabras por minuto — calmado, cabe en cada cue
const AMP = '180';

function ff(args) { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' }); }
function probeDur(p) {
  return parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p]).toString().trim());
}

// Texto de subtítulo → texto hablable por espeak (pronunciación).
function hablable(t) {
  return t
    .replace(/\n/g, ' ')
    .replace(/contacto@sicrep\.cl/gi, 'contacto, arroba, sicrep punto ce ele')
    .replace(/sicr3p\.cl/gi, 'sicrep punto ce ele')
    .replace(/sicr3p/gi, 'sicrep')
    .replace(/CO2e/g, 'ce o dos equivalente')
    .replace(/CO2/g, 'ce o dos')
    .replace(/\(Ley 20\.920\)/g, ', ley veinte mil novecientos veinte,')
    .replace(/QR/g, 'cu erre')
    .replace(/PDF/g, 'pe de efe')
    .replace(/[«»]/g, '')
    .replace(/[·—]/g, ', ');
}

function parseSrt(txt) {
  const cues = [];
  const bloques = txt.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  for (const b of bloques) {
    const lineas = b.split('\n');
    const m = lineas[1]?.match(/(\d+):(\d+):(\d+),(\d+)\s*-->/);
    if (!m) continue;
    const ms = ((+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000) + +m[4];
    cues.push({ startMs: ms, text: lineas.slice(2).join(' ') });
  }
  return cues;
}

async function narrar(finalMp4) {
  const base = path.basename(finalMp4);
  const listPath = path.join(BUILD, `final-${base}.txt`);
  const orden = (await readFile(listPath, 'utf8')).split('\n')
    .map((l) => l.match(/^file '(.+)'$/)?.[1]).filter(Boolean);

  // Cues absolutos: offset acumulado por segmento + tiempos del .srt hermano.
  const cues = [];
  let offsetMs = 0;
  for (const seg of orden) {
    const srtPath = seg.replace(/\.mp4$/, '.srt').replace(/-sinsub/, '');
    try {
      for (const c of parseSrt(await readFile(srtPath, 'utf8'))) {
        cues.push({ startMs: offsetMs + c.startMs, text: c.text });
      }
    } catch { /* segmento sin srt: sin narración ahí */ }
    offsetMs += Math.round(probeDur(seg) * 1000);
  }
  if (!cues.length) throw new Error(`Sin cues para ${base}`);

  // Un wav por cue; si un cue dura más que el hueco hasta el siguiente,
  // se deja igual (leve solape es preferible a acelerar la voz).
  const wavs = [];
  for (let i = 0; i < cues.length; i++) {
    const wav = path.join(VOZ_DIR, `${base}-${String(i).padStart(2, '0')}.wav`);
    execFileSync('espeak-ng', ['-v', VOICE, '-s', RATE, '-a', AMP, '-w', wav, hablable(cues[i].text)]);
    wavs.push({ wav, delay: Math.max(0, cues[i].startMs) });
  }

  // Mezcla: cada wav se retrasa a su instante y se suman sin normalizar.
  const inputs = wavs.flatMap((w) => ['-i', w.wav]);
  const delays = wavs.map((w, i) => `[${i + 1}:a]adelay=${w.delay}:all=1[a${i}]`).join(';');
  const mixIn = wavs.map((_, i) => `[a${i}]`).join('');
  const filtro = `${delays};${mixIn}amix=inputs=${wavs.length}:normalize=0,alimiter=limit=0.9,apad[aout]`;
  const out = finalMp4.replace(/\.mp4$/, '.narr.mp4');
  ff(['-i', finalMp4, ...inputs, '-filter_complex', filtro,
    '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-shortest', out]);
  execFileSync('mv', [out, finalMp4]);
  console.log(`✓ narrado: ${finalMp4} (${cues.length} cues, ${probeDur(finalMp4).toFixed(1)} s)`);
}

await mkdir(VOZ_DIR, { recursive: true });
for (const v of VIDEOS) await narrar(v.final);
console.log('Voz sintética espeak-ng — para locución humana, usar el guion como texto base.');
