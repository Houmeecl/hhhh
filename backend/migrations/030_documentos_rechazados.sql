-- ============================================================
-- Bitácora de documentos rechazados por lectura automática.
--
-- Desde la eliminación de la corrección manual, lo ilegible se
-- rechaza con HTTP 422 y la sesión nunca llega a existir — sin
-- esta tabla la tasa de rechazo era invisible (el rollback se
-- llevaba todo rastro). Minimización por diseño: NO se guarda el
-- binario del documento, solo metadatos y el sha256 del buffer
-- (permite detectar reintentos del mismo archivo y su eventual
-- aceptación sin retener contenido del cliente).
-- ============================================================

CREATE TABLE IF NOT EXISTS documentos_rechazados (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_archivo  TEXT NOT NULL,
  extension       TEXT,
  tamano_bytes    BIGINT,
  sha256          TEXT NOT NULL,
  motivo          TEXT NOT NULL CHECK (motivo IN ('sin_senal', 'formato_no_permitido', 'monto_fuera_de_rango')),
  etapa_alcanzada TEXT NOT NULL DEFAULT 'ninguna'
    CHECK (etapa_alcanzada IN ('pdf_texto', 'pdf_ocr', 'imagen_ocr', 'heic_ocr', 'xml', 'ninguna')),
  rut_cliente     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documentos_rechazados_created ON documentos_rechazados(created_at);
CREATE INDEX IF NOT EXISTS idx_documentos_rechazados_sha ON documentos_rechazados(sha256);
