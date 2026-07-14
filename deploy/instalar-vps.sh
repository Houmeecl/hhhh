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
DB_PASS="$(openssl rand -hex 16)"
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
# Motor externo: en mock hasta verificar la API real (ver README → Modo producción)
MOCK_SIMPLE=true
SIMPLE_API_BASE=https://app.itssimple.com/public/v1
SIMPLE_API_KEY=
JWT_ACCESS_SECRET=$(openssl rand -hex 48)
JWT_REFRESH_SECRET=$(openssl rand -hex 48)
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d
BCRYPT_ROUNDS=12
RESEND_API_KEY=
MAIL_FROM="sicr3p <no-responder@sicr3p.cl>"
ADMIN_EMAIL=admin@sicr3p.cl
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
SERVER_NAME="${DOMINIO:-_}"
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

    location / {
        try_files \$uri /index.html;
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

# ---------- 8. HTTPS con certbot (solo con dominio) ----------
if [ -n "$DOMINIO" ]; then
  apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -d "$DOMINIO" --non-interactive --agree-tos -m "admin@$DOMINIO" || \
    echo "AVISO: certbot falló (¿el DNS de $DOMINIO ya apunta a $IP_PUBLICA?). Reintenta: certbot --nginx -d $DOMINIO"
fi

# ---------- 9. Credenciales ----------
cat > /root/sicr3p-credenciales.txt <<CRED
sicr3p — credenciales del despliegue ($(date))
URL:            $ORIGEN
Panel admin:    $ORIGEN/admin
Admin email:    admin@sicr3p.cl
Admin clave:    $ADMIN_PASS
BD:             postgresql://sicr3p:$DB_PASS@localhost:5432/sicr3p
Motor:          MOCK (para pasar a producción: MOCK_SIMPLE=false + SIMPLE_API_KEY
                en backend/.env, y antes correr: node backend/scripts/verificar-simple.js)
CRED
chmod 600 /root/sicr3p-credenciales.txt

echo ""
echo "============================================================"
echo "  LISTO. sicr3p corriendo en: $ORIGEN"
echo "  Panel admin: $ORIGEN/admin  (credenciales en /root/sicr3p-credenciales.txt)"
echo "============================================================"
