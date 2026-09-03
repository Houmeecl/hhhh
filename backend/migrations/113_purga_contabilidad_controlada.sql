-- Los asientos no se pueden actualizar ni borrar desde la aplicación.
-- Una purga de retención/prueba requiere marcar la transacción explícitamente
-- desde una conexión administrativa; esto permite limpiar datos de ensayo sin
-- convertir DELETE en una operación disponible para la interfaz.
CREATE OR REPLACE FUNCTION bloquear_mutacion_contable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('sicr3p.permitir_purga_contable', true) = 'si' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Los asientos financieros registrados son inmutables; registra un asiento de reversa.';
END;
$$ LANGUAGE plpgsql;
