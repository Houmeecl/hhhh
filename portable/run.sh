#!/usr/bin/env bash
# Arranca sicr3p portátil desde esta carpeta (pendrive). Requiere Node 22.5+.
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  echo "Instalando dependencias (solo la primera vez)…"
  npm install --omit=dev
fi
echo "Abriendo sicr3p portátil en http://localhost:${PORT:-4100}"
exec node --no-warnings server.js
