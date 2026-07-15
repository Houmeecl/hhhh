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

**Script de verificación (correr en el VPS):**

```bash
cd backend
node scripts/verificar-simple.js
```

Hace solo lecturas `GET`, imprime la forma real de las respuestas y **contrasta** cada
campo con las variantes que espera `normalizeReal()`, marcando ✓/✗ para decirte exactamente
qué ajustar. Si la red bloquea `app.itssimple.com` (como en algunos entornos de CI), avisa y
te pide correrlo en el VPS.

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

### 4b. Respaldos y limpieza de datos demo

- **Respaldo automático**: `deploy/instalar-vps.sh` deja un cron diario (03:00) que ejecuta
  `deploy/respaldo.sh` → `/root/backups/sicr3p-AAAA-MM-DD.sql.gz` (conserva 14 días).
  Restaurar: `gunzip -c archivo.sql.gz | sudo -u postgres psql -d sicr3p`.
- **Datos de demostración**: el seed solo inserta clientes/prospectos ficticios con
  `SEED_DEMO=true` (nunca en producción). Si tu VPS se sembró con la versión anterior,
  límpialos una vez: `sudo -u postgres psql -d sicr3p -f deploy/limpiar-demo.sql`.

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
`002_corredor.sql` agrega las tablas del Corredor Bioceánico y `003_capital_natural.sql`
las del Capital Natural (`cuentas_naturales`, `activos_naturales`, `movimientos_naturales`).
Cada factura guarda `rut_emisor` y `rut_receptor`, que alimentan la cadena
comprador-vendedor del panel.

---

## Panel de administración (`/admin`)

Login con JWT. Secciones: Dashboard, Clientes y contratos (CRUD + crear cuenta con envío de
link de activación), Sesiones e informes (ver / re-descargar PDF y etiquetas), Corredor
Bioceánico, **Capital Natural**, **Trazabilidad**, Métricas, Prospectos (pipeline comercial),
Motor externo (consumo/latencia/errores), Usuarios y roles, Log de actividad.

### Capital Natural

Contabilidad de capital natural con modelo **SEEA simplificado** (el mismo marco de las
cuentas ambientales del Banco Central/MMA), citando además Natural Capital Protocol y TNFD:

- **Plan de cuentas ambiental**: AGUA (m3), ENER (kWh), CO2E (tCO2e), MATR (t) como flujo;
  SUEL (ha) y BIOD (índice) como stock. Toggle de activación y factores de conversión
  editables por cuenta.
- **Movimientos automáticos**: cada documento procesado (flujo público o Corredor) genera
  cargos en las cuentas activas, con traza a la factura de origen. También hay movimientos
  manuales (cargo/abono).
- **Activos naturales**: derechos de agua, predios, bosques u otros stocks, con extensión,
  condición (0–100) y valorización CLP manual.
- **Informe "Estado de Capital Natural"** (PDF, folio `N-AAAA-NNNN`): balance por cuenta con
  libro de movimientos, activos y metodología citada.

### Búsqueda con cruces

Buscador unificado (`/admin/buscar`): un RUT, un N° de documento (DIN, MIC/DTA, N° de
venta), un archivo o una empresa devuelve **todas sus apariciones** (clientes, sesiones,
documentos procesados, Corredor) y los **cruces del RUT**: como cliente de sicr3p, sus
proveedores (recibe de) y sus clientes (emite a), con documentos y tCO2e por relación.
Implementado sobre PostgreSQL con `pg_trgm` (migración 005); cuando el volumen lo exija,
la misma API se puede respaldar con Elasticsearch/OpenSearch sin cambiar el frontend.

### Export a BigQuery (data warehouse)

Todo lo que se escanea (facturas + ítems del flujo público y documentos del Corredor) se
puede replicar a **BigQuery** para análisis y cruces a gran escala:

1. Crea el dataset con `backend/bigquery/schema.sql` (región `southamerica-west1`,
   RUT normalizados, particionado por fecha y clusterizado por RUT).
2. Crea una cuenta de servicio GCP con rol **BigQuery Data Editor** y guarda su JSON
   en el servidor (fuera del repo).
3. En `backend/.env`: `BIGQUERY_EXPORT=true`, `BQ_PROJECT_ID=…`, `BQ_KEY_FILE=/ruta/sa.json`.

El export es **no bloqueante**: si BigQuery no responde, el flujo del cliente no se
afecta (solo queda un aviso en el log). Apagado por defecto (`BIGQUERY_EXPORT=false`).
Sin dependencias nuevas: autenticación JWT RS256 + streaming `insertAll` vía REST.

