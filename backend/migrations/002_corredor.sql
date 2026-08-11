-- ============================================================
-- sicr3p — Módulo Corredor Bioceánico Capricornio
-- Metodología por país + documentos de trazabilidad/contabilidad
-- ============================================================

-- ---------- Metodología de carbono por país ----------
-- Un registro por país del corredor (CL/AR/PY/BR). El admin la edita y la activa.
CREATE TABLE IF NOT EXISTS metodologias_pais (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pais        TEXT UNIQUE NOT NULL CHECK (pais IN ('CL','AR','PY','BR')),
  nombre      TEXT NOT NULL,
  factores    JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {electricidad_kgco2e_kwh, diesel_kgco2e_l, ...}
  referencia  TEXT,          -- marco/norma (GHG Protocol, ISO 14064, programa nacional)
  fuente      TEXT,          -- origen de los factores
  vigencia    TEXT,          -- p.ej. "2023"
  activo      BOOLEAN NOT NULL DEFAULT false,
  notas       TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Documentos cargados al corredor ----------
CREATE TABLE IF NOT EXISTS documentos_corredor (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pais_origen      TEXT,
  pais_destino     TEXT,
  tramo            TEXT,
  tipo_documento   TEXT NOT NULL DEFAULT 'otro'
                     CHECK (tipo_documento IN ('factura','guia','manifiesto','energia','combustible','contrato','otro')),
  rut_emisor       TEXT,
  rut_receptor     TEXT,
  archivo_original TEXT,
  metodologia_pais TEXT,     -- país cuya metodología se aplicó
  estado           TEXT NOT NULL DEFAULT 'traza'
                     CHECK (estado IN ('traza','procesado','pendiente_motor')),
  total_co2e       NUMERIC(14,4) NOT NULL DEFAULT 0,
  categoria        TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doc_corredor_created ON documentos_corredor(created_at);

-- ---------- Ítems de un documento (cuando hay cálculo) ----------
CREATE TABLE IF NOT EXISTS documento_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id     UUID NOT NULL REFERENCES documentos_corredor(id) ON DELETE CASCADE,
  descripcion      TEXT NOT NULL,
  cantidad         NUMERIC(14,3) NOT NULL DEFAULT 1,
  co2e             NUMERIC(14,4) NOT NULL DEFAULT 0,
  porcentaje_total NUMERIC(6,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_doc_items_doc ON documento_items(documento_id);
