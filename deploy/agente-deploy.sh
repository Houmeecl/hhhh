#!/usr/bin/env bash
# ============================================================
# sicr3p — Wrapper del auto-deploy para cron (cada 30 min).
#
# Ejecuta deploy/actualizar.sh; si sale bien, termina en silencio.
# Si falla, invoca a `claude` en dos etapas:
#   1. DIAGNÓSTICO (solo lectura, siempre): deja el informe en /root/.
#   2. REPARACIÓN (opcional, SICR3P_AGENTE_REPARA=1): intenta arreglar
#      la causa y volver a desplegar, con una lista de comandos acotada.
#
# Por qué la reparación es razonablemente segura acá: el agente corre
# DESPUÉS del rollback, o sea con producción ya de vuelta en el último
# commit que sí funcionaba y sirviendo tráfico. El agente no rescata una
# caída — intenta destrabar el PRÓXIMO deploy. Y si su intento falla, el
# propio actualizar.sh vuelve a revertir.
#
# Lo que el agente NO puede hacer, ni con la reparación activada (no es
# una recomendación: son los comandos que su allowlist no incluye):
#   · git push / reset --hard / checkout de otra rama / rebase — la rama
#     de producción no se reescribe desde el servidor, jamás.
#   · rm -rf, mkfs, dd — nada destructivo sobre el disco.
#   · psql / pg_restore con escritura — no toca datos de clientes.
#   · editar código (Write/Edit): si el arreglo es un cambio de código,
#     eso pasa por el repo, con revisión y tests, como cualquier commit.
# Un agente con Bash(*) sería un cheque en blanco sobre producción; la
# allowlist de abajo es el límite real, no un comentario de buena fe.
#
# Instalación: bash deploy/actualizar.sh --instalar-cron
# Sobreescribibles: las mismas de actualizar.sh, más
#   SICR3P_DIAG_DIR       dónde dejar los informes (default /root)
#   SICR3P_AGENTE_REPARA  1 = el agente además intenta reparar
#   SICR3P_AGENTE_TIMEOUT segundos por etapa (default 600)
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="${SICR3P_DIR:-/opt/sicr3p}"
LOG="${SICR3P_LOG:-/var/log/sicr3p-actualizar.log}"
DIAG_DIR="${SICR3P_DIAG_DIR:-/root}"
# 300 s se quedaba corto y el informe salía a medias ("no terminó bien"),
# que es justo cuando más falta hace: leer el log + pm2 + curl y redactar
# no cabía en 5 minutos con el VPS ocupado por el build que acaba de fallar.
AGENTE_TIMEOUT="${SICR3P_AGENTE_TIMEOUT:-600}"

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

log "actualizar.sh salió con código $CODIGO; se pide diagnóstico."
if ! command -v claude >/dev/null 2>&1; then
  log "claude no instalado; revisar $LOG a mano."
  exit "$CODIGO"
fi

SELLO="$(date +%F-%H%M)"
INFORME="$DIAG_DIR/sicr3p-diagnostico-$SELLO.txt"

# Observación pura: nada de esta lista modifica el sistema.
TOOLS_LECTURA="Read,Grep,Glob,Bash(tail *),Bash(pm2 status),Bash(pm2 logs *),Bash(curl *),Bash(df *),Bash(git log *),Bash(git status)"

