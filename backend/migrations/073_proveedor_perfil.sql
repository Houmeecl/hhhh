-- ============================================================
-- 073: datos de la empresa que ella misma completa en su onboarding.
--
-- El flujo es autoservicio: al crear su acceso web se le envía un correo
-- (enviarActivacion); la empresa entra por el enlace, define su clave y
-- COMPLETA SUS DATOS + conecta el SII desde su propio panel — sin que el
-- admin tenga que llenar nada. Antes `proveedores` solo tenía
-- nombre_empresa/rut; acá se agregan los campos del formulario de
-- onboarding, todos opcionales, y una marca de cuándo lo completó.
-- ============================================================

ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS giro          TEXT;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS direccion     TEXT;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS telefono      TEXT;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS representante TEXT;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS cargo         TEXT;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS contacto_email TEXT;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS onboarding_completado_at TIMESTAMPTZ;
