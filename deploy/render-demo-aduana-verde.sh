#!/usr/bin/env bash
# ============================================================
# sicr3p — Post-proceso del video "Aduana Verde" (wrapper).
#
# Arma docs/video/aduana-verde-demo.mp4 a partir del .webm real grabado
# por deploy/grabar-demo-aduana-verde.mjs (docs/video/raw/*.webm +
# docs/video/raw/escenas.json): cortinilla de apertura + recorrido real
# con los subtítulos del guion quemados encima. Sin audio.
#
# La lógica vive en render-demo-aduana-verde.mjs (genera los .srt con los
# tiempos reales de cada escena y llama a ffmpeg); este script es solo el
# punto de entrada.
#
# Uso: deploy/render-demo-aduana-verde.sh
# Requiere: ffmpeg/ffprobe en PATH (con soporte libass/subtitles) y haber
# corrido antes deploy/grabar-demo-aduana-verde.mjs.
# ============================================================
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg no está en PATH — instálalo antes de renderizar (apt-get install -y ffmpeg)." >&2
  exit 1
fi

exec node "$DIR/render-demo-aduana-verde.mjs" "$@"
