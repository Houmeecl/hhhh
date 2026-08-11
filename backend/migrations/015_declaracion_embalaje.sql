-- ============================================================
-- sicr3p — Declaración de envases y embalajes REP (Ley 20.920).
-- Persiste la pre-declaración operativa que el operador arma en el
-- terminal de mostrador (/pos): composición por componentes
-- (material, peso, cantidad, reciclabilidad) y el % de reciclabilidad
-- calculado en el SERVIDOR con la fórmula del packaging-calculator
-- de SICREP: % = peso reciclable / peso total × 100, con nivel
-- 'Alto' (≥70), 'Medio' (≥50) o 'Bajo' (<50).
-- Una declaración por sesión: un nuevo POST reemplaza la anterior
-- (UNIQUE(sesion_id) + ON CONFLICT DO UPDATE). No reemplaza la
-- declaración formal ante el MMA (RETC/SGR).
-- ============================================================

CREATE TABLE IF NOT EXISTS declaraciones_embalaje (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sesion_id          UUID NOT NULL REFERENCES sesiones(id) ON DELETE CASCADE,
  componentes        JSONB NOT NULL,      -- [{material, peso_gr, cantidad, reciclable}]
  peso_total_gr      NUMERIC NOT NULL,    -- peso total declarado (recalculado en servidor)
  peso_reciclable_gr NUMERIC NOT NULL,    -- peso de los componentes reciclables
  porcentaje         NUMERIC NOT NULL,    -- % reciclabilidad, 1 decimal (fórmula SICREP)
  nivel              TEXT NOT NULL CHECK (nivel IN ('Alto','Medio','Bajo')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sesion_id)                      -- una declaración por sesión (re-POST la reemplaza)
);
