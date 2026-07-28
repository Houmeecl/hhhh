-- ============================================================
-- 052: postulaciones de auspicio.
--
-- Hasta ahora un auspiciador solo podía nacer de un alta manual en el
-- panel: alguien tenía que conocerlo, hablar con él y transcribirlo. Esta
-- tabla abre el camino de entrada — una empresa postula desde el sitio
-- público— y deja el registro de qué se pidió, cuándo y quién lo resolvió.
--
-- La postulación NO crea un auspiciador. Solo al aceptarla se crea la fila
-- en `auspiciadores` y se emiten sus contratos, y queda el vínculo para
-- poder rastrear de qué postulación salió.
-- ============================================================

CREATE TABLE IF NOT EXISTS solicitudes_auspicio (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rut              TEXT NOT NULL,
  nombre_empresa   TEXT NOT NULL,
  contacto_nombre  TEXT,
  contacto_email   TEXT NOT NULL,
  contacto_telefono TEXT,
  -- Qué ofrece aportar. El convenio marco distingue estas tres formas.
  aporta_vehiculo  BOOLEAN NOT NULL DEFAULT false,
  aporta_monetario BOOLEAN NOT NULL DEFAULT false,
  aporta_difusion  BOOLEAN NOT NULL DEFAULT false,
  vehiculo         JSONB NOT NULL DEFAULT '{}',
  ciudades         TEXT,
  mensaje          TEXT,
  estado           TEXT NOT NULL DEFAULT 'pendiente'
                     CHECK (estado IN ('pendiente', 'aceptada', 'rechazada')),
  motivo_rechazo   TEXT,
  auspiciador_id   UUID REFERENCES auspiciadores(id) ON DELETE SET NULL,
  resuelta_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  resuelta_at      TIMESTAMPTZ,
  ip               TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_solicitudes_auspicio_estado
  ON solicitudes_auspicio(estado, created_at DESC);

-- Una sola postulación pendiente por RUT: reenviar el formulario no debe
-- llenar el panel de duplicados. Las ya resueltas no cuentan, así que una
-- empresa rechazada puede volver a postular más adelante.
CREATE UNIQUE INDEX IF NOT EXISTS uq_solicitud_auspicio_pendiente
  ON solicitudes_auspicio(rut) WHERE estado = 'pendiente';
