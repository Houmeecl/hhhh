#!/usr/bin/env bash
# ============================================================
# sicr3p — Por qué no abre el webmail (SOLO LECTURA).
#
# Uso, EN EL VPS:  bash deploy/diagnosticar-webmail.sh mail.sicr3p.cl
#
# QUÉ RESUELVE. «No abre» tiene cuatro causas muy distintas que se ven
# iguales desde el navegador, y adivinar cuál es sale caro:
#
#   1. Nada escucha en 443.
#   2. Escucha nginx pero no tiene vhost para ese nombre → contesta el
#      server por defecto, con el certificado de otro dominio, y el
#      navegador lo bloquea antes de mostrar nada.
#   3. Un contenedor de correo quiere los puertos 80/443 que nginx ya
#      tiene tomados, así que no arranca — el caso típico al instalar un
#      stack de correo en el mismo VPS que sirve el sitio.
#   4. Hay vhost pero no hay certificado para ESE nombre.
#
# Este script no arregla nada ni toca configuración: mira y reporta. Lo
# que decida hacerse después depende de qué stack se instaló, y eso lo
# sabe quien lo instaló, no un script.
# ============================================================
set -uo pipefail

HOST="${1:-mail.sicr3p.cl}"
OK="✓"; NO="✗"; DUDA="·"

echo "==> Diagnóstico de $HOST"
echo

# ---------- 1. DNS ----------
echo "-- DNS"
IP=$(getent hosts "$HOST" 2>/dev/null | head -1 | awk '{print $1}')
if [ -n "$IP" ]; then
  echo "  $OK $HOST resuelve a $IP"
  IP_LOCAL=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -v '^$' | head -5 | tr '\n' ' ')
  if echo "$IP_LOCAL" | grep -qw "$IP"; then
    echo "  $OK esa IP es la de esta máquina"
  else
    echo "  $NO esa IP NO es de esta máquina (acá: ${IP_LOCAL:-desconocida})"
    echo "     → el nombre apunta a otro servidor; mirar ahí, no acá"
  fi
else
  echo "  $NO $HOST no resuelve — falta el registro A"
fi
echo

# ---------- 2. ¿Quién tiene los puertos? ----------
echo "-- Puertos"
for p in 80 443 25 465 587 993; do
  DUENO=$(ss -lntp 2>/dev/null | awk -v p=":$p\$" '$4 ~ p {print $NF; exit}')
  if [ -n "$DUENO" ]; then
    echo "  $OK $p ocupado por ${DUENO#users:}"
  else
    echo "  $NO $p sin nadie escuchando"
  fi
done
echo "  (443 y 25 vacíos con un servidor de correo instalado = el servicio"
echo "   no levantó; casi siempre por choque de puertos con nginx)"
echo

# ---------- 3. Contenedores ----------
if command -v docker >/dev/null 2>&1; then
  echo "-- Contenedores"
  # Se listan TAMBIÉN los detenidos: un contenedor que murió al arrancar
  # es justamente la respuesta que se busca, y `docker ps` a secas lo
  # esconde.
  docker ps -a --format '  {{.Status}}  {{.Names}}  ({{.Image}})  {{.Ports}}' 2>/dev/null | head -15 \
    || echo "  $DUDA no se pudo consultar docker (¿permisos?)"
  echo
  MUERTOS=$(docker ps -a --filter status=exited --format '{{.Names}}' 2>/dev/null | head -5)
  if [ -n "$MUERTOS" ]; then
    echo "  Últimas líneas de los detenidos:"
    for c in $MUERTOS; do
      echo "  ── $c"
      docker logs --tail 8 "$c" 2>&1 | sed 's/^/     /'
    done
    echo
  fi
fi

# ---------- 4. nginx ----------
if command -v nginx >/dev/null 2>&1; then
  echo "-- nginx"
  if nginx -t >/dev/null 2>&1; then echo "  $OK configuración válida"; else
    echo "  $NO configuración INVÁLIDA:"; nginx -t 2>&1 | sed 's/^/     /'
  fi
  if nginx -T 2>/dev/null | grep -q "server_name.*$HOST"; then
    echo "  $OK hay un vhost para $HOST"
  else
    echo "  $NO NO hay vhost para $HOST"
    echo "     → nginx contesta con el server por defecto y el certificado"
    echo "       de otro dominio: el navegador lo rechaza antes de mostrar nada"
  fi
  echo "  Nombres servidos hoy:"
  nginx -T 2>/dev/null | grep -h "server_name" | tr -s ' ' | sed 's/^ *//; s/;$//' | sort -u | sed 's/^/     /'
  echo
fi

# ---------- 5. Certificado ----------
echo "-- Certificado"
if [ -d /etc/letsencrypt/live ]; then
  ls /etc/letsencrypt/live 2>/dev/null | grep -v README | sed 's/^/  emitido para: /'
  if ls /etc/letsencrypt/live 2>/dev/null | grep -qx "$HOST"; then
    echo "  $OK hay certificado a nombre de $HOST"
  else
    echo "  $NO no hay certificado para $HOST"
  fi
else
  echo "  $DUDA sin /etc/letsencrypt — el certificado puede vivir dentro del contenedor"
fi
echo

# ---------- 6. Respuesta local ----------
echo "-- Respuesta desde la propia máquina"
CODIGO=$(curl -sk -o /dev/null -m 10 -w '%{http_code}' "https://127.0.0.1/" -H "Host: $HOST" 2>/dev/null)
echo "  https://127.0.0.1 con Host: $HOST → ${CODIGO:-sin respuesta}"
echo "  (si acá responde y desde afuera no, el problema es firewall o DNS,"
echo "   no el servicio)"
echo
echo "==> Fin. Nada de lo anterior modificó el servidor."
