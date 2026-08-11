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

`npm run seed` crea el usuario **admin@sicrep.cl** y, si `ADMIN_PASSWORD` está vacío en
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
- Login opcional sin contraseña con una llave **FIDO2/WebAuthn** con sensor biométrico
  (YubiKey Bio, Kensington VeriMark, Feitian BioPass — hardware estándar, sin fabricar nada
  propio). El verificador biométrico se valida dentro de la llave; el servidor solo recibe una
  firma criptográfica, nunca el dato biométrico. Un admin registra la llave desde Usuarios.jsx;
  el login vive en `/ingresar` (acceso único; /panel/ingresar redirige ahí) junto al login por contraseña.
- Tercera vía: **llave de archivo** — un `.sicr3p-llave` (token de alta entropía, sin cifrar) más
  un PIN de 6 dígitos, emitidos una sola vez desde Usuarios.jsx. El PIN se verifica en el servidor
  (bcrypt + bloqueo tras 5 fallos), no en el archivo. Es explícitamente la vía más débil de las
  tres — un archivo se puede copiar — y así se lo dice la interfaz en cada pantalla donde aparece.
- **Paneles aislados**: la cuenta pertenece a un solo panel (`usuarios.panel`) y el JWT lo firma;
  cada router lo exige. La única excepción es el **superadmin** (`usuarios.es_superadmin`, con un
  CHECK que obliga a que sea admin del panel sicrep): desde el sidebar del admin puede abrir una
  **vista de 5 minutos, de solo lectura y sin refresh**, de cualquier otro panel. No se aflojó
  ningún control — se emite un token sintético que ya los cumple, con `sub` no-UUID (`imp:…`) para
  que cualquier mal uso falle en vez de devolver datos ajenos, y con `nivel_acceso: 'lectura'` para
  que la vista **no pueda firmar un lote ni subir un documento**: eso sellaría un eslabón en la
  cadena de custodia con el RUT del actor real. Todo lo que hace la vista queda en el log de
  actividad a nombre del superadmin. Un admin sin la marca no puede emitir credenciales sobre una
  cuenta superadmin (sería una escalada). **El admin del seed nace como superadmin**; para marcar a
  otro se usa el botón de Usuarios.jsx, que solo ve otro superadmin.
- **Nivel de acceso** (`usuarios.nivel_acceso`: `operador` | `lectura`) para las cuentas de los
  paneles externos, independiente del rol interno. Hoy restringe las dos únicas operaciones de
  escritura que existen fuera de sicrep/terreno: subir un documento en Agencia y firmar un lote en
  Proveedor. Puerto, Mandante y Trazador son de solo lectura por diseño, así que ahí el campo no
  cambia nada — y por eso la interfaz no lo ofrece donde no tiene efecto.
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

**Actualización automática**: ver `deploy/AUTODEPLOY.md` — cron cada 30 min
(`bash deploy/actualizar.sh --instalar-cron`) que hace pull + build + restart con
respaldo previo, health check, **rollback** y diagnóstico por agente si falla.

---

## Estructura de la base de datos

`backend/migrations/001_init.sql` crea: `clientes`, `usuarios`, `tokens_password`,
`sesiones`, `facturas`, `line_items`, `actividad_log`, `prospectos`, `simple_api_uso`.
Las migraciones siguientes (idempotentes, corren solas al arrancar) agregan:
`002` Corredor Bioceánico · `003` Capital Natural (`cuentas_naturales`,
`activos_naturales`, `movimientos_naturales`) · `004` documentos aduaneros ·
`005` búsqueda (pg_trgm) · `006` magic link · `007` inventario FIFO/PMP ·
`008` transporte Cat. 7 · `009`/`012` mandantes (API keys, lista blanca, webhook) ·
`010` motor propio (`motor_categorias`, `facturas.motor`) · `011` precios del
Capital Natural · `013` cadena de hash (`cadena_estado` + hashes en `facturas`) ·
`014` terminales POS (`pos_terminales`) · `015` declaración de embalaje REP
(`declaraciones_embalaje`). Cada factura guarda `rut_emisor` y `rut_receptor`,
que alimentan la cadena comprador-vendedor del panel.

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
- **Movimientos automáticos**: cada documento procesado (flujo público o Corredor) carga la
  cuenta de carbono, con traza a la factura de origen. Las cuentas **físicas** (kWh, m³, t)
  se cargan solo si la categoría salió de la glosa real del documento: el catch-all del motor
  no es una clasificación, y un consumo físico inventado quedaría sellado por hash. También
  hay movimientos manuales (cargo/abono).
- **Activos naturales**: derechos de agua, predios, bosques u otros stocks, con extensión,
  condición (0–100) y valorización CLP manual.
- **Informe "Estado de Capital Natural"** (PDF, folio `N-AAAA-NNNN`): balance por cuenta con
  libro de movimientos, activos y sello de integridad hash.

### Búsqueda con cruces

Buscador unificado (`/admin/buscar`): un RUT, un N° de documento (DIN, MIC/DTA, N° de
venta), un archivo o una empresa devuelve **todas sus apariciones** (clientes, sesiones,
documentos procesados, Corredor) y los **cruces del RUT**: como cliente de sicr3p, sus
proveedores (recibe de) y sus clientes (emite a), con documentos y tCO2e por relación.
Implementado sobre PostgreSQL con `pg_trgm` (migración 005); cuando el volumen lo exija,
la misma API se puede respaldar con Elasticsearch/OpenSearch sin cambiar el frontend.

