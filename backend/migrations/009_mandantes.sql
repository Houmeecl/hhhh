-- ============================================================
-- sicr3p — API para mandantes: empresas que consultan la
-- trazabilidad y CO2e de sus proveedores vía API (X-Api-Key).
-- El token se guarda hasheado; se muestra en claro solo al crearlo.
-- ============================================================

CREATE TABLE IF NOT EXISTS mandantes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_empresa TEXT NOT NULL,
  rut            TEXT NOT NULL,
  email          TEXT,
  token_hash     TEXT UNIQUE NOT NULL,
  activo         BOOLEAN NOT NULL DEFAULT true,
  ultimo_uso     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Códigos de acceso con créditos (mini sitio de prueba):
-- 1 crédito = 1 factura procesada. Cada código parte con 5.
-- ============================================================

CREATE TABLE IF NOT EXISTS codigos_acceso (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo          TEXT UNIQUE NOT NULL,
  creditos        INT NOT NULL DEFAULT 5,
  creditos_usados INT NOT NULL DEFAULT 0,
  empresa         TEXT,
  email           TEXT,
  activo          BOOLEAN NOT NULL DEFAULT true,
  ultimo_uso      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
