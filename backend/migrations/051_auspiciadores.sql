-- ============================================================
-- 051: auspiciadores y contratos generalizados.
--
-- El Paquete Contractual trae dos documentos que NO se firman con un
-- cliente sino con un auspiciador —banco, leasing, automotora— que aporta
-- recursos al programa Ruta SICR3P:
--   SICR3P-LEGAL-01  Convenio Marco de Auspicio, Movilidad y Colaboración
--   SICR3P-LEGAL-06  Comodato de Vehículo
--
-- `contratos` nació atado a `cliente_id NOT NULL`. Se generaliza a dos
-- contrapartes posibles, con un CHECK que exige exactamente una: mismo
-- patrón que usuarios_panel_entidad_check de la migración 042.
-- ============================================================

CREATE TABLE IF NOT EXISTS auspiciadores (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rut             TEXT UNIQUE NOT NULL,
  nombre_empresa  TEXT NOT NULL,
  contacto_email  TEXT,
  -- Qué aporta. El convenio distingue vehículo, dinero y difusión, y de
  -- eso depende si además corresponde firmar el comodato.
  aporta_vehiculo BOOLEAN NOT NULL DEFAULT false,
  vehiculo        JSONB NOT NULL DEFAULT '{}',   -- marca, modelo, patente, año
  fecha_inicio    DATE,
  fecha_fin       DATE,
  activo          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE contratos ADD COLUMN IF NOT EXISTS auspiciador_id UUID REFERENCES auspiciadores(id) ON DELETE CASCADE;
ALTER TABLE contratos ALTER COLUMN cliente_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'contratos_contraparte_check' AND conrelid = 'contratos'::regclass
  ) THEN
    ALTER TABLE contratos ADD CONSTRAINT contratos_contraparte_check CHECK (
      (cliente_id IS NOT NULL AND auspiciador_id IS NULL) OR
      (cliente_id IS NULL AND auspiciador_id IS NOT NULL)
    );
  END IF;
END $$;

-- El CHECK de tipo se amplía a los dos documentos de auspicio.
DO $$
DECLARE def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'contratos_tipo_check' AND conrelid = 'contratos'::regclass;
  IF def IS NULL OR def NOT LIKE '%auspicio%' THEN
    ALTER TABLE contratos DROP CONSTRAINT IF EXISTS contratos_tipo_check;
    ALTER TABLE contratos ADD CONSTRAINT contratos_tipo_check
      CHECK (tipo IN ('asesoria', 'mandante', 'auspicio', 'comodato'));
  END IF;
END $$;

-- El índice de "un contrato vigente por cliente" no cubría al auspiciador.
-- Un auspiciador SÍ puede tener dos vigentes a la vez (convenio + comodato),
-- así que la unicidad es por contraparte Y tipo.
DROP INDEX IF EXISTS uq_contratos_vigente;
CREATE UNIQUE INDEX IF NOT EXISTS uq_contratos_vigente_cliente
  ON contratos(cliente_id, tipo) WHERE cliente_id IS NOT NULL AND estado <> 'anulado';
CREATE UNIQUE INDEX IF NOT EXISTS uq_contratos_vigente_auspiciador
  ON contratos(auspiciador_id, tipo) WHERE auspiciador_id IS NOT NULL AND estado <> 'anulado';

CREATE INDEX IF NOT EXISTS idx_contratos_auspiciador ON contratos(auspiciador_id, created_at DESC);
