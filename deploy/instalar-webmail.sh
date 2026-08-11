#!/usr/bin/env bash
# ============================================================
# sicr3p — Servidor de correo con webmail (Poste.io) en el VPS
#
# Uso (como root, con el repo ya clonado en /opt/sicr3p):
#   bash deploy/instalar-webmail.sh                → mail.sicr3p.cl
#   bash deploy/instalar-webmail.sh mail.otro.cl   → otro hostname
#
# Instala Poste.io (contenedor único: SMTP + IMAP + antispam +
# webmail Roundcube + panel admin) conviviendo con el nginx que
# ya sirve sicr3p.cl:
#   - Puertos de correo 25/465/587/993 directos al host.
#   - Interfaz web SOLO en 127.0.0.1:8090; nginx hace de proxy
#     con HTTPS (certbot) en https://mail.sicr3p.cl.
#   - Datos persistentes en /opt/posteio-data (sobrevive al
#     contenedor: buzones, claves DKIM, configuración).
#
# Es idempotente: se puede correr de nuevo sin romper nada.
# IMPORTANTE: leer deploy/WEBMAIL.md ANTES (DNS, rDNS/PTR y la
# alternativa hosted si DonWeb bloquea el puerto 25).
# ============================================================
set -euo pipefail

MAIL_HOST="${1:-mail.sicr3p.cl}"
IP_PUBLICA="$(curl -s -4 ifconfig.me || hostname -I | awk '{print $1}')"
DATA_DIR="/opt/posteio-data"
WEB_PORT="8090"   # solo loopback; nginx proxya hacia acá

echo "==> Poste.io para $MAIL_HOST (IP pública: $IP_PUBLICA)"

# ---------- 0. Verificaciones previas (abortan con mensaje claro) ----------

# 0a. ¿Somos root?
if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: este script debe correr como root (sudo bash deploy/instalar-webmail.sh)." >&2
  exit 1
fi

# 0b. Puerto 25 SALIENTE abierto (imprescindible para ENVIAR a otros servidores).
#     Muchos VPS lo bloquean por defecto para frenar spam.
echo "==> Verificando puerto 25 saliente…"
if ! timeout 5 bash -c 'cat < /dev/null > /dev/tcp/smtp.gmail.com/25' 2>/dev/null; then
  cat >&2 <<'MSG'
ERROR: el puerto 25 SALIENTE está bloqueado (no se pudo conectar a smtp.gmail.com:25).

  Sin puerto 25 el servidor puede recibir correo pero NO entregar a otros
  dominios: un servidor de correo así no sirve.

  Opciones:
    1) Pedir a soporte de DonWeb que desbloqueen el puerto 25 saliente para
       esta IP (y de paso pedir el rDNS/PTR → mail.sicr3p.cl). Luego volver
       a correr este script.
    2) Usar correo hosted con dominio propio (recomendado si no lo abren):
       ver la sección "Alternativa: correo hosted (Zoho Mail)" en
       deploy/WEBMAIL.md — cero mantención y mejor entregabilidad.

No se instaló nada. Abortando.
MSG
  exit 1
fi
echo "    OK: puerto 25 saliente abierto."

# 0c. Nada más puede estar escuchando en los puertos de correo del host.
for P in 25 465 587 993; do
  OCUPADO="$(ss -tlnp "sport = :$P" 2>/dev/null | tail -n +2 || true)"
  if [ -n "$OCUPADO" ] && ! echo "$OCUPADO" | grep -q docker-proxy; then
    echo "ERROR: el puerto $P ya está en uso por otro servicio (¿postfix/exim?):" >&2
    echo "$OCUPADO" >&2
    echo "  Deshabilítalo antes (p. ej.: systemctl disable --now postfix) y reintenta." >&2
    exit 1
  fi
done

# 0d. RAM mínima: Poste.io (con antispam/antivirus) quiere ~2 GB. Solo aviso.
RAM_MB="$(free -m | awk '/^Mem:/ {print $2}')"
if [ "${RAM_MB:-0}" -lt 1900 ]; then
  echo "AVISO: el VPS tiene ${RAM_MB} MB de RAM; Poste.io recomienda ~2 GB."
  echo "       Puede funcionar justo (considera desactivar ClamAV en el admin"
  echo "       tras instalar: Sistema → Antivirus), pero vigila 'free -m'."
fi

# ---------- 1. Docker (repo oficial), si no está ----------
if ! command -v docker >/dev/null; then
  echo "==> Instalando Docker (repo oficial)…"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
      gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
  fi
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io
  systemctl enable --now docker
else
  echo "==> Docker ya instalado: $(docker --version)"
fi

# ---------- 2. Contenedor Poste.io ----------
mkdir -p "$DATA_DIR"