### Export a BigQuery (data warehouse)

Todo lo que se escanea (facturas + ítems del flujo público y documentos del Corredor),
más los cruces de datos auditados y la capa de gamificación de Sube y Suma (puntaje,
canjes, trayectos y reciclajes), se puede replicar a **BigQuery** para análisis y
cruces a gran escala:

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

### Sube y Suma (`/suma`, escaneo gamificado)

App instalable propia (PWA, distinta del panel núcleo) para que el equipo de una
empresa cliente escanee sus boletas y facturas ganando puntos. Se activa marcando
**"Código de campaña"** al generar un código en "Accesos externos" (mismo mecanismo
de créditos que arriba: 1 crédito = 1 factura, la campaña también tiene un cupo).

- Acceso sin contraseña: `/suma/login` pide correo + código de invitación y envía un
  enlace de un solo uso (igual que el ingreso de clientes en `/ingresar`, pero este
  crea un **jugador persistente** — así el puntaje se acumula entre visitas).
- Cada documento escaneado usa el mismo `POST /api/sesiones` (motor propio) que el
  resto del sitio — el juego nunca calcula CO2e por su cuenta, solo puntúa sobre el
  resultado real.
- Misiones, ranking (nunca cruza de una empresa a otra) y canje de recompensas
  **100% simbólicas** (insignias y constancias de participación — sin dinero real,
  no hay pasarela de pago conectada). Una constancia canjeada se verifica sin login
  por su serial en `/suma/constancia/:serial`.
- Trayecto: el jugador puede marcar hora de salida/llegada y medio de transporte
  usado para llegar a escanear, con puntos extra para medios de bajo carbono
  (caminando, bicicleta, transporte público).
- Panel de impacto (`/suma/impacto`): muestra el CO2e real detrás de los puntos
  del jugador (suma del `total_co2e` de sus documentos escaneados y sus envases
  reciclados) — nunca dice "huella" ni "certificación", aclara que es un
  resumen de su participación.
- Reciclaje en punto limpio (`/suma/reciclar`): el admin crea **puntos limpios**
  (panel → "Accesos externos" → "Puntos limpios") y pega su cartel QR en el lugar.
  El jugador escanea el QR, fotografía los envases que entrega (PET, vidrio,
  latas, tetra) y la IA los cuenta — la foto **no se guarda**, solo el conteo
  validado. GPS obligatorio: con coordenadas cargadas, el registro exige estar
  cerca del punto. Si la foto no se reconoce se pide tomar otra — nunca hay
  declaración manual de cantidades. Topes anti-abuso: 3 registros por jugador
  al día y máximo 30 envases puntuables por foto.
- El GPS también es obligatorio en Trayecto: con la coordenada de salida y la
  de llegada se calcula la distancia del traslado (solo informativa — los
  puntos del trayecto no dependen de ella).

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

## Canal de terreno (`/panel-verde`)

El canal presencial de sicr3p: un operador con cuenta propia captura los documentos
del cliente donde el cliente está —faena, bodega, punto de despacho— desde cualquier
navegador. No hay dispositivo dedicado: el terminal físico `/pos` y la tabla
`pos_terminales` se descontinuaron; el operador entra con correo y clave
(`panel = 'aduana_verde'` en `usuarios`, valor de la migración 027) y trabaja en
`CargarAv.jsx`.

El flujo: datos del cliente → captura de documentos → **el reconocimiento y el
cálculo ocurren en la plataforma** (`POST /api/sesiones`, motor propio para DTE XML)
→ declaración de embalajes **REP Ley 20.920** (componentes por material → %
reciclabilidad Alto/Medio/Bajo) → **compensación del CO2 calculado** (t CO2e × tarifa
referencial, editable y marcada "referencial") → comprobante con QR verificable
(`/verificar/:id`, cadena de hash). El **pago es simulado** hasta integrar una
pasarela real (VirtualPos, pendiente de credenciales); todo lo demás es real contra
el backend.

Este canal no tiene landing propia: `/aduana-verde` era una segunda portada con su
propio header y los mismos destinos que `/`, y **hoy redirige a `/`** (la ruta se
conserva porque el enlace ya salió repartido). Su contenido útil —tarjetas REP, fila
de cifras del modelo, captura real del Pasaporte Digital y el bloque de estado
honesto— vive ahora en la portada.

---

## Alcance

Este código cubre la **Etapa 1 completa**, la **Etapa 2** (informes mensuales, cadena
comprador-vendedor, verificador DTE local, Capital Natural, BigQuery, API de mandantes) y
buena parte de lo que originalmente era Etapa 3: **conexión al SII y descarga del registro
de compras y ventas**, **motor de cálculo propio** con fuentes metodológicas citadas y
versionado, informes PDF, cadena de integridad, siete paneles por perfil, y los módulos
REP, CBAM, Pasaporte de Origen, Torre logística, APL e Instituto.

El estado detallado está en **`ETAPA2.md`** y **`ETAPA3.md`** — esos dos archivos son la
fuente de verdad del avance; lo que queda pendiente ahí (PCAF, ISO 14083 por envío, bonos
vía socio acreditado) está marcado como tal.
