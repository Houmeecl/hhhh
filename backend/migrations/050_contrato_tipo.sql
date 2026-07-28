-- ============================================================
-- 050: tipo de contrato.
--
-- El Paquete Contractual (docs/legal/contratos/) trae contratos distintos
-- según con quién se firma. Los dos que se emiten contra un `cliente`:
--   'asesoria' → SICR3P-LEGAL-05, el proveedor que paga el servicio.
--   'mandante' → SICR3P-LEGAL-02, el programa Scope 3 con una empresa ancla.
-- Antes existía una sola plantilla genérica, así que los contratos ya
-- emitidos quedan como 'asesoria', que es el caso por defecto.
-- ============================================================

ALTER TABLE contratos ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'asesoria';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'contratos_tipo_check' AND conrelid = 'contratos'::regclass
  ) THEN
    ALTER TABLE contratos ADD CONSTRAINT contratos_tipo_check
      CHECK (tipo IN ('asesoria', 'mandante'));
  END IF;
END $$;
