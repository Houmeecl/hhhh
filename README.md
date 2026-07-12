# sicr3p — Etapa 1

**Contabilidad de carbono trazable.** Plataforma chilena: sube tus facturas, descarga tu
contabilidad de carbono. _Tu contabilidad, tu trazabilidad._

Herramienta de adquisición: una empresa sube **hasta 5 facturas por sesión** (límite duro
de la demo), recibe **un informe PDF consolidado** + **una etiqueta con QR verificable por
factura**.

---

## Arquitectura

```
frontend/   React + Vite (SPA)      → sirve la landing, carga, resultado, verificación y panel admin
backend/    Node.js + Express       → API, proxy al motor externo (Simple), PostgreSQL, PDF/QR, auth JWT
backend/migrations/  SQL            → esquema de base de datos
```

- **PostgreSQL** (Neon en producción, vía `DATABASE_URL`).
- **Motor externo Simple** (`https://app.itssimple.com/public/v1`): invisible para el
  cliente. La `SIMPLE_API_KEY` vive **solo en el backend**, nunca en el frontend ni en el repo.
- **Modo MOCK** (`MOCK_SIMPLE=true`): respuestas simuladas realistas para desarrollar y
  demostrar sin consumir la API real.
- **Resend** para correos (activación de cuenta / reset). Sin `RESEND_API_KEY`, los correos
  se registran en consola (modo dev) y el link de activación se devuelve en la respuesta.
- PDF con **pdfkit**, QR con **qrcode**.

---

## Requisitos

- Node.js 18+ (probado en Node 22)
- PostgreSQL 14+ (o una base Neon)

---

## Puesta en marcha local (demo con datos mock)

```bash
# 1. Base de datos (ejemplo local)
createdb sicr3p   # o usa tu DATABASE_URL de Neon

# 2. Backend
cd backend
cp ../.env.example .env      # edita DATABASE_URL y los secretos JWT
npm install
npm run migrate              # crea las tablas
npm run seed                 # crea el admin inicial + datos demo (imprime las credenciales)
npm start                    # → http://localhost:4000

# 3. Frontend (en otra terminal)
cd frontend
npm install
npm run dev                  # → http://localhost:5173
```

El frontend hace proxy de `/api` al backend (`vite.config.js`). Abre
`http://localhost:5173`, sube 5 archivos de prueba y genera tu informe + etiquetas.

### Credenciales de administrador

`npm run seed` crea el usuario **admin@sicr3p.cl** y, si `ADMIN_PASSWORD` está vacío en
`.env`, **genera una contraseña segura y la imprime en consola**. Guárdala (el proyecto
también escribe `CREDENCIALES.md`, que está en `.gitignore`).

---

## Paso a producción (un solo cambio)

En `backend/.env`:

```diff
- MOCK_SIMPLE=true
+ MOCK_SIMPLE=false
+ SIMPLE_API_KEY=tu_api_key_real_de_simple
```

Reinicia el backend. Todo el resto del flujo es idéntico; el motor externo pasa a ser real.

### Nota sobre el mapeo de la API real (importante)

El entorno donde se construyó este proyecto **bloquea `app.itssimple.com`** por política de
red, por lo que el normalizador de la respuesta real (`normalizeReal()` en
`backend/src/services/simpleApi.js`) **no pudo verificarse contra la API en vivo**. Está
escrito de forma **defensiva**: acepta varias variantes de nombre de campo
(snake_case / camelCase / anidados) y nunca falla si falta un campo.

Al activar `MOCK_SIMPLE=false` en una red **con acceso a itssimple**, verifica una respuesta
real (por ejemplo `GET /invoices/{id}` y `GET /analysis/totals`) y ajusta las claves en
`pick(...)` dentro de `normalizeReal()` si los nombres difieren. El mock
(`MOCK_SIMPLE=true`) replica la forma esperada (t CO2e por ítem, categoría, % del total)
según la documentación de los endpoints, para desarrollar y demostrar sin consumir la API.

---

## Variables de entorno

Ver `.env.example`. Las principales:

