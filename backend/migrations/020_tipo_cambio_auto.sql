-- 020: dólar automático (opt-in del admin).
-- tipo_cambio_auto = true → el backend consulta el dólar observado del
-- Banco Central de Chile (API pública de mindicador.cl) al arrancar y
-- cada 6 horas, y escribe tipo_cambio_usd_clp él mismo. En false
-- (default) todo queda exactamente como antes: valor fijado a mano.
-- tipo_cambio_fuente / tipo_cambio_actualizado dan trazabilidad al dólar
-- vigente, separada de `fuente` (que documenta la TARIFA, no el dólar).
ALTER TABLE config_pos ADD COLUMN IF NOT EXISTS tipo_cambio_auto BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE config_pos ADD COLUMN IF NOT EXISTS tipo_cambio_fuente TEXT NULL;
ALTER TABLE config_pos ADD COLUMN IF NOT EXISTS tipo_cambio_actualizado TIMESTAMPTZ NULL;
