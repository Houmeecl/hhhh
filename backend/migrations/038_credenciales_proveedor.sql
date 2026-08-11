-- ============================================================
-- 038: Credencial de Firma del Proveedor — atestación con credencial
-- propia (serial+clave, patrón Tarjeta de Viaje / POS) para que el
-- eslabón 'proveedor' de un pasaporte tipo 'producto' (migración 021/023)
-- lo confirme el propio proveedor, no solo el admin a mano.
--
-- IMPORTANTE (honestidad): esto NO es una firma electrónica con validez
-- legal (Ley N° 19.799). Es una ATESTACIÓN sellada por hash dentro de la
-- cadena de custodia del lote: confirma que el titular de esta
-- credencial (identidad fijada por el emisor, NO declarada por el
-- firmante) registró este eslabón. sicr3p no certifica identidad más
-- allá de la credencial entregada.
--
-- Diferencias deliberadas con tarjetas_viaje (022):
--  · rut_empresa/nombre_empresa son NOT NULL y los fija el ADMIN al
--    emitir — no son un campo informativo, son la identidad que se
--    pasa a anexarEslabonTx (nunca el body del firmante).
--  · lote_id es NOT NULL (a diferencia de tarjetas_viaje que puede
--    quedar "en inventario"): la credencial nace atada a un lote,
--    se agota en un uso.
--  · firmado_at/eslabon_id: de UN SOLO USO. Una vez firmado, la
--    credencial queda inerte (activo puede seguir true mostrando
--    "usada", pero /firmar y /auth la rechazan igual).
-- ============================================================

CREATE TABLE IF NOT EXISTS credenciales_proveedor (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  serial         TEXT NOT NULL UNIQUE,     -- FP-XXXX (Firma Proveedor)
  lote_id        UUID NOT NULL REFERENCES lotes_minerales(id) ON DELETE CASCADE,
  rol            TEXT NOT NULL DEFAULT 'proveedor' CHECK (rol = 'proveedor'), -- fijo por ahora; ampliable a otros roles de ROLES_POR_TIPO.producto si se pide
  rut_empresa    TEXT NOT NULL,            -- identidad FIJADA por el emisor, no por el firmante
  nombre_empresa TEXT NOT NULL,
  clave_hash     TEXT NOT NULL,            -- bcrypt; la clave viaja UNA sola vez (patrón POS/tarjeta)
  activo         BOOLEAN NOT NULL DEFAULT true,
  firmado_at     TIMESTAMPTZ,              -- NULL = aún no firma; set = agotada (un solo uso)
  eslabon_id     UUID REFERENCES lote_eslabones(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_credenciales_proveedor_lote ON credenciales_proveedor (lote_id);