if docker ps -a --format '{{.Names}}' | grep -qx posteio; then
  echo "==> El contenedor 'posteio' ya existe: no se recrea."
  echo "    (Para recrearlo con otra config: docker rm -f posteio y reintenta;"
  echo "     los datos persisten en $DATA_DIR.)"
  docker start posteio >/dev/null 2>&1 || true
else
  echo "==> Creando contenedor posteio ($MAIL_HOST)…"
  # - Correo (25/465/587/993) directo al host: los clientes y otros
  #   servidores SMTP hablan directo con el contenedor.
  # - Web SOLO en 127.0.0.1:$WEB_PORT y con HTTPS=OFF: el TLS de la
  #   interfaz lo pone nginx+certbot, no el contenedor.
  docker run -d \
    --name posteio \
    --hostname "$MAIL_HOST" \
    --restart unless-stopped \
    -p 25:25 \
    -p 465:465 \
    -p 587:587 \
    -p 993:993 \
    -p 127.0.0.1:${WEB_PORT}:80 \
    -e HTTPS=OFF \
    -e "TZ=America/Santiago" \
    -v "$DATA_DIR:/data" \
    analogic/poste.io
fi

# ---------- 3. nginx: server block para el webmail ----------
cat > "/etc/nginx/sites-available/$MAIL_HOST" <<NGINX
server {
    listen 80;
    server_name $MAIL_HOST;

    # Adjuntos de correo grandes
    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:$WEB_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        # WebSocket (webmail/admin usan conexiones persistentes)
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
}
NGINX
ln -sf "/etc/nginx/sites-available/$MAIL_HOST" "/etc/nginx/sites-enabled/$MAIL_HOST"
nginx -t && systemctl reload nginx
echo "==> nginx: $MAIL_HOST → 127.0.0.1:$WEB_PORT"

# ---------- 4. HTTPS con certbot (solo si el DNS ya apunta acá) ----------
command -v dig >/dev/null || { apt-get update -y; apt-get install -y dnsutils; }
DNS_IP="$(dig +short A "$MAIL_HOST" @1.1.1.1 | tail -1)"
if [ "$DNS_IP" = "$IP_PUBLICA" ]; then
  apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -d "$MAIL_HOST" --non-interactive --agree-tos \
    -m "postmaster@${MAIL_HOST#mail.}" || \
    echo "AVISO: certbot falló. Reintenta a mano: certbot --nginx -d $MAIL_HOST"
else
  echo "AVISO: el DNS de $MAIL_HOST apunta a '${DNS_IP:-nada}' y no a $IP_PUBLICA."
  echo "       Se salta certbot. Crea el registro A (ver deploy/WEBMAIL.md),"
  echo "       espera la propagación y luego corre:"
  echo "         certbot --nginx -d $MAIL_HOST"
fi

# ---------- 5. Firewall (¡sin cortar el SSH actual!) ----------
SSH_PORT="$(ss -tlnp | awk '/sshd/ {sub(".*:","",$4); print $4; exit}')"
ufw allow "${SSH_PORT:-22}/tcp" >/dev/null
ufw allow 80/tcp  >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 25/tcp  >/dev/null   # SMTP entre servidores
ufw allow 465/tcp >/dev/null   # SMTP submission (TLS implícito)
ufw allow 587/tcp >/dev/null   # SMTP submission (STARTTLS)
ufw allow 993/tcp >/dev/null   # IMAP sobre TLS
ufw --force enable >/dev/null
echo "==> ufw activo (SSH ${SSH_PORT:-22}, 80, 443, 25, 465, 587, 993)."

# ---------- 6. Resumen y pendientes ----------
cat <<FIN

============================================================
  Poste.io corriendo (contenedor 'posteio', datos en $DATA_DIR).

  SIGUIENTE PASO — asistente inicial:
    https://$MAIL_HOST/admin/install
    (si el HTTPS aún no está: http://$MAIL_HOST/admin/install
     una vez que el DNS apunte, o via túnel SSH:
     ssh -p ${SSH_PORT:-22} -L 8090:127.0.0.1:$WEB_PORT root@$IP_PUBLICA
     y abrir http://localhost:8090/admin/install)

  DNS PENDIENTE (detalle exacto en deploy/WEBMAIL.md):
    A      $MAIL_HOST            → $IP_PUBLICA
    MX     ${MAIL_HOST#mail.}    → $MAIL_HOST (prioridad 10)
    TXT    ${MAIL_HOST#mail.}    → "v=spf1 mx ~all"
    TXT    <selector>._domainkey → DKIM (selector y valor los genera el admin de Poste.io)
    TXT    _dmarc                → "v=DMARC1; p=quarantine; rua=mailto:postmaster@${MAIL_HOST#mail.}"
    rDNS/PTR (pedir a DonWeb): $IP_PUBLICA → $MAIL_HOST   ← CRÍTICO

  Diagnóstico:  docker logs posteio --tail 50
  Prueba final: enviar a la dirección de https://www.mail-tester.com
                (objetivo: nota >= 9/10)
============================================================
FIN
