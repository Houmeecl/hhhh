-- ============================================================
-- 044: identidad de vehículo/conductor en la Tarjeta de Viaje.
-- Ningún concepto de camión/remolque/conductor existía en el proyecto
-- (confirmado por grep: cero coincidencias antes de esta migración).
-- Se agrega a tarjetas_viaje (no una tabla `vehiculos` normalizada):
-- "un camión = una tarjeta" ya es el patrón vigente; varios camiones en
-- un mismo embarque son varias tarjetas. Todo opcional — nunca bloquea
-- emitir una tarjeta sin estos datos.
-- ============================================================

ALTER TABLE tarjetas_viaje ADD COLUMN IF NOT EXISTS placa_tracto TEXT;
ALTER TABLE tarjetas_viaje ADD COLUMN IF NOT EXISTS placa_semirremolque TEXT;
ALTER TABLE tarjetas_viaje ADD COLUMN IF NOT EXISTS conductor_nombre TEXT;
ALTER TABLE tarjetas_viaje ADD COLUMN IF NOT EXISTS conductor_documento TEXT;
