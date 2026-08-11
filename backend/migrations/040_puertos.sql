-- ============================================================
-- 040: Puertos — actor externo con acceso completo (tipo mandante) al
-- tránsito del Corredor Bioceánico que pasa por su punto.
--
-- A diferencia de `mandantes` (acceso por RUT receptor sobre `facturas`,
-- contabilidad NACIONAL), un puerto no es "receptor" de ninguna factura:
-- su alcance natural es el punto físico del Corredor (`punto_id`, mismo
-- slug que usan `lote_eslabones.datos->>'punto_id'` y el catálogo
-- `PUNTOS_CORREDOR` del frontend, ej. 'puerto-antofagasta'). Por eso el
-- acceso se filtra por punto, no por RUT ni por whitelist — ver
-- backend/src/routes/puerto.js.
--
-- El acceso de ESCRITURA (sellar el paso "puerto" en un pasaporte
-- documental) usa un mecanismo distinto y ya existente: la credencial de
-- atestación de `credenciales_proveedor` (migraciones 038/039, rol
-- 'puerto') — esta tabla es solo para la API de LECTURA completa.
-- ============================================================

CREATE TABLE IF NOT EXISTS puertos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      TEXT NOT NULL,           -- "Puerto de Antofagasta"
  punto_id    TEXT NOT NULL,           -- slug del catálogo PUNTOS_CORREDOR
  token_hash  TEXT NOT NULL UNIQUE,    -- bcrypt/sha256 de la API key (mismo hashApiKey que mandantes)
  activo      BOOLEAN NOT NULL DEFAULT true,
  ultimo_uso  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_puertos_punto ON puertos (punto_id);