# ---------- 2. Diagnóstico (siempre, solo lectura) ----------
PROMPT_DIAG=$(cat <<FIN
El auto-deploy de sicr3p falló e hizo rollback. Lee $LOG (últimas 80 líneas) y \`pm2 logs sicr3p-backend --lines 50 --nostream\`, revisa el estado con pm2 status, el disco con df -h y curl al health. Escribe un DIAGNÓSTICO breve: causa probable, evidencia (líneas citadas), y el comando o corrección sugerida. Distingue explícitamente si lo que falló fue el health check o el smoke E2E — el log lo dice con una línea "ERROR:" distinta para cada uno. NO ejecutes ninguna reparación: en esta etapa tu trabajo es solo explicar.
FIN
)
( cd "$REPO_DIR" && timeout "$AGENTE_TIMEOUT" claude -p "$PROMPT_DIAG" \
    --allowedTools "$TOOLS_LECTURA" \
    > "$INFORME" 2>&1 ) \
  || log "el diagnóstico no terminó bien (timeout ${AGENTE_TIMEOUT}s o error); lo que alcanzó queda igual en el informe."
log "diagnóstico del agente en: $INFORME"

# ---------- 3. Reparación (opt-in) ----------
if [ "${SICR3P_AGENTE_REPARA:-0}" != "1" ]; then
  exit "$CODIGO"
fi

REPARACION="$DIAG_DIR/sicr3p-reparacion-$SELLO.txt"
log "SICR3P_AGENTE_REPARA=1 → el agente intentará reparar (informe: $REPARACION)."

# Allowlist de escritura: SOLO los comandos que destraban un deploy.
# Cada uno está acá porque corresponde a una causa real y conocida:
#   pm2 restart/flush  → backend colgado o log gigante
#   actualizar.sh      → reintentar (levanta cuarentena) o saltar el smoke
#   npm ci             → node_modules a medias tras un build cortado
#   rm -f de caches    → disco lleno por builds viejos (archivos puntuales)
# git NO está: la rama de producción no se reescribe desde el servidor.
TOOLS_REPARA="$TOOLS_LECTURA,Bash(pm2 restart *),Bash(pm2 flush *),Bash(bash deploy/actualizar.sh*),Bash(npm ci*),Bash(rm -f *),Bash(du *),Bash(free *)"

PROMPT_REPARA=$(cat <<FIN
Eres el agente de mantención del VPS de sicr3p. El auto-deploy acaba de fallar y ya se hizo rollback: producción está sirviendo el commit anterior, que SÍ funciona. Tu objetivo es destrabar el próximo deploy, no rescatar una caída.

Primero lee el diagnóstico que se acaba de escribir en $INFORME y el log $LOG.

Puedes intentar UNA reparación acotada. Opciones típicas, de menos a más invasiva:
  · Si el disco está lleno: borrar archivos de caché/builds viejos con rm -f (nunca rm -rf, nunca datos ni respaldos).
  · Si node_modules quedó a medias: npm ci en backend o frontend.
  · Si el backend quedó colgado: pm2 restart sicr3p-backend.
  · Si la causa fue el smoke E2E y el health estaba OK: reintentar con SICR3P_SKIP_SMOKE=1 bash deploy/actualizar.sh --reintentar
  · Si la causa fue el health (timeout de 80 s con las migraciones): reintentar tal cual con bash deploy/actualizar.sh --reintentar, que a veces pasa con el disco menos cargado.

REGLAS DURAS:
  · NO toques git (ni push, ni reset, ni checkout, ni rebase). Si el arreglo requiere cambiar código, NO lo hagas: descríbelo y termina.
  · NO borres datos, respaldos (/root/backups) ni tablas. Nada de psql con escritura.
  · UN solo intento de reparación y UN solo reintento de deploy. Si no resulta, para y explica — no entres en bucle.
  · Si no estás seguro de la causa, NO repares: escribe qué falta para saberlo.

Al terminar escribe: qué causa identificaste, qué comando ejecutaste (o por qué decidiste no tocar nada), y en qué estado quedó producción.
FIN
)
( cd "$REPO_DIR" && timeout "$AGENTE_TIMEOUT" claude -p "$PROMPT_REPARA" \
    --allowedTools "$TOOLS_REPARA" \
    > "$REPARACION" 2>&1 ) \
  || log "la reparación no terminó bien (timeout ${AGENTE_TIMEOUT}s o error); ver $REPARACION."
log "informe de reparación en: $REPARACION"

# Estado real tras el intento: lo que decide es el health, no lo que
# el agente crea haber logrado.
if curl -fs "${SICR3P_HEALTH_URL:-http://localhost:4000/api/health}" 2>/dev/null | grep -q '"ok":true'; then
  log "tras la reparación, el health responde OK (commit en disco: $(cd "$REPO_DIR" && git rev-parse --short HEAD))."
else
  log "ATENCIÓN: tras la reparación el health NO responde — revisar $REPARACION y pm2 logs sicr3p-backend."
fi

# ---------- 4. Salir con el código real (para monitoreo externo) ----------
exit "$CODIGO"
