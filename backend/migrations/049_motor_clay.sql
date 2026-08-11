-- ============================================================
-- 049: `propio_clay` como origen de factura.
--
-- Los DTE que llegan por la API de Clay ya vienen sincronizados desde el
-- SII: son datos estructurados, no una lectura de PDF ni un OCR. Merecen
-- su propia marca en `facturas.motor` para poder distinguirlos después —
-- de dónde salió cada cifra es parte de la metodología, no un detalle.
--
-- Mismo patrón que las migraciones 017, 019 y 033: el CHECK se recrea solo
-- si su definición vigente todavía no conoce el valor nuevo, porque las
-- migraciones se re-ejecutan completas en cada arranque.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'facturas'::regclass
      AND conname = 'facturas_motor_check'
      AND pg_get_constraintdef(oid) LIKE '%propio_clay%'
  ) THEN
    ALTER TABLE facturas DROP CONSTRAINT IF EXISTS facturas_motor_check;
    ALTER TABLE facturas ADD CONSTRAINT facturas_motor_check
      CHECK (motor IN ('propio', 'propio_texto', 'propio_ocr', 'propio_ia', 'propio_clay',
                       'externo', 'revision', 'propio_revisado'));
  END IF;
END $$;

-- Evita importar dos veces el mismo documento: el id de Clay es único por
-- DTE. Parcial, porque las facturas que no vienen de Clay no lo tienen.
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS clay_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_facturas_clay ON facturas(clay_id) WHERE clay_id IS NOT NULL;
