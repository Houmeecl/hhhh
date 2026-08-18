-- ============================================================
-- Distinguir una clave EMITIDA de una clave ENTREGADA.
--
-- EL PROBLEMA QUE ARREGLA, Y QUE ESTÁ VIVO EN PRODUCCIÓN AHORA.
--
-- Durante un tiempo la clave de informes se creaba SOLA al mandar un
-- archivo, y salvo en el flujo de cobros la empresa nunca la recibía por
-- ningún canal. Quedaron filas con `clave_informe` puesta que nadie vio
-- jamás — claves fantasma. Como el código LEE la clave que haya, esas
-- fantasma se siguen usando para cifrar: esas empresas siguen recibiendo
-- PDF que no pueden abrir.
--
-- Y el panel las escondía: mostraba `clave_informe IS NOT NULL` con un
-- badge verde que decía "Clave entregada". O sea que el estado roto se
-- veía idéntico al estado sano.
--
-- La columna nueva parte la diferencia en dos. A partir de acá, una clave
-- sin `clave_informe_entregada_at` se trata como si no existiera: el
-- archivo sale en claro y el acuse lo anota. Una clave que nadie recibió
-- es, a todos los efectos, lo mismo que no tener clave — y un archivo
-- ilegible no protege nada, solo se pierde.
--
-- SIN BACKFILL, A PROPÓSITO.
--
-- No hay forma fiable de reconstruir a quién sí se le entregó:
--   · `correos_enviados` guarda `cobros.id` para 'credenciales' y el id de
--     la entidad para 'clave_informe', sin decir de qué tabla; una fila
--     ok=true no prueba que el correo llevara la clave adentro; y se purga
--     a los 365 días (services/retencion.js).
--   · `cobros.entregado_at` es más fiable, pero los cobros entregados
--     ANTES de que la plantilla de credenciales incluyera la clave
--     salieron sin ella.
--
-- Así que todas las filas quedan en NULL = "no consta entrega", que es la
-- verdad. Errar hacia "no entregada" cuesta un correo redundante y que un
-- informe salga en claro; errar hacia "entregada" es volver a tener el
-- bug. La dirección segura es evidente.
--
-- Y entregar una clave fantasma manda LA MISMA clave (emitir es
-- idempotente), así que los PDF que esa empresa ya recibió pasan a poder
-- abrirse. La remediación rescata lo ya enviado.
--
-- IDEMPOTENCIA OBLIGATORIA: lib/migrate.js no lleva registro de qué se
-- aplicó — lee todos los .sql y los corre EN CADA ARRANQUE. Por eso acá
-- solo hay `ADD COLUMN IF NOT EXISTS` y ni un solo UPDATE: un backfill sin
-- guard se re-ejecutaría en cada reinicio y pisaría las entregas reales.
-- ============================================================

ALTER TABLE proveedores     ADD COLUMN IF NOT EXISTS clave_informe_entregada_at TIMESTAMPTZ;
ALTER TABLE codigos_acceso  ADD COLUMN IF NOT EXISTS clave_informe_entregada_at TIMESTAMPTZ;

COMMENT ON COLUMN proveedores.clave_informe_entregada_at IS
  'Cuándo se le entregó la clave de informes a esta empresa (correo del panel, o correo de credenciales de un cobro pagado). NULL = no consta entrega: los archivos salen SIN cifrar hasta que se le entregue.';

COMMENT ON COLUMN codigos_acceso.clave_informe_entregada_at IS
  'Cuándo se le entregó la clave de informes al titular de este código. NULL = no consta entrega: los informes salen SIN cifrar hasta que se le entregue.';

-- Para la lista de trabajo del panel: las que tienen clave y no consta que
-- se haya entregado. Parcial porque es exactamente el subconjunto que se
-- consulta, y en régimen normal debería tender a vacío.
CREATE INDEX IF NOT EXISTS idx_proveedores_clave_sin_entregar
  ON proveedores (id) WHERE clave_informe IS NOT NULL AND clave_informe_entregada_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_codigos_clave_sin_entregar
  ON codigos_acceso (id) WHERE clave_informe IS NOT NULL AND clave_informe_entregada_at IS NULL;
