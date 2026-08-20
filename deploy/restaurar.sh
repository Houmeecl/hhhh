#!/usr/bin/env bash
# ============================================================
# sicr3p — Restauración de un respaldo (deploy/respaldo.sh /
# deploy/actualizar.sh) para verificarlo o para recuperar la BD real.
#
# Uso:
#   bash deploy/restaurar.sh ARCHIVO.sql.gz              → modo ENSAYO
#     (default, seguro): restaura en una base nueva
#     sicr3p_restaurado_<AAAAMMDD-HHMMSS> y compara conteos de tablas
#     contra sicr3p. No toca la base real. Se borra sola al terminar
#     salvo que se pase --conservar.
#
#   bash deploy/restaurar.sh ARCHIVO.sql.gz --reemplazar → modo REAL
#     (destructivo): reemplaza la base "sicr3p" por el contenido del
#     respaldo. Solo para recuperación de desastre real (disco/VPS
#     perdido). Antes de tocar nada toma un respaldo de seguridad de
#     lo que haya en "sicr3p" ahora mismo (si existe), y exige escribir
#     la palabra REEMPLAZAR para confirmar.
#
# Sin argumentos, usa el respaldo más reciente de /root/backups para la
# base elegida (sicr3p-*.sql.gz, el diario — no un pre-deploy).
#
# Para el Corredor Bioceánico, que vive en su propia base:
#   SICR3P_DB=sicr3p_corredor bash deploy/restaurar.sh
#
# Variables sobreescribibles: SICR3P_BACKUP_DIR, SICR3P_DB (default: sicr3p)
# ============================================================
set -euo pipefail

BACKUP_DIR="${SICR3P_BACKUP_DIR:-/root/backups}"
DB="${SICR3P_DB:-sicr3p}"
CONSERVAR=0
REEMPLAZAR=0
ARCHIVO=""

for arg in "$@"; do
  case "$arg" in
    --reemplazar) REEMPLAZAR=1 ;;
    --conservar) CONSERVAR=1 ;;
    *) ARCHIVO="$arg" ;;
  esac
done

# El patrón depende de la BASE, no es fijo. Los respaldos del Corredor se
# llaman "sicr3p_corredor-AAAA-MM-DD.sql.gz" (guión bajo), justamente para
# que no calcen con "sicr3p-*.sql.gz". Sin esto, pedir el respaldo del
# Corredor sin nombrar el archivo agarraba el dump de sicr3p y lo
# restauraba encima: dos bases distintas, mismo comando, y el error solo
# se nota cuando ya pasó.
PATRON="$BACKUP_DIR/${DB}-*.sql.gz"

if [ -z "$ARCHIVO" ]; then
  ARCHIVO="$(ls -t $PATRON 2>/dev/null | head -1 || true)"
  if [ -z "$ARCHIVO" ]; then
    echo "No se encontró ningún respaldo en $PATRON y no se indicó un archivo. Uso: bash deploy/restaurar.sh ARCHIVO.sql.gz [--reemplazar]" >&2
    exit 1
  fi
  echo "==> Sin archivo indicado: usando el más reciente de \"$DB\": $ARCHIVO"
fi

# Guarda contra el error más caro de este script: restaurar el respaldo de
# una base sobre la OTRA. El nombre del archivo lleva el de su base, así
# que se puede comprobar antes de tocar nada.
BASE_ARCHIVO="$(basename "$ARCHIVO")"
# `pre-deploy-*` lo genera deploy/actualizar.sh y es SIEMPRE de la base
# principal, así que solo se acepta cuando se está restaurando esa.
PERMITIDOS_EXTRA=""
[ "$DB" = "sicr3p" ] && PERMITIDOS_EXTRA="pre-deploy"
case "$BASE_ARCHIVO" in
  "${DB}-"*|"pre-restaurar-${DB}-"*) : ;;
  pre-deploy-*) [ "$PERMITIDOS_EXTRA" = "pre-deploy" ] || {
      echo "\"$BASE_ARCHIVO\" es un respaldo pre-deploy de la base principal, no de \"$DB\"." >&2
      exit 1
    } ;;
  *)
    echo "El archivo \"$BASE_ARCHIVO\" no parece un respaldo de la base \"$DB\": los respaldos de esa base se llaman \"${DB}-AAAA-MM-DD.sql.gz\"." >&2
    echo "Restaurar el dump de una base sobre la otra es el error más caro de este script, así que no se hace solo." >&2
    echo "Si el archivo es de otra base, restáuralo en la suya: SICR3P_DB=<la base del archivo> bash deploy/restaurar.sh $ARCHIVO" >&2
    exit 1
    ;;
esac

if [ ! -f "$ARCHIVO" ]; then
  echo "No existe el archivo: $ARCHIVO" >&2
  exit 1
fi

