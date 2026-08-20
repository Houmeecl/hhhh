#!/usr/bin/env bash
# ============================================================
# sicr3p — Enciende el Corredor Bioceánico en el VPS.
#
# El Corredor vive en su PROPIA base (`sicr3p_corredor`), en el mismo
# Postgres. No es una preferencia de estilo: `ERROR: cross-database
# references are not implemented` es la garantía a nivel de motor de que
# los dos mundos no se mezclan. Otros usuarios, otra cadena de hash, otro
# secreto de firma.
#
# Y es OPCIONAL: sin `DATABASE_URL_CORREDOR` el backend arranca igual y
# las rutas del Corredor responden 503 con `codigo: corredor_no_configurado`
# (ver src/lib/migrate.js → runMigrationsCorredor, que devuelve el estado
# en vez de lanzar, justamente para que un Corredor mal configurado no
# tumbe sicr3p entero). Este script es lo que lo enciende.
#
# Uso (como root en el VPS, repo en /opt/sicr3p):
#   bash deploy/encender-corredor.sh
#   bash deploy/encender-corredor.sh --admin correo@dominio.cl
#   bash deploy/encender-corredor.sh --verificar    → solo diagnostica
#
# Es IDEMPOTENTE: correrlo dos veces no rota claves, no duplica líneas del
# .env ni pisa la base. Se puede volver a correr después de cada deploy sin
# pensarlo.
#
# Variables sobreescribibles: SICR3P_DIR, SICR3P_DB_CORREDOR,
# SICR3P_HEALTH_URL, SICR3P_RESTART_CMD
# ============================================================
set -euo pipefail

DIR="${SICR3P_DIR:-/opt/sicr3p}"
DB="${SICR3P_DB_CORREDOR:-sicr3p_corredor}"
ENV_FILE="$DIR/backend/.env"
HEALTH_URL="${SICR3P_HEALTH_URL:-http://localhost:4000/api/health}"
# Sin token a propósito: la respuesta distingue los dos estados que
# importan. 503 = el Corredor no está configurado (el guard
# `requireCorredorActivo` va PRIMERO, antes de mirar el token);
# 401 = está configurado y solo falta autenticarse, que es el éxito.
SONDA_URL="${SICR3P_SONDA_URL:-http://localhost:4000/api/corredor/catalogo/puntos}"
RESTART_CMD="${SICR3P_RESTART_CMD:-pm2 restart sicr3p-backend}"

SOLO_VERIFICAR=0
ADMIN_EMAIL=""
ADMIN_NOMBRE="Administrador del Corredor"

while [ $# -gt 0 ]; do
  case "$1" in
    --verificar) SOLO_VERIFICAR=1 ;;
    --admin) ADMIN_EMAIL="${2:-}"; shift ;;
    --nombre) ADMIN_NOMBRE="${2:-}"; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; exit 1 ;;
  esac
  shift
done

paso() { echo "==> $*"; }
aviso() { echo "    ! $*"; }

# ------------------------------------------------------------
# 0. Comprobaciones previas
# ------------------------------------------------------------
[ -f "$ENV_FILE" ] || { echo "No existe $ENV_FILE. Corre antes deploy/instalar-vps.sh." >&2; exit 1; }
command -v psql >/dev/null || { echo "psql no está instalado." >&2; exit 1; }

# La clave sale del DATABASE_URL que ya funciona: el Corredor usa el MISMO
# rol de Postgres, no uno nuevo. Inventar un rol aparte agregaría una clave
# más que rotar sin agregar aislamiento — el aislamiento lo da la base
# distinta, no el usuario.
DB_PASS="$(grep '^DATABASE_URL=' "$ENV_FILE" | head -1 | sed -E 's|.*://[^:]+:([^@]+)@.*|\1|')"
DB_USER="$(grep '^DATABASE_URL=' "$ENV_FILE" | head -1 | sed -E 's|.*://([^:]+):[^@]+@.*|\1|')"
DB_HOSTPORT="$(grep '^DATABASE_URL=' "$ENV_FILE" | head -1 | sed -E 's|.*@([^/]+)/.*|\1|')"
if [ -z "$DB_PASS" ] || [ -z "$DB_USER" ]; then
  echo "No se pudo leer usuario/clave desde DATABASE_URL en $ENV_FILE." >&2
  exit 1
