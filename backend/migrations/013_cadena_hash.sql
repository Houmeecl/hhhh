-- ============================================================
-- sicr3p — Cadena de hash tipo blockchain (interna, sin red externa).
-- Cada factura queda hasheada y encadenada a la anterior (SHA-256):
-- si alguien altera un registro pasado, la cadena se rompe desde ahí
-- en adelante. Se exporta a BigQuery para trazarla ahí también.
-- ============================================================

-- Fila única (id=1) que guarda el estado de la cadena — se bloquea con
-- FOR UPDATE al procesar una sesión para serializar sesiones concurrentes.
CREATE TABLE IF NOT EXISTS cadena_estado (
  id           INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ultimo_hash  TEXT NOT NULL DEFAULT repeat('0', 64),  -- génesis
  n_eslabones  BIGINT NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO cadena_estado (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE facturas ADD COLUMN IF NOT EXISTS hash_documento TEXT;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS hash_anterior TEXT;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS hash_cadena TEXT;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS eslabon BIGINT;
CREATE INDEX IF NOT EXISTS idx_facturas_eslabon ON facturas(eslabon);
