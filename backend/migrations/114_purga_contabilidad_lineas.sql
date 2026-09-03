-- Permite que una purga administrativa controlada elimine primero las líneas
-- asociadas a una cuenta cuando se borra la empresa completa. La aplicación no
-- expone DELETE de cuentas ni de asientos; la inmutabilidad del libro se
-- mantiene para toda operación normal.
ALTER TABLE contabilidad_lineas DROP CONSTRAINT IF EXISTS contabilidad_lineas_cuenta_id_fkey;
ALTER TABLE contabilidad_lineas
  ADD CONSTRAINT contabilidad_lineas_cuenta_id_fkey
  FOREIGN KEY (cuenta_id) REFERENCES contabilidad_cuentas(id) ON DELETE CASCADE;
