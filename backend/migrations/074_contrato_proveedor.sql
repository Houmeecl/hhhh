-- ============================================================
-- 074: contratos también sobre `proveedores` (la empresa enrolada en la
-- sección SII, con panel propio). Mismo patrón que 051_auspiciadores.sql
-- al añadir auspiciador_id: tercera contraparte posible, exactamente una
-- por contrato.
-- ============================================================

ALTER TABLE contratos ADD COLUMN IF NOT EXISTS proveedor_id UUID REFERENCES proveedores(id) ON DELETE CASCADE;

DO $$
BEGIN
  ALTER TABLE contratos DROP CONSTRAINT IF EXISTS contratos_contraparte_check;
  ALTER TABLE contratos ADD CONSTRAINT contratos_contraparte_check CHECK (
    (cliente_id IS NOT NULL AND auspiciador_id IS NULL AND proveedor_id IS NULL) OR
    (cliente_id IS NULL AND auspiciador_id IS NOT NULL AND proveedor_id IS NULL) OR
    (cliente_id IS NULL AND auspiciador_id IS NULL AND proveedor_id IS NOT NULL)
  );
END $$;

-- Un proveedor puede tener a lo más un contrato vigente por tipo (igual que
-- un cliente); no hay razón para permitir dos "asesoria" vigentes a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS uq_contratos_vigente_proveedor
  ON contratos(proveedor_id, tipo) WHERE proveedor_id IS NOT NULL AND estado <> 'anulado';

CREATE INDEX IF NOT EXISTS idx_contratos_proveedor ON contratos(proveedor_id, created_at DESC);
