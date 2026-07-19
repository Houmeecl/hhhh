#!/usr/bin/env bash
# ============================================================
# sicr3p — Wrapper del auto-deploy para cron (cada 30 min).
#
# Ejecuta deploy/actualizar.sh; si sale bien, termina en silencio.
# Si falla (rollback o crítico), invoca a `claude` en modo SOLO
# LECTURA para dejar un diagnóstico escrito en /root/ — el agente
# NUNCA repara nada: solo explica para que un humano decida.
#
# Instalación: bash deploy/actualizar.sh --instalar-cron
# Sobreescribibles: las mismas de actualizar.sh + SICR3P_DIAG_DIR
# (dónde dejar los diagnósticos; default /root — solo para ensayos).
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="${SICR3P_DIR:-/opt/sicr3p}"
LOG="${SICR3P_LOG:-/var/log/sicr3p-actualizar.log}"
DIAG_DIR="${SICR3P_DIAG_DIR:-/root}"

log() {
  local linea="[$(date '+%F %T')] [agente] $*"
  echo "$linea"
  echo "$linea" >> "$LOG"
}

# ---------- 1. Correr la actualización (hereda el entorno) ----------
set +e
bash "$SCRIPT_DIR/actualizar.sh"
CODIGO=$?
set -e
if [ "$CODIGO" -eq 0 ]; then
  exit 0
fi

# ---------- 2. Falló: pedir diagnóstico (solo lectura) a claude ----------
log "actualizar.sh salió con código $CODIGO; se pide diagnóstico."
if command -v claude >/dev/null 2>&1; then
  INFORME="$DIAG_DIR/sicr3p-diagnostico-$(date +%F-%H%M).txt"
  PROMPT=$(cat <<FIN
El auto-deploy de sicr3p falló e hizo rollback. Lee $LOG (últimas 80 líneas) y \`pm2 logs sicr3p-backend --lines 50 --nostream\`, revisa el estado con pm2 status y curl al health. Escribe un DIAGNÓSTICO breve: causa probable, evidencia (líneas citadas), y el comando o corrección sugerida para que un humano la aplique. NO ejecutes ninguna reparación, NO reinicies servicios, NO toques git: tu trabajo es solo explicar.
FIN
)
  # Herramientas SOLO de lectura/observación: nada que modifique el sistema.
  ( cd "$REPO_DIR" && timeout 300 claude -p "$PROMPT" \
      --allowedTools "Read,Grep,Glob,Bash(tail *),Bash(pm2 status),Bash(pm2 logs *),Bash(curl *)" \
      > "$INFORME" 2>&1 ) || log "el agente de diagnóstico no terminó bien (timeout o error); lo que alcanzó queda igual en el informe."
  log "diagnóstico del agente en: $INFORME"
else
  log "claude no instalado; revisar $LOG a mano."
fi

# ---------- 3. Salir con el código real (para monitoreo externo) ----------
exit "$CODIGO"