if [ "$REEMPLAZAR" = "1" ]; then
  echo "============================================================"
  echo " MODO REEMPLAZAR: esto BORRA la base \"$DB\" actual y la"
  echo " reconstruye desde $ARCHIVO."
  echo "============================================================"
  read -r -p "Escribe REEMPLAZAR (en mayúsculas) para continuar: " CONFIRMA
  if [ "$CONFIRMA" != "REEMPLAZAR" ]; then
    echo "Cancelado: no se escribió REEMPLAZAR."
    exit 1
  fi

  # Respaldo de seguridad de lo que haya AHORA, antes de tocar nada — si el
  # archivo a restaurar resulta corrupto o es el equivocado, esto no se pierde.
  if sudo -u postgres psql -lqt | cut -d '|' -f 1 | grep -qw "$DB"; then
    # Con el nombre de la base adentro: un "pre-restaurar-*" suelto no
    # decía de cuál de las dos era, y ese archivo existe justamente para
    # el momento en que alguien restauró el respaldo equivocado.
    PRE="$BACKUP_DIR/pre-restaurar-${DB}-$(date +%F-%H%M%S).sql.gz"
    mkdir -p "$BACKUP_DIR"
    echo "==> Respaldo de seguridad de \"$DB\" antes de reemplazar: $PRE"
    sudo -u postgres pg_dump "$DB" | gzip > "$PRE"

    echo "==> Terminando conexiones activas a \"$DB\"…"
    # Script temporal en vez de -c: :'db' (variable de psql) solo se
    # sustituye leyendo desde archivo (-f), no en el string de -c. Con esto
    # psql cita el literal SQL correctamente — a diferencia de interpolar
    # "$DB" directo en el string, esto no se rompe si el nombre de base
    # tuviera una comilla.
    SQL_TMP="$(mktemp)"
    echo "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = :'db' AND pid <> pg_backend_pid();" > "$SQL_TMP"
    chmod 644 "$SQL_TMP"
    sudo -u postgres psql -d postgres -v db="$DB" -f "$SQL_TMP" >/dev/null
    rm -f "$SQL_TMP"

    echo "==> Borrando \"$DB\"…"
    sudo -u postgres dropdb "$DB"
  fi

  echo "==> Creando \"$DB\" y restaurando…"
  sudo -u postgres createdb "$DB"
  gunzip -c "$ARCHIVO" | sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 >/dev/null

  echo "==> OK. \"$DB\" reemplazada desde $ARCHIVO."
  echo "==> Reinicia el backend para que reabra las conexiones: pm2 restart sicr3p-backend"
  exit 0
fi

# ---------- Modo ENSAYO (default, no destructivo) ----------
DB_ENSAYO="${DB}_restaurado_$(date +%Y%m%d-%H%M%S)"
echo "==> Modo ENSAYO: restaurando $ARCHIVO en una base nueva ($DB_ENSAYO), sin tocar \"$DB\"."

sudo -u postgres createdb "$DB_ENSAYO"
limpiar() {
  if [ "$CONSERVAR" = "1" ]; then
    echo "==> --conservar: se deja \"$DB_ENSAYO\" para inspección manual."
    echo "    Borrarla después con: sudo -u postgres dropdb $DB_ENSAYO"
  else
    sudo -u postgres dropdb "$DB_ENSAYO" 2>/dev/null || true
  fi
}
trap limpiar EXIT

if ! gunzip -c "$ARCHIVO" | sudo -u postgres psql -d "$DB_ENSAYO" -v ON_ERROR_STOP=1 >/dev/null; then
  echo "FALLÓ la restauración del respaldo en $DB_ENSAYO. El archivo puede estar corrupto o incompleto." >&2
  exit 1
fi

echo "==> Restauración OK. Comparando conteo de tablas contra \"$DB\" (si existe)…"
TABLAS_ENSAYO=$(sudo -u postgres psql -d "$DB_ENSAYO" -Atc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
echo "    Tablas en el respaldo restaurado: $TABLAS_ENSAYO"

if sudo -u postgres psql -lqt | cut -d '|' -f 1 | grep -qw "$DB"; then
  TABLAS_ACTUAL=$(sudo -u postgres psql -d "$DB" -Atc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
  # Tabla testigo: la que de verdad importa en cada base. En sicr3p es
  # `facturas`; en la del Corredor esa tabla no existe y la evidencia
  # sellada vive en `carga_documentos`. Se ELIGE MIRANDO cuál existe, no
  # por el nombre de la base: una base de ensayo o un rename dejarían la
  # comparación en "? · ?" y el ensayo pasaría sin haber comprobado nada,
  # que es exactamente lo que este script existe para no hacer.
  TESTIGO=""
  for CANDIDATA in facturas carga_documentos; do
    if sudo -u postgres psql -d "$DB_ENSAYO" -Atc "SELECT 1 FROM $CANDIDATA LIMIT 1" >/dev/null 2>&1; then
      TESTIGO="$CANDIDATA"
      break
    fi
  done
  echo "    Tablas en \"$DB\" (vigente): $TABLAS_ACTUAL"
  if [ -n "$TESTIGO" ]; then
    FILAS_ENSAYO=$(sudo -u postgres psql -d "$DB_ENSAYO" -Atc "SELECT count(*) FROM $TESTIGO" 2>/dev/null || echo "?")
    FILAS_ACTUAL=$(sudo -u postgres psql -d "$DB" -Atc "SELECT count(*) FROM $TESTIGO" 2>/dev/null || echo "?")
    echo "    Filas en $TESTIGO — respaldo: $FILAS_ENSAYO · vigente: $FILAS_ACTUAL"
  else
    echo "    ! Ni 'facturas' ni 'carga_documentos' existen en el respaldo: no se pudo comparar contenido."
  fi
else
  echo "    (\"$DB\" no existe en este Postgres; sin comparación posible.)"
fi

echo "==> Ensayo de restauración completo el $(date '+%F %T'). $([ "$CONSERVAR" = "1" ] && echo "Base de ensayo conservada: $DB_ENSAYO." || echo "Base de ensayo borrada.")"
echo "    Deja constancia de esta fecha en deploy/AUTODEPLOY.md (bitácora de restauraciones ensayadas)."
