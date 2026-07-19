#!/usr/bin/env bash
# ============================================================
# sicr3p — Actualización automática de producción (auto-deploy).
#
# Uso (como root en el VPS, repo en /opt/sicr3p):
#   bash deploy/actualizar.sh                    → una pasada manual
#   bash deploy/actualizar.sh --instalar-cron    → cron cada 30 min (vía agente-deploy.sh)
#   bash deploy/actualizar.sh --desinstalar-cron → quita el cron
#
# Ciclo: fetch → ¿hay commits nuevos? → respaldo BD pre-deploy →
#        git pull --ff-only → build backend+frontend → pm2 restart →
#        health check → OK, o ROLLBACK al commit previo.
#
# Códigos de salida: 0 = sin cambios o actualizado · 1 = falló y se
# hizo rollback (o pull no fast-forward) · 2 = CRÍTICO, ni el rollback
# pasó el health (intervención manual).
#
# Variables sobreescribibles por entorno (para ensayos o rutas distintas):
#   SICR3P_DIR, SICR3P_RAMA, SICR3P_LOG, SICR3P_HEALTH_URL,
#   SICR3P_FRONT_URL, SICR3P_BACKUP_DIR, SICR3P_LOCK, SICR3P_RESTART_CMD
#   SICR3P_SKIP_BUILD=1 → salta npm ci / vite build (SOLO para ensayos).
# ============================================================
set -euo pipefail

REPO_DIR="${SICR3P_DIR:-/opt/sicr3p}"
RAMA="${SICR3P_RAMA:-claude/sicr3p-etapa-1-complete-caqhpl}"
LOG="${SICR3P_LOG:-/var/log/sicr3p-actualizar.log}"
PM2_APP="sicr3p-backend"
HEALTH_URL="${SICR3P_HEALTH_URL:-http://localhost:4000/api/health}"
FRONT_URL="${SICR3P_FRONT_URL:-http://localhost/}"
BACKUP_DIR="${SICR3P_BACKUP_DIR:-/root/backups}"
LOCK="${SICR3P_LOCK:-/run/sicr3p-actualizar.lock}"
RESTART_CMD="${SICR3P_RESTART_CMD:-pm2 restart $PM2_APP}"

log() {
  local linea="[$(date '+%F %T')] $*"
  echo "$linea"
  echo "$linea" >> "$LOG"
}

# ---------- 1. Instalar / desinstalar el cron (y salir) ----------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ "${1:-}" = "--instalar-cron" ]; then
  chmod +x "$SCRIPT_DIR/actualizar.sh" "$SCRIPT_DIR/agente-deploy.sh"
  if crontab -l 2>/dev/null | grep -q 'agente-deploy.sh'; then
    echo "==> El cron de auto-deploy ya estaba instalado; no se duplica."
  else
    # OJO: sin "|| true", en una cuenta SIN crontab previo `crontab -l` falla y
    # con set -e/pipefail el subshell muere antes del echo → instalaba un cron
    # vacío y el script abortaba en silencio (bug visto en el VPS real).
    { crontab -l 2>/dev/null || true; echo "*/30 * * * * $SCRIPT_DIR/agente-deploy.sh"; } | crontab -
    echo "==> Auto-deploy instalado: cada 30 min corre $SCRIPT_DIR/agente-deploy.sh (log: $LOG)."
  fi
  exit 0
fi
if [ "${1:-}" = "--desinstalar-cron" ]; then
  if crontab -l 2>/dev/null | grep -q 'agente-deploy.sh'; then
    # grep -v sale 1 si el crontab quedaría vacío; el || true evita que pipefail
    # aborte el script después de haber aplicado el cambio.
    { crontab -l 2>/dev/null | grep -v 'agente-deploy.sh' || true; } | crontab -
    echo "==> Auto-deploy desinstalado (se quitó la línea de agente-deploy.sh del crontab)."
  else
    echo "==> No había cron de auto-deploy instalado."
  fi
  exit 0
fi

mkdir -p "$(dirname "$LOG")" 2>/dev/null || true
touch "$LOG"

# ---------- 2. Lock: nunca dos deploys a la vez ----------
exec 9>"$LOCK"
if ! flock -n 9; then
  log "otra corrida en curso ($LOCK); salgo sin hacer nada."
  exit 0
fi

# ---------- 3. ¿Hay commits nuevos en la rama? ----------
cd "$REPO_DIR"
git fetch --quiet origin "$RAMA"
COMMIT_PREVIO="$(git rev-parse HEAD)"
COMMIT_REMOTO="$(git rev-parse "origin/$RAMA")"
if [ "$COMMIT_PREVIO" = "$COMMIT_REMOTO" ]; then
  log "sin cambios (HEAD ya es origin/$RAMA en ${COMMIT_PREVIO:0:7})."
  exit 0
