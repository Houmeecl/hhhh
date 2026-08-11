#!/usr/bin/env bash
# ============================================================
# sicr3p — Instalación completa en VPS Ubuntu 22.04/24.04
#
# Uso (como root, con el repo ya clonado en /opt/sicr3p):
#   bash deploy/instalar-vps.sh                 → sirve por IP (HTTP)
#   bash deploy/instalar-vps.sh app.sicr3p.cl   → dominio + HTTPS (certbot)
#
# Instala: Node 22, PostgreSQL, nginx, pm2. Crea la BD, el .env con
# secretos aleatorios, compila el frontend, siembra el admin y deja
# el backend corriendo con pm2 (reinicio automático).
# Las credenciales quedan en /root/sicr3p-credenciales.txt
# ============================================================
set -euo pipefail

DOMINIO="${1:-}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
IP_PUBLICA="$(curl -s -4 ifconfig.me || hostname -I | awk '{print $1}')"
ORIGEN="${DOMINIO:+https://$DOMINIO}"
ORIGEN="${ORIGEN:-http://$IP_PUBLICA}"

echo "==> sicr3p en $DIR — se servirá en: $ORIGEN"

# ---------- 1. Paquetes del sistema ----------
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git nginx postgresql postgresql-contrib ufw

# Node 22 (NodeSource)
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
npm install -g pm2 >/dev/null

# ---------- 2. Base de datos ----------
# Si ya existe backend/.env, la clave de la BD se toma de su DATABASE_URL:
# re-ejecutar este script NUNCA debe desincronizar Postgres del .env (bug
# visto en producción: el ALTER ROLE de abajo fijaba una clave aleatoria
# nueva mientras el .env existente conservaba la vieja, y el backend
# quedaba sin poder conectar hasta arreglarlo a mano).
DB_PASS=""
if [ -f "$DIR/backend/.env" ]; then
  DB_PASS="$(grep '^DATABASE_URL=' "$DIR/backend/.env" | sed -E 's|.*://[^:]+:([^@]+)@.*|\1|')"
fi
[ -n "$DB_PASS" ] || DB_PASS="$(openssl rand -hex 16)"
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='sicr3p'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE ROLE sicr3p LOGIN PASSWORD '$DB_PASS';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='sicr3p'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE sicr3p OWNER sicr3p;"
# pg_trgm requiere superusuario la primera vez
sudo -u postgres psql -d sicr3p -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
sudo -u postgres psql -c "ALTER ROLE sicr3p PASSWORD '$DB_PASS';"

# ---------- 3. Backend (.env con secretos nuevos) ----------
cd "$DIR/backend"
ADMIN_PASS="$(openssl rand -base64 15 | tr '+/' 'Aa')"
if [ ! -f .env ]; then
  cat > .env <<ENV
NODE_ENV=production
PORT=4000
CORS_ORIGIN=$ORIGEN
PUBLIC_APP_URL=$ORIGEN
DATABASE_URL=postgresql://sicr3p:$DB_PASS@localhost:5432/sicr3p
# Motor externo APAGADO. Su modo simulado fabrica el CO2e con un PRNG y ese
# número queda sellado en la cadena de hash: no puede llegar a un cliente.
# Con esto, un documento que el motor propio no puede leer se rechaza con 422
# en vez de recibir una cifra inventada.
MOTOR_EXTERNO=off
SIMPLE_API_BASE=https://app.itssimple.com/public/v1
SIMPLE_API_KEY=
# Cifrado de las claves tributarias guardadas (AES-256-GCM). Es FATAL al
# arrancar en producción si falta: sin esto el backend no levanta.
SII_CRED_KEY=$(openssl rand -hex 32)
JWT_ACCESS_SECRET=$(openssl rand -hex 48)
JWT_REFRESH_SECRET=$(openssl rand -hex 48)
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d
BCRYPT_ROUNDS=12
RESEND_API_KEY=
MAIL_FROM="sicr3p <no-responder@sicrep.cl>"
ADMIN_EMAIL=admin@sicrep.cl
ADMIN_PASSWORD=$ADMIN_PASS
BIGQUERY_EXPORT=false
ENV
  echo "==> backend/.env creado."
else
  echo "==> backend/.env ya existe: no se toca."
  ADMIN_PASS="(la ya configurada en backend/.env)"
fi

npm ci --omit=dev
node src/seed.js

# ---------- 4. Frontend (build estático) ----------
cd "$DIR/frontend"
npm ci
npx vite build

