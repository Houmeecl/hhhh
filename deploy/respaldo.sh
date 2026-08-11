#!/usr/bin/env bash
# ============================================================
# sicr3p — Respaldo diario de la base de datos.
# Genera /root/backups/sicr3p-AAAA-MM-DD.sql.gz y conserva 14 días.
# Instalado como cron por deploy/instalar-vps.sh (03:00).
# Restaurar: ver deploy/restaurar.sh (o a mano:
#   gunzip -c archivo.sql.gz | sudo -u postgres psql -d sicr3p)
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

# Aviso de disco — no aborta nada, solo deja constancia en el log del cron
# para que un humano lo vea antes de que el disco lleno tumbe un deploy.
USO_DISCO=$(df -P "$DEST" | awk 'NR==2 {gsub("%","",$5); print $5}')
if [ -n "$USO_DISCO" ] && [ "$USO_DISCO" -ge 85 ]; then
  echo "[respaldo] ADVERTENCIA: el disco de $DEST está al ${USO_DISCO}% — revisar 'du -sh $DEST' y 'df -h'."
fi
