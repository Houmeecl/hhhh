-- ============================================================
-- sicr3p — Limpieza de datos de demostración en producción.
-- Borra los clientes y prospectos FICTICIOS que sembraba el seed
-- antiguo. No toca sesiones, facturas ni datos reales.
-- Uso en el VPS:
--   sudo -u postgres psql -d sicr3p -f deploy/limpiar-demo.sql
-- ============================================================

DELETE FROM prospectos
 WHERE rut IN ('79.111.222-2', '80.444.555-2')
   AND nombre_empresa IN ('Cobre Andino SpA', 'Logística Pampa Ltda');

DELETE FROM clientes
 WHERE rut IN ('76.123.456-0', '77.987.654-3', '78.222.333-K')
   AND nombre_empresa IN ('Minera del Norte SpA', 'Áridos Antofagasta Ltda', 'Transportes Atacama SA');