# ---------- 5. nginx ----------
# Con dominio se sirve también por www — sin esto el navegador muestra el
# candado en rojo al entrar por www.$DOMINIO (nginx ni siquiera responde
# ese Host, y el certificado tampoco lo cubre).
SERVER_NAME="${DOMINIO:+$DOMINIO www.$DOMINIO}"
SERVER_NAME="${SERVER_NAME:-_}"
cat > /etc/nginx/sites-available/sicr3p <<NGINX
server {
    listen 80;
    server_name $SERVER_NAME;

    root $DIR/frontend/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        client_max_body_size 20m;
    }

    # /aduana-verde fue una segunda portada; su contenido vive hoy en "/".
    # El router de la SPA ya redirige, pero eso es de cliente: este 301 lo
    # resuelve antes de servir el bundle, que es lo que esperan los enlaces
    # ya repartidos y los buscadores.
    location = /aduana-verde {
        return 301 /;
    }

    location / {
        try_files \$uri /index.html;
    }

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

    # El Libro sicr3p — el proyecto completo, navegable e imprimible.
    location /docs/libro/ {
        alias $DIR/docs/libro/;
        index index.html;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/sicr3p /etc/nginx/sites-enabled/sicr3p
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# ---------- 6. Backend con pm2 ----------
cd "$DIR/backend"
pm2 delete sicr3p-backend >/dev/null 2>&1 || true
pm2 start src/index.js --name sicr3p-backend
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null

# ---------- 7. Firewall (¡sin cortar el SSH actual!) ----------
SSH_PORT="$(ss -tlnp | awk '/sshd/ {sub(".*:","",$4); print $4; exit}')"
ufw allow "${SSH_PORT:-22}/tcp" >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
echo "==> ufw activo (SSH ${SSH_PORT:-22}, 80, 443)."

# ---------- 7b. Respaldo diario de la BD (cron 03:00) ----------
chmod +x "$DIR/deploy/respaldo.sh"
if ! crontab -l 2>/dev/null | grep -q 'deploy/respaldo.sh'; then
  (crontab -l 2>/dev/null; echo "0 3 * * * bash $DIR/deploy/respaldo.sh >> /var/log/sicr3p-respaldo.log 2>&1") | crontab -
  echo "==> Respaldo diario instalado (03:00 → /root/backups, 14 días)."
fi

# ---------- 8. HTTPS con certbot (solo con dominio) ----------
if [ -n "$DOMINIO" ]; then
  apt-get install -y certbot python3-certbot-nginx
  # Se pide el certificado para el dominio Y www — certbot exige que ambos
  # ya resuelvan al DNS de este servidor, así que si www.$DOMINIO todavía no
  # apunta acá, cae al dominio solo (mejor tener HTTPS en uno que en ninguno)
  # y avisa cómo completar www después con deploy/agregar-www.sh.
  certbot --nginx -d "$DOMINIO" -d "www.$DOMINIO" --non-interactive --agree-tos -m "admin@$DOMINIO" || {
    echo "AVISO: certbot con www falló (¿el DNS de www.$DOMINIO ya apunta a $IP_PUBLICA?). Reintentando solo con $DOMINIO..."
    certbot --nginx -d "$DOMINIO" --non-interactive --agree-tos -m "admin@$DOMINIO" || \
      echo "AVISO: certbot falló también para $DOMINIO solo. Reintenta a mano: certbot --nginx -d $DOMINIO -d www.$DOMINIO"
    echo "==> Cuando el DNS de www.$DOMINIO esté listo: bash deploy/agregar-www.sh $DOMINIO"
  }
fi

# ---------- 9. Credenciales ----------
cat > /root/sicr3p-credenciales.txt <<CRED
sicr3p — credenciales del despliegue ($(date))
URL:            $ORIGEN
Panel admin:    $ORIGEN/admin
Admin email:    admin@sicrep.cl
Admin clave:    $ADMIN_PASS
BD:             postgresql://sicr3p:$DB_PASS@localhost:5432/sicr3p
Motor:          PROPIO (XML del DTE, PDF con texto y OCR local).
                El motor externo queda APAGADO (MOTOR_EXTERNO=off): un documento
                que el motor propio no puede leer se rechaza, no se estima.
CRED
chmod 600 /root/sicr3p-credenciales.txt

echo ""
echo "============================================================"
echo "  LISTO. sicr3p corriendo en: $ORIGEN"
echo "  Panel admin: $ORIGEN/admin  (credenciales en /root/sicr3p-credenciales.txt)"
echo "============================================================"
