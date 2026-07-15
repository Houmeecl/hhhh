-- ============================================================
-- sicr3p — Valorización automática del Capital Natural.
-- Agrega un precio unitario (opcional, editable) por cuenta ambiental
-- para calcular valor_clp de los activos automáticamente cuando no se
-- ingresa un valor manual. Sin seed: no se inventan precios sombra/ESVD
-- sin fuente verificable — el admin los carga con su propia cita.
-- ============================================================

ALTER TABLE cuentas_naturales ADD COLUMN IF NOT EXISTS precio_clp_unidad NUMERIC(14,4);
ALTER TABLE cuentas_naturales ADD COLUMN IF NOT EXISTS precio_fuente TEXT;