fi

# ------------------------------------------------------------
# 1. La base
# ------------------------------------------------------------
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB'" | grep -q 1; then
  paso "La base \"$DB\" ya existe."
else
  if [ "$SOLO_VERIFICAR" = "1" ]; then
    aviso "La base \"$DB\" NO existe. (--verificar: no se crea nada)"
  else
    paso "Creando la base \"$DB\" (dueño: $DB_USER)…"
    sudo -u postgres psql -c "CREATE DATABASE $DB OWNER $DB_USER;"
  fi
fi

# pgcrypto lo pide `migrations-corredor/001` para gen_random_uuid().
#
# Desde PostgreSQL 13 pgcrypto es una extensión "trusted": el DUEÑO de la
# base la puede crear sin ser superusuario, y por eso la migración 001
# funciona sola (comprobado contra PostgreSQL 16 con el rol "$DB_USER" sin
# rolsuper). Se deja igual, como red por dos motivos concretos:
#   · si el VPS corriera PostgreSQL 12 o anterior, ahí SÍ hace falta
#     superusuario y sin esto la migración 001 moriría con "permission
#     denied to create extension" — y el Corredor quedaría apagado sin que
#     nadie se entere, porque runMigrationsCorredor() devuelve el error en
#     vez de lanzarlo;
#   · si alguien creara la base a mano con otro dueño, el rol del backend
#     tampoco podría crearla.
# Ya creada, el `CREATE EXTENSION IF NOT EXISTS` de la migración es un
# no-op. Es el mismo paso que instalar-vps.sh hace con pg_trgm.
if [ "$SOLO_VERIFICAR" != "1" ]; then
  sudo -u postgres psql -d "$DB" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;" >/dev/null
  paso "Extensión pgcrypto lista en \"$DB\"."
fi

# ------------------------------------------------------------
# 2. Las dos variables del .env
# ------------------------------------------------------------
# Se AGREGAN si faltan; nunca se pisan. Rotar JWT_SECRET_CORREDOR de golpe
# invalida todas las sesiones abiertas del panel, y eso lo decide una
# persona, no un script de instalación que alguien vuelve a correr.
agregar_env() {
  local clave="$1" valor="$2"
  if grep -q "^${clave}=" "$ENV_FILE"; then
    paso "$clave ya está en backend/.env: no se toca."
    return
  fi
  if [ "$SOLO_VERIFICAR" = "1" ]; then
    aviso "$clave NO está en backend/.env. (--verificar: no se escribe nada)"
    return
  fi
  printf '%s=%s\n' "$clave" "$valor" >> "$ENV_FILE"
  paso "$clave agregada a backend/.env."
}

if [ "$SOLO_VERIFICAR" != "1" ] && ! grep -q '^DATABASE_URL_CORREDOR=' "$ENV_FILE"; then
  # Encabezado explicativo, una sola vez, para quien abra el .env después.
  cat >> "$ENV_FILE" <<'CABECERA'

# --- Corredor Bioceánico (base APARTE, mismo Postgres) ---
# Opcional: sin estas dos variables el subsistema queda apagado y el resto
# de sicr3p arranca igual (las rutas responden 503). Puestas por
# deploy/encender-corredor.sh.
CABECERA
fi

agregar_env DATABASE_URL_CORREDOR "postgresql://${DB_USER}:${DB_PASS}@${DB_HOSTPORT}/${DB}"
agregar_env JWT_SECRET_CORREDOR "$(openssl rand -hex 48)"

# El .env lleva secretos: que no lo lea cualquiera con cuenta en la máquina.
chmod 600 "$ENV_FILE" 2>/dev/null || true

