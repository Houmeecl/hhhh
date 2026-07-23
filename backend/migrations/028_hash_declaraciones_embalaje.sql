-- ============================================================
-- sicr3p — Cadena de hash para declaraciones REP (Ley 20.920).
--
-- Hoy `declaraciones_embalaje` se sobreescribe sin dejar rastro
-- (UNIQUE(sesion_id) + ON CONFLICT DO UPDATE, migración 015): un
-- nuevo POST reemplaza la versión anterior sin ninguna evidencia de
-- integridad ni de qué decía la versión reemplazada. Esta migración:
--
-- 1) Agrega columnas de hash a la fila VIGENTE, encadenadas contra la
--    cadena GLOBAL ya existente (misma secuencia/lock que facturas,
--    services/cadenaHash.js + cadena_estado de la migración 013) —
--    no se crea un génesis nuevo, se reusa el mismo.
-- 2) Crea una tabla de historial APPEND-ONLY: antes de sobreescribir
--    una declaración, su versión completa (con su propio hash de esa
--    época) se copia ahí. Así "reemplazar" ya no borra evidencia.
-- ============================================================

ALTER TABLE declaraciones_embalaje ADD COLUMN IF NOT EXISTS hash_documento TEXT;
ALTER TABLE declaraciones_embalaje ADD COLUMN IF NOT EXISTS hash_anterior  TEXT;
ALTER TABLE declaraciones_embalaje ADD COLUMN IF NOT EXISTS hash_cadena    TEXT;
ALTER TABLE declaraciones_embalaje ADD COLUMN IF NOT EXISTS eslabon        BIGINT;
CREATE INDEX IF NOT EXISTS idx_declaraciones_embalaje_eslabon ON declaraciones_embalaje(eslabon);

CREATE TABLE IF NOT EXISTS declaraciones_embalaje_historial (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  declaracion_id     UUID NOT NULL,        -- id estable de declaraciones_embalaje (no cambia con ON CONFLICT)
  sesion_id          UUID NOT NULL REFERENCES sesiones(id) ON DELETE CASCADE,
  componentes        JSONB NOT NULL,
  peso_total_gr      NUMERIC NOT NULL,
  peso_reciclable_gr NUMERIC NOT NULL,
  porcentaje         NUMERIC NOT NULL,
  nivel              TEXT NOT NULL,
  hash_documento     TEXT NOT NULL,
  hash_anterior      TEXT NOT NULL,
  hash_cadena        TEXT NOT NULL,
  eslabon            BIGINT NOT NULL,
  vigente_desde      TIMESTAMPTZ NOT NULL,  -- created_at de la versión reemplazada
  reemplazada_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_decl_embalaje_hist_sesion ON declaraciones_embalaje_historial(sesion_id);
