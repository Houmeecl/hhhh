#!/usr/bin/env bash
# ============================================================
# sicr3p — CIERRE DE VERSIÓN FINAL en el VPS (un solo comando).
#
# Deja el VPS con TODO lo construido en la Etapa 1, al día y
# verificado. Idempotente: se puede correr las veces que sea.
#
# Uso (como root en el VPS, con el repo en /opt/sicr3p):
#   cd /opt/sicr3p && git pull && bash deploy/finalizar-vps.sh
#
# Qué hace:
#   1. Instala los binarios del motor propio total (OCR, raster, HEIC).
#   2. Trae la última versión de la rama y aplica migraciones (001→019).
#   3. Reinstala dependencias, compila el frontend y reinicia el backend.
#   4. Instala el cron de auto-deploy (si falta) — desde aquí, cada push
#      llega solo, con tests + smoke + rollback.
#   5. Corre el SMOKE E2E contra producción y muestra el resumen final.
#
# Lo que NO puede hacer un script (pasos humanos, se listan al final):
#   DNS/SPF del correo, ticket rDNS a DonWeb, facturación de GitHub.
# ============================================================
set -euo pipefail

DIR="${SICR3P_DIR:-/opt/sicr3p}"
RAMA="${SICR3P_RAMA:-claude/sicr3p-etapa-1-complete-caqhpl}"
PM2_APP="sicr3p-backend"

paso() { echo; echo "==> $*"; }

[ -d "$DIR/backend" ] || { echo "ERROR: no existe $DIR/backend — primero corre deploy/instalar-vps.sh"; exit 1; }
cd "$DIR"

paso "1/5 Binarios del motor propio (OCR + raster de PDF + HEIC)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y >/dev/null
apt-get install -y tesseract-ocr tesseract-ocr-spa poppler-utils libheif-examples >/dev/null
echo "   tesseract: $(tesseract --version 2>&1 | head -1)"
echo "   pdftoppm:  $(pdftoppm -v 2>&1 | head -1)"
echo "   heif-convert: instalado"

paso "2/5 Última versión de la rama + migraciones"
git fetch origin "$RAMA"
git checkout "$RAMA" 2>/dev/null || true
git pull --ff-only origin "$RAMA"
echo "   HEAD: $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s | cut -c1-70)"
( cd backend && npm ci --omit=dev && npm run migrate )

paso "3/5 Tests del backend en el VPS (CI propio)"
( cd backend && npm test ) > /tmp/sicr3p-tests-final.log 2>&1 \
  && echo "   tests: OK ($(grep -c '^ok ' /tmp/sicr3p-tests-final.log || true) pasados)" \
  || { echo "   ERROR: tests fallaron — ver /tmp/sicr3p-tests-final.log"; exit 1; }

paso "4/5 Build del frontend + reinicio del backend"
( cd frontend && npm ci && npx vite build )
pm2 restart "$PM2_APP" 2>/dev/null || ( cd backend && pm2 start src/index.js --name "$PM2_APP" )
pm2 save >/dev/null
sleep 3

paso "5/5 Auto-deploy + smoke E2E de producción"
bash deploy/actualizar.sh --instalar-cron
node deploy/smoke-e2e.mjs || { echo "   ERROR: el smoke E2E falló — revisar arriba"; exit 1; }

echo
echo "============================================================"
echo " VERSIÓN FINAL OPERATIVA. Desde ahora, cada push a la rama"
echo " llega solo (cron cada 30 min) con: respaldo BD → pull →"
echo " tests → build → restart → health → smoke E2E → o rollback."
echo "============================================================"
echo
echo "Pasos humanos pendientes (no los puede hacer un script):"
echo "  · Correo corporativo: corregir el TXT SPF del dominio a"
echo "      v=spf1 mx include:spf.hostmar.com ~all"
echo "    crear _dmarc, ticket rDNS a DonWeb y luego:"
echo "      bash deploy/instalar-webmail.sh   (guía: deploy/WEBMAIL.md)"
echo "  · CI de GitHub (cosmético): regularizar la facturación de la"
echo "    cuenta en github.com/settings/billing."
echo "  · Panel admin: fijar tipo de cambio USD (config POS) y validar"
echo "    los factores nuevos contra sus fuentes oficiales para subirlos"
echo "    a 'validada_oficial'."
echo "  · Cuando el % de independencia del motor sea ~100 sostenido:"
echo "    MOTOR_EXTERNO=off en backend/.env y reiniciar pm2."
