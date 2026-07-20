#!/usr/bin/env bash
# ============================================================
# sicr3p — Expone docs/comercial/ y docs/metodologia/ como archivos
# estáticos servidos por nginx, para poder compartir los PDFs por URL
# (leerlos en el navegador, mandar el link a un mandante, etc.).
#
# Deliberadamente NO expone docs/legal/: son BORRADORES marcados
# "NO PUBLICAR SIN ABOGADO" (ver docs/legal/*.md) — jamás deben quedar
# accesibles por web hasta que un abogado los revise y el usuario decida
# publicarlos.
#
# Uso (como root en el VPS, repo en /opt/sicr3p):
#   bash deploy/servir-docs.sh
#
# Idempotente: si el bloque ya está en la config de nginx, no hace nada.
# ============================================================
set -euo pipefail

DIR="${SICR3P_DIR:-/opt/sicr3p}"
CONF=/etc/nginx/sites-available/sicr3p

if [ ! -f "$CONF" ]; then
  echo "ERROR: no existe $CONF — corre primero deploy/instalar-vps.sh"
  exit 1
fi

if grep -q 'location /docs/comercial/' "$CONF"; then
  echo "==> Ya estaba servido (/docs/comercial/ y /docs/metodologia/ en $CONF). Nada que hacer."
else
  # Inserta los location ANTES del cierre final del bloque server { ... }.
  # El archivo lo genera instalar-vps.sh y termina en una línea "}" sola.
  TMP="$(mktemp)"
  head -n -1 "$CONF" > "$TMP"
  cat >> "$TMP" <<NGINX

    # Documentos comerciales y metodológicos — público a propósito.
    # docs/legal/ NUNCA se sirve aquí (borradores sin revisión de abogado).
    location /docs/comercial/ {
        alias $DIR/docs/comercial/;
        autoindex on;
    }
    location /docs/metodologia/ {
        alias $DIR/docs/metodologia/;
        autoindex on;
    }
}
NGINX
  mv "$TMP" "$CONF"
  nginx -t && systemctl reload nginx
  echo "==> nginx actualizado y recargado."
fi

echo
echo "PDFs accesibles en (reemplaza por tu dominio o IP real):"
for f in "$DIR"/docs/comercial/*.pdf "$DIR"/docs/metodologia/*.pdf; do
  [ -f "$f" ] && echo "  http://<tu-dominio-o-IP>/docs/${f#"$DIR"/docs/}"
done
