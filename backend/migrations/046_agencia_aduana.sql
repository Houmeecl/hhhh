-- ============================================================
-- 046: agencias de aduana — el actor externo real que hace el despacho
-- oficial mientras sicrep aporta la capa documental/de trazabilidad
-- (nunca se presenta como agencia de aduanas). Mismo patrón que
-- `puertos` (migración 040) para el actor + mismo patrón que la
-- migración 042 para su panel web propio (usuarios.agencia_id).
--
-- A diferencia de Puerto/Mandante (solo lectura), el panel de agencia
-- SÍ escribe: sube documentos de la Carga Bioceánica (POST en
-- routes/agencia.js) — es quien captura el expediente en terreno.
-- ============================================================

CREATE TABLE IF NOT EXISTS agencias_aduana (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      TEXT NOT NULL,
  rut         TEXT,
  token_hash  TEXT NOT NULL UNIQUE,
  activo      BOOLEAN NOT NULL DEFAULT true,
  ultimo_uso  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE lotes_minerales ADD COLUMN IF NOT EXISTS agencia_id UUID REFERENCES agencias_aduana(id);
CREATE INDEX IF NOT EXISTS idx_lotes_agencia ON lotes_minerales(agencia_id) WHERE agencia_id IS NOT NULL;

-- Guardias de re-ejecución (las migraciones corren completas en cada
-- arranque): los CHECK solo se recrean si la definición vigente aún no
-- conoce 'agencia' — si una futura migración los volviera a ampliar,
-- esta pasada los dejará tal cual, igual que la 042 respeta a esta.
DO $$
DECLARE def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'usuarios_panel_check' AND conrelid = 'usuarios'::regclass;
  IF def IS NULL OR def NOT LIKE '%agencia%' THEN
    ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_panel_check;
    ALTER TABLE usuarios ADD CONSTRAINT usuarios_panel_check
      CHECK (panel IN ('sicrep', 'aduana_verde', 'puerto', 'mandante', 'agencia'));
  END IF;
END $$;

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS agencia_id UUID REFERENCES agencias_aduana(id) ON DELETE CASCADE;

DO $$
DECLARE def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'usuarios_panel_entidad_check' AND conrelid = 'usuarios'::regclass;
  IF def IS NULL OR def NOT LIKE '%agencia_id%' THEN
    ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_panel_entidad_check;
    ALTER TABLE usuarios ADD CONSTRAINT usuarios_panel_entidad_check CHECK (
      (panel = 'puerto' AND puerto_id IS NOT NULL AND mandante_id IS NULL AND agencia_id IS NULL) OR
      (panel = 'mandante' AND mandante_id IS NOT NULL AND puerto_id IS NULL AND agencia_id IS NULL) OR
      (panel = 'agencia' AND agencia_id IS NOT NULL AND puerto_id IS NULL AND mandante_id IS NULL) OR
      (panel IN ('sicrep', 'aduana_verde') AND puerto_id IS NULL AND mandante_id IS NULL AND agencia_id IS NULL)
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_usuarios_agencia ON usuarios(agencia_id) WHERE agencia_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_agencia_unico ON usuarios(agencia_id) WHERE agencia_id IS NOT NULL;
