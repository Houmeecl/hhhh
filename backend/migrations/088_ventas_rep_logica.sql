-- ============================================================
-- 088: lógica de integridad para ventas_rep (migración 087).
--
-- Una venta REP registrada dos veces duplica kilos en el resumen que la
-- empresa usa para su declaración RETC/SGR — el peor error posible en
-- una declaración legal. Candado en la base: una factura (por su número
-- normalizado en minúsculas y sin espacios) solo puede registrarse una
-- vez por proveedor. La ruta además compara por dígitos ("F-123" y
-- "123") para dar un 409 amable antes de chocar con este índice.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS ventas_rep_prov_numero_uq
  ON ventas_rep (proveedor_id, lower(btrim(numero_documento)));
