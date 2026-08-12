-- ============================================================
-- 095: persistencia de la foto de embalaje como evidencia REP.
--
-- Hasta ahora POST /panel-proveedor/rep/estimar-embalaje (migración de
-- REP-foto, ver routes/repProveedor.js) analizaba la foto EN MEMORIA con
-- IA y la descartaba de inmediato — solo devolvía los componentes
-- propuestos, nunca guardaba la foto (mismo patrón que juego.js). El
-- productor la revisaba/ajustaba y esos componentes quedaban en
-- `productos_proveedor.componentes`, sin ningún rastro de la foto que
-- los originó.
--
-- Ahora la persona puede elegir GUARDAR esa foto como evidencia del
-- envase declarado (checkbox en el frontend, default activado): se sube
-- junto con el producto (POST/PUT .../productos, ahora también aceptan
-- multipart con un campo `foto` opcional) y queda adjunta al producto,
-- no a la estimación — el mismo criterio que ventas_rep.archivo: BYTEA
-- SIN comprimir ("tal como se subió"), porque es evidencia que se puede
-- necesitar mostrar/descargar intacta, no un respaldo masivo como los
-- PDF de facturas (migración 094, ahí sí gzip).
-- ============================================================

ALTER TABLE productos_proveedor ADD COLUMN IF NOT EXISTS foto_embalaje BYTEA;
ALTER TABLE productos_proveedor ADD COLUMN IF NOT EXISTS foto_extension TEXT;
ALTER TABLE productos_proveedor ADD COLUMN IF NOT EXISTS foto_tamano_bytes INTEGER;
ALTER TABLE productos_proveedor ADD COLUMN IF NOT EXISTS foto_sha256 TEXT;
