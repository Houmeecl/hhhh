-- ============================================================
-- sicr3p — Independencia total del motor externo (adiós Simple, parte 2).
--
-- facturas.motor suma dos orígenes nuevos:
--   'revision'         → documento sin señal extraíble que quedó en la cola
--                        de revisión humana (con MOTOR_EXTERNO=off) en vez
--                        de enviarse a un motor de terceros. SIN eslabón en
--                        la cadena de hash: se encadena recién al confirmar.
--   'propio_revisado'  → documento de la cola corregido y confirmado por un
--                        operador; el cálculo lo hace el motor propio con
--                        los datos corregidos y ahí se encadena.
--
-- Mismo patrón idempotente de la migración 017: solo se re-crea el CHECK
-- si aún no admite los valores nuevos.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'facturas'::regclass
      AND conname = 'facturas_motor_check'
      AND pg_get_constraintdef(oid) LIKE '%propio_revisado%'
  ) THEN
    ALTER TABLE facturas DROP CONSTRAINT IF EXISTS facturas_motor_check;
    ALTER TABLE facturas ADD CONSTRAINT facturas_motor_check
      CHECK (motor IN ('propio', 'propio_texto', 'propio_ocr', 'externo',
                       'revision', 'propio_revisado'));
  END IF;
END $$;

-- El status 'en_revision' se suma al CHECK original de la migración 001
-- (constraint inline sin nombre → PostgreSQL lo llamó facturas_status_check).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'facturas'::regclass
      AND conname = 'facturas_status_check'
      AND pg_get_constraintdef(oid) LIKE '%en_revision%'
  ) THEN
    ALTER TABLE facturas DROP CONSTRAINT IF EXISTS facturas_status_check;
    ALTER TABLE facturas ADD CONSTRAINT facturas_status_check
      CHECK (status IN ('pendiente','procesando','procesada','error','en_revision'));
  END IF;
END $$;

-- Búsqueda rápida de la cola de revisión en el panel.
CREATE INDEX IF NOT EXISTS idx_facturas_motor_revision
  ON facturas(motor) WHERE motor = 'revision';

-- Archivo original y texto parcial de los documentos EN revisión. Es una
-- tabla efímera a propósito: la fila se borra al confirmar la revisión
-- (el archivo del cliente no se retiene más allá de lo necesario) y cae
-- en cascada si la factura se elimina.
CREATE TABLE IF NOT EXISTS facturas_revision (
  factura_id     UUID PRIMARY KEY REFERENCES facturas(id) ON DELETE CASCADE,
  archivo        BYTEA NOT NULL,
  mime           TEXT,
  texto_extraido TEXT,           -- lo poco que el motor alcanzó a leer (puede ser NULL)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
