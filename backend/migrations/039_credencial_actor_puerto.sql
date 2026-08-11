-- ============================================================
-- 039: Generaliza la Credencial de Firma (migración 038, antes solo
-- rol 'proveedor') para admitir también el rol 'puerto' — el operador
-- de un punto del Corredor (ej. Puerto Antofagasta/Mejillones) sella su
-- propio paso en un pasaporte tipo 'documental', con el mismo mecanismo
-- de atestación (serial+clave, identidad fijada por el emisor, un solo
-- uso). Sigue sin ser una firma electrónica con validez legal
-- (Ley N° 19.799) — ver disclaimer en pdf.js/generateCredencialProveedor.
--
-- El default 'proveedor' se mantiene por compatibilidad: emitir sin
-- indicar rol sigue comportándose igual que antes de esta migración.
-- ============================================================

ALTER TABLE credenciales_proveedor DROP CONSTRAINT IF EXISTS credenciales_proveedor_rol_check;
ALTER TABLE credenciales_proveedor ADD CONSTRAINT credenciales_proveedor_rol_check
  CHECK (rol IN ('proveedor', 'puerto'));
