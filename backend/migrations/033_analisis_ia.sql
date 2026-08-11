-- ============================================================
-- Análisis de documentos con IA (Anthropic Claude) — camino principal
-- de lectura de texto/OCR, con el motor de reglas (regex) como
-- respaldo automático. La IA SOLO extrae y clasifica: nombre, RUTs,
-- folio, ítems con monto/cantidad y el tipo de documento (factura,
-- orden de compra, guía de despacho, etc.) — el cálculo de CO2e sigue
-- siendo 100% del motor propio determinista (motorPropio.js), nunca
-- lo hace la IA.
--
-- 1) 'propio_ia' se suma a los orígenes de facturas.motor — mismo
--    patrón idempotente de las migraciones 017/019 (solo se re-crea
--    el CHECK si aún no admite el valor nuevo).
-- 2) analisis_ia_uso: bitácora de cada llamada (éxito o no), sin RUT
--    ni contenido del documento — solo metadatos operativos (tokens,
--    latencia, costo estimado) para el panel de transparencia del
--    admin, igual que simple_api_uso ya hace con el motor externo.
--    Sin FK a sesión: la llamada ocurre en el pre-pass, antes de que
--    la sesión exista (igual que documentos_rechazados).
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'facturas'::regclass
      AND conname = 'facturas_motor_check'
      AND pg_get_constraintdef(oid) LIKE '%propio_ia%'
  ) THEN
    ALTER TABLE facturas DROP CONSTRAINT IF EXISTS facturas_motor_check;
    ALTER TABLE facturas ADD CONSTRAINT facturas_motor_check
      CHECK (motor IN ('propio', 'propio_texto', 'propio_ocr', 'propio_ia', 'externo',
                       'revision', 'propio_revisado'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS analisis_ia_uso (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  modelo            TEXT NOT NULL,
  exito             BOOLEAN NOT NULL,
  motivo_error      TEXT,
  tokens_entrada    INTEGER,
  tokens_salida     INTEGER,
  costo_estimado_clp NUMERIC(10,2),
  latencia_ms       INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analisis_ia_uso_created ON analisis_ia_uso(created_at);
