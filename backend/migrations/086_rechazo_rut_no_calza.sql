-- ============================================================
-- Rechazo explícito de documentos emitidos a OTRO RUT que el del
-- titular del envío.
--
-- Reporte del usuario: "si subo factura con otro rut al ingresado,
-- la asimila". Verificado: POST /api/sesiones jamás comparaba el
-- rut_receptor del documento con el rut_cliente del formulario — un
-- documento ajeno se insertaba igual y contaminaba el total de la
-- sesión, la cadena de hash, Capital Natural, el inventario (indexado
-- además por el RUT del formulario), BigQuery, el informe y el webhook
-- del mandante.
--
-- Ahora el pre-pass de la carga rechaza SOLO el documento culpable
-- (los demás archivos del envío siguen su curso): si el documento trae
-- un rut_receptor propio que pasa módulo 11 y NO calza con el RUT del
-- formulario, se registra acá con motivo 'rut_no_calza' y no entra al
-- inventario del titular. Documentos sin receptor detectable o con
-- receptor ilegible (basura de OCR) NO se rechazan por esta regla:
-- beneficio de la duda, como siempre.
--
-- Idempotente: mismo patrón de la migración 032 (solo re-crea el CHECK
-- si aún no admite el valor nuevo).
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'documentos_rechazados'::regclass
      AND conname = 'documentos_rechazados_motivo_check'
      AND pg_get_constraintdef(oid) LIKE '%rut_no_calza%'
  ) THEN
    ALTER TABLE documentos_rechazados DROP CONSTRAINT IF EXISTS documentos_rechazados_motivo_check;
    ALTER TABLE documentos_rechazados ADD CONSTRAINT documentos_rechazados_motivo_check
      CHECK (motivo IN ('sin_senal', 'formato_no_permitido', 'monto_fuera_de_rango', 'tipo_documento_no_calculable', 'rut_no_calza'));
  END IF;
END $$;
