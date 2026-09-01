#!/usr/bin/env bash
# ============================================================
# sicr3p — Por qué no carga (SOLO LECTURA).
#
# Uso, EN EL VPS:  bash deploy/diagnosticar.sh
#                  bash deploy/diagnosticar.sh sicr3p.cl mail.sicr3p.cl
#
# QUÉ RESUELVE. «No carga» tiene media docena de causas que desde el
# navegador se ven idénticas, y adivinar sale caro. Este script las separa
# y las ordena por probabilidad, mirando el servidor de verdad en vez de
# la documentación —que dice lo que se DECIDIÓ, no lo que hay corriendo.
#
# LA SOSPECHA PRINCIPAL cuando el sitio Y el correo dejan de cargar al
# mismo tiempo: **un solo servidor no puede tener dos cosas en el puerto
# 443**. Un stack de correo autoalojado (Poste.io, mailcow, Mailu) quiere
# 80 y 443 para su interfaz web y para renovar su certificado. Si nginx ya
# los tenía, o el contenedor no levanta, o —peor— nginx queda sin poder
# reiniciar, y entonces se cae también el sitio. Un síntoma, dos víctimas.
#
# LA SEGUNDA SOSPECHA, más silenciosa: el certificado venció. certbot
# renueva por el puerto 80; si algo se lo tomó, la renovación falla en
# silencio durante semanas y un día el navegador bloquea el sitio y el
# webmail a la vez. Por eso acá se mira la fecha de vencimiento y no solo
# si el archivo existe.
#
# No escribe, no reinicia, no cambia configuración. Se puede correr las
# veces que sea, incluso con el sitio caído.
# ============================================================
set -uo pipefail

