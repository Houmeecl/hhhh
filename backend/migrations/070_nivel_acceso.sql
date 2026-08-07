-- ============================================================
-- Nivel de acceso dentro de un panel externo (puerto/mandante/agencia/
-- trazador/proveedor), separado a propósito de `rol` — ese campo ya
-- tiene semántica fija ('admin'/'operador'/'cliente') consumida por
-- requireRole() en sicrep/aduana_verde; mezclarla acá sería confuso.
--
-- Default 'operador' para no quitarle capacidades a ninguna cuenta ya
-- creada (todas hoy tienen acceso completo a lo que su panel expone).
-- 'lectura' es el único nivel restringido: hoy solo tiene efecto en
-- las 2 mutaciones que existen fuera de sicrep/aduana_verde (subir
-- documento en agencia, firmar lote en proveedor) — puerto, mandante
-- y trazador son 100% lectura hoy, así que el campo queda listo para
-- cuando ganen una acción de escritura, sin romper nada mientras tanto.
-- ============================================================

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS nivel_acceso TEXT NOT NULL DEFAULT 'operador';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'usuarios_nivel_acceso_check' AND conrelid = 'usuarios'::regclass
  ) THEN
    ALTER TABLE usuarios ADD CONSTRAINT usuarios_nivel_acceso_check CHECK (nivel_acceso IN ('lectura','operador'));
  END IF;
END $$;