fi
log "cambio detectado: ${COMMIT_PREVIO:0:7} → ${COMMIT_REMOTO:0:7}; iniciando actualización."

# ---------- Helpers de build / restart / health ----------
construir() {
  # SICR3P_SKIP_BUILD=1: SOLO para ensayos locales (evita npm ci real).
  if [ "${SICR3P_SKIP_BUILD:-0}" = "1" ]; then
    log "SICR3P_SKIP_BUILD=1 → se omite npm ci / vite build (modo ensayo)."
    return 0
  fi
  ( cd "$REPO_DIR/backend" && npm ci --omit=dev ) >> "$LOG" 2>&1 || return 1
  ( cd "$REPO_DIR/frontend" && npm ci && npx vite build ) >> "$LOG" 2>&1 || return 1
}

reiniciar() {
  eval "$RESTART_CMD" >> "$LOG" 2>&1
}

health_ok() {
  # Reintenta hasta 30 s (15 × 2 s): el backend debe responder "ok":true
  # y el frontend (nginx) debe entregar la portada.
  local i
  for i in $(seq 1 15); do
    if curl -fs "$HEALTH_URL" 2>/dev/null | grep -q '"ok":true'; then
      if curl -fs -o /dev/null "$FRONT_URL" 2>/dev/null; then
        return 0
      fi
    fi
    sleep 2
  done
  return 1
}

# ---------- 8. Rollback al commit previo ----------
rollback() {
  log "FALLO en el deploy de ${COMMIT_REMOTO:0:7}; iniciando ROLLBACK a ${COMMIT_PREVIO:0:7}."
  git checkout --quiet "$COMMIT_PREVIO"
  log "aviso: el repo quedó en detached HEAD (${COMMIT_PREVIO:0:7}); para volver a la rama: git checkout $RAMA"
  if ! construir; then
    log "CRÍTICO: el build del rollback también falló. Manual: cd $REPO_DIR && git checkout $RAMA && (backend: npm ci --omit=dev · frontend: npm ci && npx vite build) && pm2 restart $PM2_APP"
    exit 2
  fi
  if ! reiniciar; then
    log "CRÍTICO: el restart del rollback falló. Manual: pm2 restart $PM2_APP y revisar pm2 logs $PM2_APP."
    exit 2
  fi
  if health_ok; then
    log "ROLLBACK OK: producción volvió a ${COMMIT_PREVIO:0:7} (el deploy de ${COMMIT_REMOTO:0:7} falló)."
    exit 1
  fi
  log "CRÍTICO: ni el rollback a ${COMMIT_PREVIO:0:7} pasó el health ($HEALTH_URL). Manual: pm2 logs $PM2_APP --lines 50, revisar backend/.env y la BD; si hace falta: git checkout $RAMA y redeploy a mano."
  exit 2
}

# ---------- 4. Respaldo BD pre-deploy (no bloquea el deploy) ----------
if command -v pg_dump >/dev/null 2>&1 && sudo -u postgres psql -d sicr3p -c 'SELECT 1' >/dev/null 2>&1; then
  mkdir -p "$BACKUP_DIR"
  RESPALDO="$BACKUP_DIR/pre-deploy-$(date +%F-%H%M).sql.gz"
  if sudo -u postgres pg_dump sicr3p | gzip > "$RESPALDO" 2>>"$LOG"; then
    log "respaldo pre-deploy OK: $RESPALDO"
  else
    log "ADVERTENCIA: falló el respaldo pre-deploy; el deploy continúa (no toca datos y las migraciones son aditivas)."
  fi
else
  log "ADVERTENCIA: pg_dump o la BD sicr3p no están disponibles; se omite el respaldo pre-deploy."
fi

# ---------- 5. Pull (solo fast-forward: jamás merge ni force) ----------
if ! git pull --ff-only --quiet origin "$RAMA" >> "$LOG" 2>&1; then
  log "ERROR: git pull --ff-only falló — la historia local divergió de origin/$RAMA. No se hace merge ni push forzado: revisar a mano en $REPO_DIR (git status / git log --oneline -5)."
  exit 1
fi

# ---------- 6. Build backend + frontend ----------
if ! construir; then
  log "ERROR: falló el build (npm ci / vite build); ver detalle arriba en $LOG."
  rollback
fi

# ---------- 7. Restart + health ----------
if ! reiniciar; then
  log "ERROR: falló el restart ($RESTART_CMD)."
  rollback
fi
if health_ok; then
  log "actualizado ${COMMIT_PREVIO:0:7} → $(git rev-parse --short HEAD)."
  exit 0
fi
log "ERROR: el health no respondió \"ok\":true en 30 s ($HEALTH_URL) o el frontend no carga ($FRONT_URL)."
rollback
