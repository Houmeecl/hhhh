-- ============================================================
-- sicr3p — Módulo Capital Natural (SEEA simplificado)
-- Plan de cuentas ambiental + activos naturales (stock) +
-- movimientos (flujo) con traza al documento de origen.
-- ============================================================

-- ---------- Plan de cuentas ambiental ----------
CREATE TABLE IF NOT EXISTS cuentas_naturales (
  codigo      TEXT PRIMARY KEY CHECK (codigo IN ('AGUA','ENER','CO2E','MATR','SUEL','BIOD')),
  nombre      TEXT NOT NULL,
  unidad      TEXT NOT NULL,               -- m3, kWh, tCO2e, t, ha, índice
  tipo        TEXT NOT NULL DEFAULT 'flujo' CHECK (tipo IN ('flujo','stock','ambos')),
  activo      BOOLEAN NOT NULL DEFAULT false,
  factores    JSONB NOT NULL DEFAULT '{}'::jsonb,  -- conversiones documento→cuenta (editables)
  marco       TEXT,                        -- SEEA, Natural Capital Protocol, TNFD…
  fuente      TEXT,
  notas       TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Activos naturales (stocks) ----------
CREATE TABLE IF NOT EXISTS activos_naturales (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        TEXT NOT NULL,
  cuenta_codigo TEXT NOT NULL REFERENCES cuentas_naturales(codigo),
  descripcion   TEXT,
  extension     NUMERIC(14,3) NOT NULL DEFAULT 0,   -- magnitud del stock (en `unidad`)
  unidad        TEXT,
  condicion     INT CHECK (condicion BETWEEN 0 AND 100),  -- estado ecosistémico 0–100 (opcional)
  valor_clp     NUMERIC(16,0),              -- valorización manual (opcional)
  ubicacion     TEXT,
  vigencia      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activos_nat_cuenta ON activos_naturales(cuenta_codigo);

-- ---------- Movimientos (flujos del período) ----------
CREATE TABLE IF NOT EXISTS movimientos_naturales (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_codigo TEXT NOT NULL REFERENCES cuentas_naturales(codigo),
  fecha         DATE NOT NULL DEFAULT CURRENT_DATE,
  glosa         TEXT NOT NULL,
  factura_id    UUID REFERENCES facturas(id) ON DELETE SET NULL,  -- traza al documento
  cantidad      NUMERIC(16,4) NOT NULL,
  unidad        TEXT NOT NULL,
  tipo          TEXT NOT NULL DEFAULT 'cargo' CHECK (tipo IN ('cargo','abono')),
  origen        TEXT NOT NULL DEFAULT 'documento' CHECK (origen IN ('documento','manual')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mov_nat_cuenta_fecha ON movimientos_naturales(cuenta_codigo, fecha);
