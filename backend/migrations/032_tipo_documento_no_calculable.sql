-- ============================================================
-- Rechazo explícito de tipos de DTE que NO son un gasto directo
-- calculable como factura nueva.
--
-- Hallazgo de auditoría: el motor nunca leía `tipo_dte` (dte.js lo
-- parsea pero ningún otro archivo lo consultaba) — una Nota de Crédito
-- (61) o Nota de Débito (56) que modifica/reversa una factura anterior
-- se procesaba igual que una factura nueva, SUMANDO su monto como CO2e
-- positivo en vez de restarlo o ignorarlo: doble conteo real. Una Guía
-- de Despacho (52) o Liquidación de Factura (43) tampoco son un gasto
-- en sí. Netear NC/ND contra su factura original queda para otra ronda
-- (requiere localizar el documento original) — hoy, en vez de adivinar,
-- se rechaza con un motivo explícito: mismo principio de "documento sin
-- señal calculable = rechazo, jamás un número inventado".
--
-- Idempotente: mismo patrón de la migración 019 (solo re-crea el CHECK
-- si aún no admite el valor nuevo).
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'documentos_rechazados'::regclass
      AND conname = 'documentos_rechazados_motivo_check'
      AND pg_get_constraintdef(oid) LIKE '%tipo_documento_no_calculable%'
  ) THEN
    ALTER TABLE documentos_rechazados DROP CONSTRAINT IF EXISTS documentos_rechazados_motivo_check;
    ALTER TABLE documentos_rechazados ADD CONSTRAINT documentos_rechazados_motivo_check
      CHECK (motivo IN ('sin_senal', 'formato_no_permitido', 'monto_fuera_de_rango', 'tipo_documento_no_calculable'));
  END IF;
END $$;