# ------------------------------------------------------------
# 3. Reiniciar y verificar
# ------------------------------------------------------------
if [ "$SOLO_VERIFICAR" != "1" ]; then
  paso "Reiniciando el backend para que aplique las migraciones del Corredor…"
  # Las migraciones corren solas al arrancar (src/index.js →
  # runMigrationsCorredor). No hay comando de migración aparte a propósito:
  # migrate.js no lleva registro y todos los .sql son idempotentes.
  eval "$RESTART_CMD" >/dev/null 2>&1 || aviso "No se pudo ejecutar: $RESTART_CMD"
  for _ in $(seq 1 20); do
    curl -fsS "$HEALTH_URL" >/dev/null 2>&1 && break
    sleep 1
  done
fi

paso "Verificando…"
if ! curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
  echo "    ! El backend no responde en $HEALTH_URL. Revisa: pm2 logs sicr3p-backend" >&2
  exit 1
fi
echo "    · backend arriba"

CODIGO="$(curl -s -o /dev/null -w '%{http_code}' "$SONDA_URL" || echo 000)"
case "$CODIGO" in
  401) echo "    · Corredor ENCENDIDO (la sonda pide autenticación, que es lo correcto)" ;;
  503) echo "    ! Corredor APAGADO: el backend no ve DATABASE_URL_CORREDOR." >&2
       echo "      Revisa backend/.env y que el reinicio haya tomado efecto." >&2
       exit 1 ;;
  *)   echo "    ! Respuesta inesperada de la sonda ($CODIGO). Revisa: pm2 logs sicr3p-backend" >&2
       exit 1 ;;
esac

TABLAS="$(sudo -u postgres psql -d "$DB" -Atc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null || echo 0)"
PUNTOS="$(sudo -u postgres psql -d "$DB" -Atc "SELECT count(*) FROM puntos_corredor" 2>/dev/null || echo 0)"
REGLAS="$(sudo -u postgres psql -d "$DB" -Atc "SELECT count(*) FROM documentos_por_tramo" 2>/dev/null || echo 0)"
echo "    · $TABLAS tablas · $PUNTOS puntos de control · $REGLAS reglas de documentos por tramo"
if [ "$PUNTOS" -lt 1 ] 2>/dev/null; then
  aviso "Sin puntos de control no se puede definir un tramo. ¿Corrió migrations-corredor/003?"
fi

# La otra base sigue intacta y separada: si esto fallara, el aislamiento
# que sostiene todo el diseño no estaría donde se cree que está.
if sudo -u postgres psql -d "$DB" -Atc "SELECT count(*) FROM facturas" >/dev/null 2>&1; then
  echo "    ! La base del Corredor tiene una tabla 'facturas': las dos bases se mezclaron." >&2
  exit 1
fi
echo "    · separación confirmada: la base del Corredor no ve las tablas de sicr3p"

# ------------------------------------------------------------
# 4. Primer administrador (opcional)
# ------------------------------------------------------------
if [ -n "$ADMIN_EMAIL" ] && [ "$SOLO_VERIFICAR" != "1" ]; then
  paso "Creando el primer administrador del Corredor…"
  ( cd "$DIR/backend" && node scripts/crear-admin-corredor.mjs "$ADMIN_EMAIL" "$ADMIN_NOMBRE" )
fi

echo
if [ "$SOLO_VERIFICAR" = "1" ]; then
  echo "Diagnóstico terminado. No se modificó nada."
else
  echo "Corredor encendido. Panel: https://corredor.sicr3p.cl (o /panel-corredor)."
  if [ -z "$ADMIN_EMAIL" ]; then
    echo "Falta el primer administrador — sin él no se pueden crear exportadores:"
    echo "  bash deploy/encender-corredor.sh --admin correo@dominio.cl"
  fi
  echo "El respaldo diario ya incluye \"$DB\" (deploy/respaldo.sh)."
fi
