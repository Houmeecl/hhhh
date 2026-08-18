-- ============================================================
-- La clave de informe deja de colgar solo de `proveedores`.
--
-- QUÉ ESTABA MAL. La migración 101 puso `clave_informe` en `proveedores`
-- y con eso el comprobante de transporte empezó a salir cifrado. Pero el
-- INFORME CONSOLIDADO —el activo de verdad, el que se vende— seguía
-- saliendo en claro, porque nace en un camino distinto:
--
--   · comprobante de transporte → panel de un proveedor logueado, hay
--     `proveedor_id` y por lo tanto hay a quién pedirle la clave;
--   · informe consolidado → `POST /api/sesiones`, flujo PÚBLICO, donde
--     quien sube documentos se identifica con un CÓDIGO DE ACCESO y no
--     existe ningún `proveedor_id`.
--
-- No faltaba pasar un parámetro: faltaba la entidad de la que sacarlo.
--
-- POR QUÉ ACÁ Y NO EN OTRA TABLA. El código de acceso ES la identidad del
-- comprador en ese flujo — es lo que se le vende, lo que consume créditos
-- y lo que el módulo de cobros emite por empresa que paga (migración 100,
-- `cobros.codigo_id`). Colgar la clave del código no es una solución de
-- conveniencia: es el mismo sujeto al que se le entrega el informe.
-- ============================================================

-- Mismo criterio que `proveedores.clave_informe` (migración 101), y por
-- las mismas razones: cifrada en reposo con SII_CRED_KEY (AES-256-GCM,
-- llave solo en env), NULLABLE porque se crea sola en la primera entrega
-- —un código que nunca recibió un informe no necesita una clave dando
-- vueltas— y NO es un hash: es un secreto recuperable, y tiene que serlo
-- para poder dictárselo al cliente por teléfono.
ALTER TABLE codigos_acceso ADD COLUMN IF NOT EXISTS clave_informe TEXT;

COMMENT ON COLUMN codigos_acceso.clave_informe IS
  'Contraseña del PDF de informe de este código, cifrada en reposo con SII_CRED_KEY. Viaja en el correo de credenciales (que no lleva adjunto) y JAMÁS en el mismo correo que el informe.';

-- El acuse tiene que poder decir QUÉ LLAVE abre el archivo que anotó.
--
-- `entregas` (migración 101) solo apuntaba a `proveedores`. Con dos
-- entidades portando clave, una fila con `proveedor_id NULL` y
-- `cifrado = true` sería un acuse que no sabe responder "¿con qué se abre
-- esto?" — justo la pregunta para la que la tabla existe.
--
-- ON DELETE SET NULL igual que `proveedor_id`: el acuse sobrevive al
-- borrado de la entidad; queda el hash, los bytes y el destinatario.
ALTER TABLE entregas ADD COLUMN IF NOT EXISTS codigo_id UUID REFERENCES codigos_acceso(id) ON DELETE SET NULL;

COMMENT ON COLUMN entregas.codigo_id IS
  'Código de acceso cuya clave cifra este archivo, cuando la entrega salió del flujo público de sesiones. Excluyente con proveedor_id en la práctica: cada entrega tiene UNA entidad de la que salió la clave.';

CREATE INDEX IF NOT EXISTS idx_entregas_codigo ON entregas (codigo_id, created_at DESC);
