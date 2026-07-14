#!/usr/bin/env bash
# ============================================================
# sicr3p — Respaldo diario de la base de datos.
# Genera /root/backups/sicr3p-AAAA-MM-DD.sql.gz y conserva 14 días.
# Instalado como cron por deploy/instalar-vps.sh (03:00).
# Restaurar: gunzip -c archivo.sql.gz | sudo -u postgres psql -d sicr3p
# ============================================================
set -euo pipefail

DEST="${1:-/root/backups}"
mkdir -p "$DEST"

ARCHIVO="$DEST/sicr3p-$(date +%F).sql.gz"
sudo -u postgres pg_dump sicr3p | gzip > "$ARCHIVO"

# Conservar solo los últimos 14 días.
find "$DEST" -name 'sicr3p-*.sql.gz' -mtime +14 -delete

echo "[respaldo] OK: $ARCHIVO ($(du -h "$ARCHIVO" | cut -f1))"
