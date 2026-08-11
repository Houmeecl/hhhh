-- ============================================================
-- sicr3p — Transporte de personal (Cat. 7) desde el panel proveedor.
--
-- Hasta ahora esta categoría era 100% operada por el admin de sicrep a
-- mano (routes/transporte.js, requireHomePanel('sicrep')), sin acceso
-- del proveedor y sin evidencia adjunta. La empresa podrá registrar sus
-- propios traslados (mismos modos y factores DEFRA ya vigentes en
-- transporte_modos, sin tocarlos) y adjuntar el comprobante como
-- evidencia — mismo patrón que Ley REP (migración 087: proveedor_id +
-- archivo/archivo_nombre/extension/tamano_bytes/sha256), pero acá TODO
-- nullable: a diferencia de REP, la evidencia es opcional (el dato
-- central es el km declarado, no el documento) y las filas ya
-- existentes del admin no tienen ni proveedor_id ni archivo.
-- ============================================================

ALTER TABLE transporte_viajes ADD COLUMN IF NOT EXISTS proveedor_id UUID REFERENCES proveedores(id) ON DELETE CASCADE;
ALTER TABLE transporte_viajes ADD COLUMN IF NOT EXISTS archivo BYTEA;
ALTER TABLE transporte_viajes ADD COLUMN IF NOT EXISTS archivo_nombre TEXT;
ALTER TABLE transporte_viajes ADD COLUMN IF NOT EXISTS extension TEXT;
ALTER TABLE transporte_viajes ADD COLUMN IF NOT EXISTS tamano_bytes INTEGER;
ALTER TABLE transporte_viajes ADD COLUMN IF NOT EXISTS sha256 TEXT;

CREATE INDEX IF NOT EXISTS idx_transporte_viajes_proveedor ON transporte_viajes(proveedor_id);
