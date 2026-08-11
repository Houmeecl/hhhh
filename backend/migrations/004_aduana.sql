-- ============================================================
-- sicr3p — Corredor Bioceánico: documentos aduaneros reales
-- Declaraciones de aduana de cada país y MIC/DTA (tránsito ATIT)
-- entran como TRAZA documental del tránsito. Sin cálculo de carbono
-- y sin "aduana verde" (excluida por decisión de alcance).
-- ============================================================

ALTER TABLE documentos_corredor DROP CONSTRAINT IF EXISTS documentos_corredor_tipo_documento_check;
ALTER TABLE documentos_corredor ADD CONSTRAINT documentos_corredor_tipo_documento_check
  CHECK (tipo_documento IN ('factura','guia','manifiesto','energia','combustible','contrato','aduana','mic_dta','otro'));

-- Número/referencia del documento (p.ej. N° DIN, N° MIC/DTA, N° DU-E).
ALTER TABLE documentos_corredor ADD COLUMN IF NOT EXISTS numero_documento TEXT;
