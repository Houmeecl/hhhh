-- ============================================================
-- sicr3p — API para mandantes v2: permisos finos por proveedor
-- y webhooks salientes.
--
-- mandante_proveedores es una LISTA BLANCA opcional: si un mandante
-- no tiene ninguna fila aquí, se mantiene el comportamiento actual
-- (ve todos los proveedores que le facturaron, sin cambios). Si tiene
-- al menos una fila activa, queda restringido a esos RUT proveedor.
-- ============================================================

CREATE TABLE IF NOT EXISTS mandante_proveedores (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mandante_id   UUID NOT NULL REFERENCES mandantes(id) ON DELETE CASCADE,
  rut_proveedor TEXT NOT NULL,   -- normalizado: sin puntos/guión, K en mayúscula
  activo        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (mandante_id, rut_proveedor)
);
CREATE INDEX IF NOT EXISTS idx_mandante_proveedores_mandante ON mandante_proveedores(mandante_id);

-- URL donde se notifica (POST) cada sesión nueva del mandante. Opcional.
ALTER TABLE mandantes ADD COLUMN IF NOT EXISTS webhook_url TEXT;
