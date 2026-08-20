#!/usr/bin/env bash
# ============================================================
# sicr3p — Respaldo diario de las bases de datos.
# Genera /root/backups/sicr3p-AAAA-MM-DD.sql.gz y, si el Corredor está
# encendido, también sicr3p_corredor-AAAA-MM-DD.sql.gz. Conserva 14 días.
# Instalado como cron por deploy/instalar-vps.sh (03:00).
# Restaurar: ver deploy/restaurar.sh (o a mano:
#   gunzip -c archivo.sql.gz | sudo -u postgres psql -d sicr3p)
# Para el Corredor: SICR3P_DB=sicr3p_corredor bash deploy/restaurar.sh
# ============================================================
set -euo pipefail

DEST="${1:-/root/backups}"
mkdir -p "$DEST"

ARCHIVO="$DEST/sicr3p-$(date +%F).sql.gz"
sudo -u postgres pg_dump sicr3p | gzip > "$ARCHIVO"

# Conservar solo los últimos 14 días de este respaldo diario.
find "$DEST" -name 'sicr3p-*.sql.gz' -mtime +14 -delete

# deploy/actualizar.sh genera OTRO respaldo antes de cada deploy
# (pre-deploy-AAAA-MM-DD-HHMM.sql.gz, uno por commit, cron cada 30 min) con un
# patrón de nombre distinto al de arriba — sin esta línea esos archivos jamás
# se podaban y el disco se llenaba solo (hallazgo real: el disco puede estar
# lleno ahora mismo en el VPS si nadie corrió esto antes). Retención corta
# porque son muchos más frecuentes que el diario.
find "$DEST" -name 'pre-deploy-*.sql.gz' -mtime +5 -delete

echo "[respaldo] OK: $ARCHIVO ($(du -h "$ARCHIVO" | cut -f1))"

# ---------- Corredor Bioceánico ----------
# Vive en OTRA base (sicr3p_corredor, mismo Postgres) y por lo tanto NO
# entra en el pg_dump de arriba. Ahí está la cadena de hash de los
# documentos de carga, que es propia y no se puede reconstruir desde la
# base principal: perderla es perder la evidencia sellada.
#
# El nombre del archivo empieza con "sicr3p_" (guión bajo) para que NO
# calce con el patrón 'sicr3p-*.sql.gz' de arriba: si calzara, la poda de
# 14 días y el "usa el más reciente" de restaurar.sh mezclarían las dos
# bases, y restaurar el archivo equivocado sobre la base equivocada es
# peor que no tener respaldo.
#
# Opcional a propósito: si el Corredor no está encendido en este servidor,
# esto no es un error ni tiene que hacer fallar el respaldo diario.
DB_CORREDOR="${SICR3P_DB_CORREDOR:-sicr3p_corredor}"
if sudo -u postgres psql -lqt | cut -d '|' -f 1 | grep -qw "$DB_CORREDOR"; then
  ARCHIVO_CORREDOR="$DEST/${DB_CORREDOR}-$(date +%F).sql.gz"
  sudo -u postgres pg_dump "$DB_CORREDOR" | gzip > "$ARCHIVO_CORREDOR"
  find "$DEST" -name "${DB_CORREDOR}-*.sql.gz" -mtime +14 -delete
  echo "[respaldo] OK: $ARCHIVO_CORREDOR ($(du -h "$ARCHIVO_CORREDOR" | cut -f1))"
else
  echo "[respaldo] El Corredor no está en este servidor ($DB_CORREDOR no existe): nada que respaldar de ahí."
fi

# Aviso de disco — no aborta nada, solo deja constancia en el log del cron
# para que un humano lo vea antes de que el disco lleno tumbe un deploy.
USO_DISCO=$(df -P "$DEST" | awk 'NR==2 {gsub("%","",$5); print $5}')
if [ -n "$USO_DISCO" ] && [ "$USO_DISCO" -ge 85 ]; then
  echo "[respaldo] ADVERTENCIA: el disco de $DEST está al ${USO_DISCO}% — revisar 'du -sh $DEST' y 'df -h'."
fi
