-- ============================================================
-- 041: punto_id en credenciales_proveedor — solo relevante para rol
-- 'puerto' (migración 039). Mismo principio que rut_empresa/nombre_empresa:
-- la identidad Y la ubicación las fija el EMISOR (admin) al crear la
-- credencial, nunca el firmante — así el eslabón 'puerto' que se sella
-- al firmar queda con el punto_id correcto para que el actor Puerto
-- (migración 040, routes/puerto.js) pueda encontrarlo por su propio punto.
-- ============================================================

ALTER TABLE credenciales_proveedor ADD COLUMN IF NOT EXISTS punto_id TEXT;