HOSTS=("$@")
[ ${#HOSTS[@]} -gt 0 ] || HOSTS=(sicr3p.cl mail.sicr3p.cl)

OK="✓"; NO="✗"; DUDA="·"
SOSPECHAS=()

echo "==> Diagnóstico sicr3p — $(date '+%d-%m-%Y %H:%M')"
echo "    Hosts: ${HOSTS[*]}"
echo

# ---------- 1. Disco ----------
# Primero de todo: un disco lleno tumba nginx, PostgreSQL y el backend a la
# vez, y el síntoma no se parece en nada a la causa.
echo "-- Disco"
df -h / 2>/dev/null | tail -1 | awk '{printf "  raíz: %s usados de %s (%s)\n", $3, $2, $5}'
USO=$(df / 2>/dev/null | tail -1 | awk '{gsub(/%/,"",$5); print $5}')
if [ -n "${USO:-}" ] && [ "$USO" -ge 95 ] 2>/dev/null; then
  echo "  $NO disco al ${USO}% — con esto no arranca nada"
  SOSPECHAS+=("Disco lleno (${USO}%): liberar espacio antes que cualquier otra cosa")
elif [ -n "${USO:-}" ] && [ "$USO" -ge 85 ] 2>/dev/null; then
  echo "  $DUDA disco al ${USO}%, conviene mirarlo"
else
  echo "  $OK espacio suficiente"
fi
echo

# ---------- 2. Puertos: quién tiene 80 y 443 ----------
echo "-- Puertos"
for p in 80 443 25 465 587 993 4000; do
  DUENO=$(ss -lntp 2>/dev/null | awk -v p=":$p\$" '$4 ~ p {print $NF; exit}')
  if [ -n "$DUENO" ]; then
    printf "  %s %-5s %s\n" "$OK" "$p" "${DUENO#users:}"
  else
    printf "  %s %-5s sin nadie escuchando\n" "$NO" "$p"
  fi
done
TIENE_443=$(ss -lntp 2>/dev/null | awk '$4 ~ /:443$/ {print $NF; exit}')
if [ -z "$TIENE_443" ]; then
  SOSPECHAS+=("Nadie escucha en 443: por eso no carga NADA por HTTPS")
elif ! echo "$TIENE_443" | grep -q nginx; then
  SOSPECHAS+=("El 443 lo tiene $TIENE_443, no nginx — el sitio quedó tapado por otro servicio")
fi
echo

# ---------- 3. nginx ----------
echo "-- nginx"
if command -v nginx >/dev/null 2>&1; then
  if systemctl is-active --quiet nginx 2>/dev/null; then
    echo "  $OK servicio activo"
  else
    echo "  $NO servicio CAÍDO"
    SOSPECHAS+=("nginx no está corriendo — 'systemctl status nginx' dice por qué")
    systemctl status nginx --no-pager -l 2>/dev/null | tail -8 | sed 's/^/     /'
  fi
  if nginx -t >/dev/null 2>&1; then
    echo "  $OK configuración válida"
  else
    echo "  $NO configuración INVÁLIDA — mientras siga así no puede recargar:"
    nginx -t 2>&1 | sed 's/^/     /'
    SOSPECHAS+=("La configuración de nginx no valida: se rompió al editarla")
  fi
  echo "  Nombres servidos:"
  nginx -T 2>/dev/null | grep -h "server_name" | tr -s ' ' | sed 's/^ *//; s/;$//' | sort -u | sed 's/^/     /'
  for h in "${HOSTS[@]}"; do
    nginx -T 2>/dev/null | grep -q "server_name.*\b$h\b" \
      && echo "  $OK vhost para $h" \
      || { echo "  $NO sin vhost para $h"; SOSPECHAS+=("$h no tiene vhost: contesta el server por defecto, con el certificado de otro dominio"); }
  done
else
  echo "  $NO nginx no está instalado"
fi
echo

# ---------- 4. Certificados ----------
# Se mira el VENCIMIENTO, no si el archivo existe. Un certificado vencido
# bloquea el sitio en el navegador aunque todo lo demás funcione, y es el
# modo de falla que aparece semanas después de que se rompió la renovación.
echo "-- Certificados"
if [ -d /etc/letsencrypt/live ]; then
  for d in /etc/letsencrypt/live/*/; do
    n=$(basename "$d"); [ "$n" = "README" ] && continue
    if [ -f "$d/cert.pem" ]; then
      FIN=$(openssl x509 -enddate -noout -in "$d/cert.pem" 2>/dev/null | cut -d= -f2)
      if openssl x509 -checkend 0 -noout -in "$d/cert.pem" >/dev/null 2>&1; then
        if openssl x509 -checkend 604800 -noout -in "$d/cert.pem" >/dev/null 2>&1; then
          echo "  $OK $n — vence $FIN"
        else
          echo "  $DUDA $n — vence en menos de 7 días ($FIN)"
          SOSPECHAS+=("El certificado de $n vence en días: la renovación no está corriendo")
        fi
      else
        echo "  $NO $n — VENCIDO ($FIN)"
        SOSPECHAS+=("Certificado de $n VENCIDO: el navegador bloquea el sitio aunque el servidor responda")
      fi
    fi
  done
else
  echo "  $DUDA sin /etc/letsencrypt"
fi
echo

# ---------- 5. Backend ----------
echo "-- Backend"
if command -v pm2 >/dev/null 2>&1; then
  pm2 list 2>/dev/null | grep -E "sicr3p|name|status" | sed 's/^/  /' | head -8
  ESTADO=$(pm2 jlist 2>/dev/null | grep -o '"status":"[a-z]*"' | head -1 | cut -d'"' -f4)
  [ "$ESTADO" = "online" ] || SOSPECHAS+=("El backend no está online (pm2 dice: ${ESTADO:-nada}) — 'pm2 logs sicr3p-backend --lines 40'")
  echo "  Últimas líneas de error:"
  pm2 logs sicr3p-backend --err --lines 8 --nostream 2>/dev/null | sed 's/^/     /' | tail -10
else
  echo "  $DUDA pm2 no está instalado"
fi
echo

# ---------- 6. Contenedores ----------
if command -v docker >/dev/null 2>&1; then
  echo "-- Contenedores"
  # También los DETENIDOS: uno que murió al arrancar es justo la respuesta
  # que se busca, y `docker ps` a secas lo esconde.
  docker ps -a --format '  {{.Status}}  {{.Names}}  ({{.Image}})  {{.Ports}}' 2>/dev/null | head -12 \
    || echo "  $DUDA no se pudo consultar docker"
  for c in $(docker ps -a --filter status=exited --format '{{.Names}}' 2>/dev/null | head -3); do
    echo "  ── $c (detenido), últimas líneas:"
    docker logs --tail 8 "$c" 2>&1 | sed 's/^/     /'
    SOSPECHAS+=("El contenedor $c está detenido — ver sus logs arriba")
  done
  echo
fi

# ---------- 7. Respuesta local ----------
echo "-- Respuesta desde la propia máquina"
for h in "${HOSTS[@]}"; do
  C=$(curl -sk -o /dev/null -m 10 -w '%{http_code}' "https://127.0.0.1/" -H "Host: $h" 2>/dev/null)
  printf "  %-24s → %s\n" "$h" "${C:-sin respuesta}"
done
echo "  (si acá responde y desde afuera no, el problema es firewall o DNS)"
echo

# ---------- Resumen ----------
echo "════════════════════════════════════════"
if [ ${#SOSPECHAS[@]} -eq 0 ]; then
  echo "Sin causa evidente desde adentro."
  echo "Siguiente paso: probar desde AFUERA del servidor, porque entonces"
  echo "el problema está en el DNS, en el firewall de DonWeb o en la red."
else
  echo "Qué mirar, en este orden:"
  i=1
  for s in "${SOSPECHAS[@]}"; do echo "  $i. $s"; i=$((i+1)); done
fi
echo "════════════════════════════════════════"
echo "Nada de lo anterior modificó el servidor."
