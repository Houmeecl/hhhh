#!/usr/bin/env bash
cd "$(dirname "$0")"
[ -d node_modules ] || npm install --omit=dev
exec node --no-warnings server.js
