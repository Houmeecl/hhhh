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

# Inserta bloques ANTES del cierre final del bloque server { ... }.
# El archivo lo genera instalar-vps.sh y termina en una línea "}" sola.
insertar_bloques() {
  TMP="$(mktemp)"
  head -n -1 "$CONF" > "$TMP"
  cat >> "$TMP"
  echo "}" >> "$TMP"
  mv "$TMP" "$CONF"
}

CAMBIO=0
if ! grep -q 'location /docs/comercial/' "$CONF"; then
  insertar_bloques <<NGINX

    # Documentos comerciales y metodológicos — público a propósito.
    # docs/legal/ NUNCA se sirve aquí (borradores sin revisión de abogado).
    # El documento 2 se llamaba 02-aduana-verde.pdf y ese enlace ya salió
    # repartido a empresas. El archivo cambió de nombre con la marca; el 301
    # lo resuelve para que el PDF entregado siga abriendo.
    location = /docs/comercial/02-aduana-verde.pdf {
        return 301 /docs/comercial/02-terreno.pdf;
    }
    location /docs/comercial/ {
        alias $DIR/docs/comercial/;
        autoindex on;
    }
    location /docs/metodologia/ {
        alias $DIR/docs/metodologia/;
        autoindex on;
    }
NGINX
  CAMBIO=1
fi

# El Libro del proyecto (web navegable + PDF) — puede faltar aunque los
# bloques anteriores ya existan (configs parchadas antes de esta versión).
if ! grep -q 'location /docs/libro/' "$CONF"; then
  insertar_bloques <<NGINX

    # El Libro sicr3p — el proyecto completo, navegable e imprimible.
    location /docs/libro/ {
        alias $DIR/docs/libro/;
        index index.html;
    }
NGINX
  CAMBIO=1
fi

if [ "$CAMBIO" -eq 1 ]; then
  nginx -t && systemctl reload nginx
  echo "==> nginx actualizado y recargado."
else
  echo "==> Ya estaba todo servido (comercial, metodologia y libro en $CONF). Nada que hacer."
fi

echo
echo "PDFs accesibles en (reemplaza por tu dominio o IP real):"
for f in "$DIR"/docs/comercial/*.pdf "$DIR"/docs/metodologia/*.pdf "$DIR"/docs/libro/*.pdf; do
  [ -f "$f" ] && echo "  http://<tu-dominio-o-IP>/docs/${f#"$DIR"/docs/}"
done
echo "  http://<tu-dominio-o-IP>/docs/libro/   ← El Libro del proyecto (web con menú)"
