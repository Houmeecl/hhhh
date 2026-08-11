#!/usr/bin/env bash
# ============================================================
# sicr3p — Agrega soporte para www.<dominio> a un sitio ya instalado.
#
# Uso (como root, en el VPS con sicr3p ya corriendo):
#   bash deploy/agregar-www.sh sicr3p.cl
#
# Qué hace: agrega www.<dominio> al server_name de nginx (si no está ya) y
# expande el certificado de certbot para que cubra ambos — sin esto, entrar
# por www muestra el candado en rojo (ni nginx responde ese Host, ni el
# certificado lo cubre).
#
# Requisito previo: el DNS de www.<dominio> (registro A o CNAME) debe
# apuntar a este servidor ANTES de correr esto — certbot valida el dominio
# por HTTP, así que si no resuelve todavía, falla.
# ============================================================
set -euo pipefail

DOMINIO="${1:?Uso: bash deploy/agregar-www.sh <dominio>, ej: sicr3p.cl}"
CONF="/etc/nginx/sites-available/sicr3p"

if [ ! -f "$CONF" ]; then
  echo "ERROR: no existe $CONF — este script asume que instalar-vps.sh ya corrió con dominio."
  exit 1
fi

# Idempotente: solo agrega www.$DOMINIO si el server_name no lo tiene ya.
if grep -q "server_name.*www\.$DOMINIO" "$CONF"; then
  echo "==> nginx ya sirve www.$DOMINIO — nada que agregar ahí."
else
  sed -i "s/server_name $DOMINIO;/server_name $DOMINIO www.$DOMINIO;/" "$CONF"
  nginx -t && systemctl reload nginx
  echo "==> nginx ahora sirve $DOMINIO y www.$DOMINIO."
fi

# Expande el certificado existente para que cubra ambos nombres.
apt-get install -y certbot python3-certbot-nginx >/dev/null
certbot --nginx --expand -d "$DOMINIO" -d "www.$DOMINIO" --non-interactive --agree-tos -m "admin@$DOMINIO"

echo "==> Listo. Verifica: curl -sI https://www.$DOMINIO | head -1"