### Trazabilidad (Etapa 2)

- **Informe mensual por cliente**: consolidado calendario por RUT
  (`GET /api/admin/informes/mensual[.pdf]?rut=&anio=&mes=`), con el mismo libro mayor.
- **Cadena comprador-vendedor**: proveedores (aguas arriba) y compradores (aguas abajo)
  de cualquier RUT, enlazando `rut_emisor`/`rut_receptor` de los documentos procesados.
- **Verificador local de DTE**: sube el XML y valida estructura, RUT (módulo 11),
  consistencia de totales/detalle y presencia de firma — sin conexión al SII. Los XML de
  DTE subidos al flujo público usan el **folio y RUT reales** del documento.

### Valorización de inventario (FIFO/PMP) y Transporte Cat. 7

- **Valorización** (Trazabilidad → "Valorización"): los DTE XML alimentan el inventario con
  el precio real por ítem (el CO2e de la factura se reparte por monto). Métodos FIFO y
  precio medio ponderado, en CLP + CO2e, con salidas manuales para valorizar el consumo.
- **Transporte de personal** (GHG Protocol Categoría 7): modos con factor editable
  (kgCO2e/pasajero-km, referenciales — validar fuente antes de reportar) y registro de
  traslados; cada viaje carga la cuenta de carbono del Capital Natural.

### Acceso de prueba con códigos (créditos)

Los invitados entran en **`/prueba`** con un código (`SICR3P-XXXXXX`) generado desde el
panel → "Accesos externos". Cada código trae **créditos** (por defecto 5; 1 crédito =
1 factura procesada): generan **informes reales** con tope de envío, controlando el costo
del motor. Al agotarse, el flujo pide contactarnos.

### API para mandantes

Una empresa mandante consulta la trazabilidad de sus proveedores con su API key
(se genera en el panel → "Accesos externos" y se muestra **una sola vez**):

```bash
# Proveedores del mandante (aguas arriba) con totales CO2e
curl -H "X-Api-Key: smk_..." https://sicr3p.cl/api/mandante/proveedores

# Resumen de un proveedor (opcional: ?anio=2026&mes=7)
curl -H "X-Api-Key: smk_..." https://sicr3p.cl/api/mandante/proveedor/76.123.456-0/resumen
```

Desde "Accesos externos → Gestionar" se puede además: restringir un mandante a un
subconjunto de RUT proveedor (lista blanca opcional; sin ninguno agregado ve a todos,
como hoy) y configurar un **webhook** que notifica (POST) cada sesión nueva del mandante.

### Cadena de hash (integridad, interna — sin red externa)

Cada factura procesada queda hasheada (SHA-256) y **encadenada a la anterior**
(`hash_cadena = SHA256(hash_anterior + hash_documento)`), en el orden real de
procesamiento y con lock de fila para que sesiones concurrentes no generen una
bifurcación. Es una cadena tipo blockchain **interna** (sin publicar en ninguna red
pública) — sirve para detectar si un registro pasado fue alterado después de creado.

- Panel → Dashboard → "Cadena de integridad": estado y botón para recalcular toda la
  cadena desde el génesis (`GET /api/admin/cadena/verificar`).
- La verificación pública de un documento (`/verificar/:id`) muestra si su eslabón es
  internamente consistente.
- Se exporta a BigQuery (`hash_documento`, `hash_anterior`, `hash_cadena`, `eslabon`)
  para trazar la cadena ahí cuando el export está activo.

### Valorización automática del Capital Natural

Cada cuenta ambiental puede tener un precio unitario citado (panel → Capital Natural →
"Plan de cuentas"). Un activo sin `valor_clp` manual se valoriza solo (extensión ×
precio) y queda marcado **"auto"** — el manual siempre manda cuando existe, y solo se
calcula si la unidad del activo coincide con la de la cuenta (para no mezclar, por
ejemplo, un derecho de agua en l/s con un precio cotizado por m3).

---

## Alcance

Este código cubre la **Etapa 1 completa** más los ítems de **Etapa 2** que no requieren
servicios externos (informes mensuales, cadena comprador-vendedor, verificador DTE local,
módulo Capital Natural). El estado del backlog está en **`ETAPA2.md`** y la hoja de ruta
restante (SII/RCV, motor propio, BigQuery, API mandantes, etc.) en **`ETAPA3.md`**.
