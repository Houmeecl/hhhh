-- ============================================================
-- sicr3p — Etapa 1 · Esquema inicial
-- PostgreSQL 14+ (Neon compatible)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- Clientes (empresas) ----------
CREATE TABLE IF NOT EXISTS clientes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rut             TEXT UNIQUE NOT NULL,
  nombre_empresa  TEXT NOT NULL,
  contacto_email  TEXT,
  estado_contrato TEXT NOT NULL DEFAULT 'piloto'
                    CHECK (estado_contrato IN ('piloto','activo','vencido')),
  fecha_inicio    DATE,
  fecha_fin       DATE,
  plan            TEXT DEFAULT 'piloto',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Usuarios (admin / operador / cliente) ----------
CREATE TABLE IF NOT EXISTS usuarios (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                TEXT UNIQUE NOT NULL,
  password_hash        TEXT,
  nombre               TEXT NOT NULL,
  rol                  TEXT NOT NULL DEFAULT 'operador'
                         CHECK (rol IN ('admin','operador','cliente')),
  cliente_id           UUID REFERENCES clientes(id) ON DELETE SET NULL,
  estado               TEXT NOT NULL DEFAULT 'activo'
                         CHECK (estado IN ('activo','suspendido','pendiente')),
  must_reset_password  BOOLEAN NOT NULL DEFAULT false,
  ultimo_login         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Tokens de activación / reset ----------
CREATE TABLE IF NOT EXISTS tokens_password (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  tipo        TEXT NOT NULL CHECK (tipo IN ('activacion','reset')),
  expira_at   TIMESTAMPTZ NOT NULL,
  usado       BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tokens_password_hash ON tokens_password(token_hash);

-- ---------- Sesiones públicas (una tanda de facturas) ----------
CREATE TABLE IF NOT EXISTS sesiones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rut_cliente    TEXT,
  nombre_cliente TEXT,
  email_cliente  TEXT,
  fecha          DATE NOT NULL DEFAULT CURRENT_DATE,
  total_co2e     NUMERIC(14,4) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Facturas ----------
CREATE TABLE IF NOT EXISTS facturas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sesion_id         UUID NOT NULL REFERENCES sesiones(id) ON DELETE CASCADE,
  invoice_id_simple TEXT,
  numero_venta      TEXT,
  archivo_original  TEXT,
  rut_emisor        TEXT,   -- comprador/vendedor: preparación trazabilidad futura
  rut_receptor      TEXT,   -- comprador/vendedor: preparación trazabilidad futura
  total_co2e        NUMERIC(14,4) NOT NULL DEFAULT 0,
  categoria         TEXT,
  status            TEXT NOT NULL DEFAULT 'procesada'
                      CHECK (status IN ('pendiente','procesando','procesada','error')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_facturas_sesion ON facturas(sesion_id);

-- ---------- Ítems de línea ----------
CREATE TABLE IF NOT EXISTS line_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factura_id       UUID NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
  descripcion      TEXT NOT NULL,
  cantidad         NUMERIC(14,3) NOT NULL DEFAULT 1,
  co2e             NUMERIC(14,4) NOT NULL DEFAULT 0,
  porcentaje_total NUMERIC(6,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_line_items_factura ON line_items(factura_id);

-- ---------- Log de actividad (auditoría admin) ----------
CREATE TABLE IF NOT EXISTS actividad_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  accion      TEXT NOT NULL,
  entidad     TEXT,
  entidad_id  TEXT,
  detalle     JSONB,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_actividad_created ON actividad_log(created_at);

-- ---------- Prospectos (pipeline comercial) ----------
CREATE TABLE IF NOT EXISTS prospectos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_empresa TEXT NOT NULL,
  rut            TEXT,
  contacto       TEXT,
  etapa          TEXT NOT NULL DEFAULT 'nuevo'
                   CHECK (etapa IN ('nuevo','contactado','demo','piloto','ganado','perdido')),
  origen         TEXT,
  notas          TEXT,
  proxima_accion DATE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Uso de Simple API ----------
CREATE TABLE IF NOT EXISTS simple_api_uso (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sesion_id       UUID REFERENCES sesiones(id) ON DELETE SET NULL,
  endpoint        TEXT NOT NULL,
  metodo          TEXT NOT NULL,
  status_code     INTEGER,
  latencia_ms     INTEGER,
  costo_estimado  NUMERIC(10,4) DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_simple_uso_created ON simple_api_uso(created_at);
