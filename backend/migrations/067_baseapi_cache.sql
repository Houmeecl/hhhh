-- ============================================================
-- Caché de consultas de situación tributaria al SII vía BaseAPI
-- (api.baseapi.cl). Cada consulta cuesta cuota del plan contratado,
-- así que la respuesta se guarda por RUT y se reutiliza (ver
-- services/baseapi.js: frescura de 30 días, y si la fuente está
-- caída se sirve la caché vencida marcada como desactualizada).
-- Solo datos PÚBLICOS del SII (razón social, actividades): no hay
-- clave tributaria ni datos sensibles de terceros en esta tabla.
-- ============================================================

CREATE TABLE IF NOT EXISTS sii_consultas (
  rut_norm      TEXT PRIMARY KEY,          -- RUT sin puntos ni guion, K mayúscula
  respuesta     JSONB NOT NULL,            -- shape normalizado de services/baseapi.js
  consultado_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
