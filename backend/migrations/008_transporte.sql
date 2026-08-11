-- ============================================================
-- sicr3p — Transporte de personal (GHG Protocol Categoría 7).
-- Modos con factor editable (kgCO2e por pasajero-km) y registro
-- de traslados con cálculo al momento de guardar.
-- ============================================================

CREATE TABLE IF NOT EXISTS transporte_modos (
  codigo            TEXT PRIMARY KEY CHECK (codigo IN ('bus','camioneta','auto','avion','tren')),
  nombre            TEXT NOT NULL,
  factor_kgco2e_pkm NUMERIC(10,5) NOT NULL,   -- kgCO2e por pasajero-km (editable)
  fuente            TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transporte_viajes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rut_cliente TEXT,
  fecha       DATE NOT NULL DEFAULT CURRENT_DATE,
  modo        TEXT NOT NULL REFERENCES transporte_modos(codigo),
  origen      TEXT NOT NULL,
  destino     TEXT NOT NULL,
  km          NUMERIC(10,1) NOT NULL CHECK (km > 0),
  pasajeros   INT NOT NULL DEFAULT 1 CHECK (pasajeros > 0),
  ida_vuelta  BOOLEAN NOT NULL DEFAULT false,
  co2e        NUMERIC(14,4) NOT NULL,          -- tCO2e calculado al guardar
  notas       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transporte_viajes_fecha ON transporte_viajes(fecha);