| Variable | Descripción |
|----------|-------------|
| `DATABASE_URL` | Cadena de conexión PostgreSQL / Neon. |
| `MOCK_SIMPLE` | `true` = mock; `false` = API real. |
| `SIMPLE_API_KEY` | Clave del motor externo (solo backend). |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Secretos JWT (usa `openssl rand -hex 48`). |
| `BCRYPT_ROUNDS` | Costo bcrypt (≥ 12). |
| `RESEND_API_KEY` | Clave de Resend para correos (opcional en dev). |
| `CORS_ORIGIN` | Origen permitido del frontend. |
| `PUBLIC_APP_URL` | URL pública del frontend (usada en los QR). |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Admin inicial para el seed. |

---

## Seguridad

- Contraseñas con **bcrypt** (costo ≥ 12).
- **JWT** de acceso corto (15 min) + **refresh token**.
- **Rate limiting** en el login (`express-rate-limit`).
- **helmet** y **CORS restringido**.
- Tokens de activación/reset **hasheados** (SHA-256) con expiración.
- **Sin auto-registro**: las cuentas las crea un administrador.
- Todos los secretos en `.env` (gitignored). La `SIMPLE_API_KEY` nunca llega al navegador.

---

## Despliegue en VPS (nginx + certbot)

Guía para un Ubuntu 22.04/24.04 con dominio `app.sicr3p.cl` apuntando al VPS.

### 1. Dependencias del servidor

```bash
sudo apt update && sudo apt install -y nginx git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

### 2. Código y build

```bash
sudo mkdir -p /var/www/sicr3p && sudo chown $USER /var/www/sicr3p
cd /var/www/sicr3p
git clone <URL_DEL_REPO> .

# Backend
cd backend
cp ../.env.example .env      # completa DATABASE_URL (Neon), secretos, MOCK_SIMPLE, etc.
npm ci
npm run migrate
npm run seed                 # guarda las credenciales del admin
pm2 start src/index.js --name sicr3p-api
pm2 save && pm2 startup      # arranque automático

# Frontend (build estático)
cd ../frontend
npm ci
npm run build                # genera frontend/dist
```

### 3. nginx

`/etc/nginx/sites-available/sicr3p`:

```nginx
server {
    listen 80;
    server_name app.sicr3p.cl;

    # SPA estática
    root /var/www/sicr3p/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # API al backend (Express en :4000)
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    client_max_body_size 20M;   # permite subir facturas
}
```

```bash
sudo ln -s /etc/nginx/sites-available/sicr3p /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

En `backend/.env` ajusta:

```
CORS_ORIGIN=https://app.sicr3p.cl
PUBLIC_APP_URL=https://app.sicr3p.cl
```

### 4. HTTPS con certbot

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d app.sicr3p.cl
# certbot configura el 443 y la renovación automática
```

### 5. Actualizaciones

```bash
cd /var/www/sicr3p && git pull
cd backend && npm ci && npm run migrate && pm2 restart sicr3p-api
cd ../frontend && npm ci && npm run build
```

---

## Estructura de la base de datos

`backend/migrations/001_init.sql` crea: `clientes`, `usuarios`, `tokens_password`,
`sesiones`, `facturas`, `line_items`, `actividad_log`, `prospectos`, `simple_api_uso`.
Cada factura guarda `rut_emisor` y `rut_receptor` (preparación de trazabilidad futura,
ver `ETAPA2.md`).

---

## Panel de administración (`/admin`)

Login con JWT. Secciones: Dashboard, Clientes y contratos (CRUD + crear cuenta con envío de
link de activación), Sesiones e informes (ver / re-descargar PDF y etiquetas), Métricas,
Prospectos (pipeline comercial), Motor externo (consumo/latencia/errores), Usuarios y roles,
Log de actividad.

---

## Alcance

La Etapa 1 termina aquí. El backlog de funcionalidades futuras (SII/RCV, informes
mensuales, cadena comprador–vendedor, etc.) está en **`ETAPA2.md`** y **no** está
implementado en este código.
