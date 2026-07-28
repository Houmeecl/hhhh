-- ============================================================
-- 058: panel 'trazador' — un cuarto panel externo, mismo patrón de
-- sesión humana que 042 (puerto/mandante) y 046 (agencia): una fila de
-- `usuarios` con panel='trazador' atada a SU propia entidad vía
-- usuarios.trazador_id.
--
-- A diferencia de puerto/mandante/agencia, un trazador NO es una
-- integración máquina a máquina: es un tercero externo (auditora,
-- cliente final, organismo) al que un admin le da una cuenta web para
-- que busque por RUT — por eso `trazadores` no lleva token_hash ni
-- ultimo_uso de API key, solo el login por sesión ya construido.
--
-- El acceso NUNCA es "todos los RUT": trazador_ruts es una lista blanca
-- obligatoria (mismo criterio que lotesCbamDelMandante en
-- routes/mandante.js) — sin filas activas ahí, el trazador no ve nada.
-- La tabla nace vacía: la puebla un admin desde Accesos.jsx con RUT
-- reales, nunca con datos de ejemplo.
-- ============================================================

CREATE TABLE IF NOT EXISTS trazadores (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      TEXT NOT NULL,
  activo      BOOLEAN NOT NULL DEFAULT true,
  ultimo_uso  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lista blanca de RUT visibles para este trazador — un RUT por fila,
-- igual patrón que mandante_proveedores (migración 012), pero aquí la
-- whitelist NUNCA es opcional: vacía = no ve ningún RUT.
CREATE TABLE IF NOT EXISTS trazador_ruts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trazador_id  UUID NOT NULL REFERENCES trazadores(id) ON DELETE CASCADE,
  rut          TEXT NOT NULL,   -- normalizado: sin puntos/guión, K en mayúscula
  activo       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trazador_id, rut)
);
CREATE INDEX IF NOT EXISTS idx_trazador_ruts_trazador ON trazador_ruts(trazador_id);

-- Guardias de re-ejecución (las migraciones corren completas en cada
-- arranque): los CHECK solo se recrean si la definición vigente aún no
-- conoce 'trazador' — si una futura migración los volviera a ampliar,
-- esta pasada los dejará tal cual, igual que 046 respeta a 042.
DO $$
DECLARE def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'usuarios_panel_check' AND conrelid = 'usuarios'::regclass;
  IF def IS NULL OR def NOT LIKE '%trazador%' THEN
    ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_panel_check;
    ALTER TABLE usuarios ADD CONSTRAINT usuarios_panel_check
      CHECK (panel IN ('sicrep', 'aduana_verde', 'puerto', 'mandante', 'agencia', 'trazador'));
  END IF;
END $$;

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS trazador_id UUID REFERENCES trazadores(id) ON DELETE CASCADE;

DO $$
DECLARE def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'usuarios_panel_entidad_check' AND conrelid = 'usuarios'::regclass;
  IF def IS NULL OR def NOT LIKE '%trazador_id%' THEN
    ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_panel_entidad_check;
    ALTER TABLE usuarios ADD CONSTRAINT usuarios_panel_entidad_check CHECK (
      (panel = 'puerto' AND puerto_id IS NOT NULL AND mandante_id IS NULL AND agencia_id IS NULL AND trazador_id IS NULL) OR
      (panel = 'mandante' AND mandante_id IS NOT NULL AND puerto_id IS NULL AND agencia_id IS NULL AND trazador_id IS NULL) OR
      (panel = 'agencia' AND agencia_id IS NOT NULL AND puerto_id IS NULL AND mandante_id IS NULL AND trazador_id IS NULL) OR
      (panel = 'trazador' AND trazador_id IS NOT NULL AND puerto_id IS NULL AND mandante_id IS NULL AND agencia_id IS NULL) OR
      (panel IN ('sicrep', 'aduana_verde') AND puerto_id IS NULL AND mandante_id IS NULL AND agencia_id IS NULL AND trazador_id IS NULL)
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_usuarios_trazador ON usuarios(trazador_id) WHERE trazador_id IS NOT NULL;

-- Un login web por trazador alcanza para esta ronda (mismo criterio que
-- puerto/mandante/agencia); si más adelante hace falta más de una cuenta
-- por trazador, se puede sumar sin romper nada quitando este UNIQUE.
CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_trazador_unico ON usuarios(trazador_id) WHERE trazador_id IS NOT NULL;
