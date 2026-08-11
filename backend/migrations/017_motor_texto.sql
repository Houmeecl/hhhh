-- ============================================================
-- sicr3p — Motor propio sobre TODOS los formatos (ciclo "adiós Simple").
--
-- 1) Clasificación GHG Protocol por categoría del motor (alcance_ghg):
--    texto editable por el admin; el informe la cita tal cual. Los UPDATE
--    del seed solo corren si el valor está NULL, para no pisar ediciones.
-- 2) La columna facturas.motor ahora distingue el origen del cálculo:
--      'propio'        → DTE XML con ítems reales (cantidad/unidad/monto)
--      'propio_texto'  → PDF con capa de texto (pdf-parse + parser propio)
--      'propio_ocr'    → imagen JPG/PNG vía OCR (tesseract) + parser propio
--      'externo'       → motor externo (mock o real)
--    El CHECK original de la migración 010 fue inline y sin nombre, por lo
--    que PostgreSQL le asignó el nombre autogenerado estándar
--    "facturas_motor_check"; se re-crea aquí con nombre explícito.
-- ============================================================

ALTER TABLE motor_categorias ADD COLUMN IF NOT EXISTS alcance_ghg TEXT;

UPDATE motor_categorias SET alcance_ghg = 'Alcance 2 — electricidad comprada'
  WHERE codigo = 'electricidad' AND alcance_ghg IS NULL;
UPDATE motor_categorias SET alcance_ghg = 'Alcance 1 — combustión propia (referencial)'
  WHERE codigo = 'combustible' AND alcance_ghg IS NULL;
UPDATE motor_categorias SET alcance_ghg = 'Alcance 3 · Cat. 4 — transporte y distribución'
  WHERE codigo = 'transporte' AND alcance_ghg IS NULL;
UPDATE motor_categorias SET alcance_ghg = 'Alcance 3 · Cat. 1 — bienes adquiridos'
  WHERE codigo = 'materiales' AND alcance_ghg IS NULL;
UPDATE motor_categorias SET alcance_ghg = 'Alcance 3 · Cat. 1 — bienes adquiridos'
  WHERE codigo = 'agua' AND alcance_ghg IS NULL;
UPDATE motor_categorias SET alcance_ghg = 'Alcance 3 · Cat. 1 — servicios adquiridos'
  WHERE codigo = 'servicios' AND alcance_ghg IS NULL;

-- Extiende el CHECK de facturas.motor a los cuatro orígenes.
-- Solo re-crea el constraint si aún no admite los valores nuevos, para que
-- los arranques siguientes no re-validen toda la tabla (idempotente real).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'facturas'::regclass
      AND conname = 'facturas_motor_check'
      AND pg_get_constraintdef(oid) LIKE '%propio_texto%'
  ) THEN
    ALTER TABLE facturas DROP CONSTRAINT IF EXISTS facturas_motor_check;
    ALTER TABLE facturas ADD CONSTRAINT facturas_motor_check
      CHECK (motor IN ('propio', 'propio_texto', 'propio_ocr', 'externo'));
  END IF;
END $$;
