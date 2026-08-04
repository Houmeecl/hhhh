-- ============================================================
-- 064: inscripciones de empresas desde el sitio público.
--
-- Mismo patrón que 052 (solicitudes_auspicio): un formulario público
-- deja la solicitud registrada y un humano la resuelve en el panel. La
-- inscripción NO crea nada por sí sola — al convertirla se crea un
-- prospecto en el pipeline comercial existente (tabla prospectos,
-- migración 001) y queda el vínculo para rastrear de dónde salió.
-- ============================================================

CREATE TABLE IF NOT EXISTS solicitudes_inscripcion (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rut               TEXT NOT NULL,
  nombre_empresa    TEXT NOT NULL,
  contacto_nombre   TEXT NOT NULL,
  contacto_cargo    TEXT,
  contacto_email    TEXT NOT NULL,
  contacto_telefono TEXT,
  -- Qué le interesa. Lista de claves (carbono, corredor, capacitacion,
  -- rep) — texto libre NO: las opciones del formulario son cerradas.
  intereses         JSONB NOT NULL DEFAULT '[]',
  mensaje           TEXT,
  estado            TEXT NOT NULL DEFAULT 'pendiente'
                      CHECK (estado IN ('pendiente', 'convertida', 'descartada')),
  prospecto_id      UUID REFERENCES prospectos(id) ON DELETE SET NULL,
  resuelta_por      UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  resuelta_at       TIMESTAMPTZ,
  ip                TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_solicitudes_inscripcion_estado
  ON solicitudes_inscripcion(estado, created_at DESC);

-- Una sola inscripción pendiente por RUT: reenviar el formulario no debe
-- llenar la bandeja de duplicados. Las resueltas no cuentan, así que una
-- empresa descartada puede volver a inscribirse más adelante.
CREATE UNIQUE INDEX IF NOT EXISTS uq_solicitud_inscripcion_pendiente
  ON solicitudes_inscripcion(rut) WHERE estado = 'pendiente';
