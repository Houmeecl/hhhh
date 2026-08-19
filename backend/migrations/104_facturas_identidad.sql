-- ============================================================
-- Identidad del documento: que la misma factura no entre dos veces.
--
-- EL BUG QUE CIERRA. `routes/public.js` calculaba el SHA-256 de cada
-- archivo subido y lo guardaba... y NUNCA lo consultaba. El único índice
-- único de `facturas` era `uq_facturas_clay` (migración 049), que solo
-- cubre el motor externo Clay.
--
-- Consecuencia real: subir el mismo PDF dos veces creaba dos facturas,
-- DOS ESLABONES en la cadena de hash, dos cargos en Capital Natural y
-- doblaba el CO2e del cliente. Una huella inflada, y sellada — que es lo
-- peor, porque el sello la vuelve difícil de corregir.
--
-- Detalle que lo delata: `ventas_rep` (migración 088) SÍ tiene un UNIQUE
-- por número de documento. La Ley REP estaba mejor protegida contra
-- duplicados que las facturas que alimentan toda la contabilidad.
--
-- DOS DEFENSAS, PORQUE CUBREN COSAS DISTINTAS:
--
--  1. `sha256` — el mismo ARCHIVO, byte por byte. Atrapa el caso común:
--     alguien vuelve a subir el mismo adjunto. No atrapa el mismo
--     documento re-escaneado (otro binario, mismo contenido).
--
--  2. `(rut_emisor, tipo_dte, folio)` — el mismo DOCUMENTO TRIBUTARIO,
--     venga como venga. El folio es correlativo POR EMISOR y POR TIPO,
--     así que los tres campos juntos son la identidad real de un DTE en
--     Chile — el mismo criterio que ya usa `dte_proveedor` (migración
--     071) y la conciliación entre proveedores.
--
-- POR QUÉ LOS ÍNDICES NO SON ÚNICOS, AUNQUE LA REGLA SÍ LO ES.
--
-- La primera versión de esta migración los creaba UNIQUE. Falló al
-- aplicarse, y falló por la mejor de las razones: **ya había duplicados
-- en la base**. El propio intento fue la prueba de que el bug había
-- mordido de verdad.
--
-- Y ahí está el peligro: `lib/migrate.js` corre las migraciones AL
-- ARRANCAR, y un error aborta el arranque. Un índice único acá no habría
-- protegido nada — habría dejado producción sin backend, que es
-- exactamente el modo de falla del que este proyecto acaba de salir.
--
-- Así que la unicidad se hace cumplir en la APLICACIÓN (routes/public.js
-- rechaza el duplicado antes de insertarlo) y estos índices existen para
-- que esa consulta sea barata. Es una defensa más débil que un constraint
-- —una escritura por otra vía podría saltársela— pero es la única que se
-- puede desplegar sin tumbar nada.
--
-- PARA PROMOVERLOS A ÚNICOS, cuando la base esté limpia:
--   1. `node backend/scripts/duplicados.mjs` lista lo que hay y su impacto.
--   2. Resolver esos casos (decisión humana: están encadenados por hash).
--   3. Recién ahí, una migración nueva con CREATE UNIQUE INDEX.
-- No lo automatizo: borrar una factura sellada no es algo que deba pasar
-- dentro de un arranque de servidor.
--
-- PARCIALES los dos, además: lo histórico no tiene `folio` ni `tipo_dte`
-- (nunca se guardaron), y un documento leído por OCR puede no tener
-- emisor detectable. Se protege lo que se puede identificar con certeza.
--
-- IDEMPOTENCIA: `IF NOT EXISTS` en todo y ni un solo UPDATE de backfill.
-- ============================================================

-- El parser ya extrae ambos del XML (`services/dte.js`); hasta ahora se
-- perdían: solo sobrevivía `numero_venta` como texto ('F-1234'), del que
-- no se puede recuperar el tipo ni comparar de forma fiable.
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS tipo_dte SMALLINT;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS folio    TEXT;

COMMENT ON COLUMN facturas.tipo_dte IS
  'Tipo de DTE del SII (33 factura afecta, 34 exenta, 39 boleta, 61 NC…). NULL en documentos leídos por OCR o anteriores a la migración 104.';
COMMENT ON COLUMN facturas.folio IS
  'Folio del DTE, correlativo por emisor y tipo. Junto a rut_emisor y tipo_dte identifica un documento tributario de forma única en Chile.';

-- Mismo archivo, byte por byte. Atrapa el caso común: alguien vuelve a
-- subir el mismo adjunto.
CREATE INDEX IF NOT EXISTS idx_facturas_sha256
  ON facturas (sha256) WHERE sha256 IS NOT NULL;

-- Mismo documento tributario, aunque el archivo sea otro (re-escaneado,
-- convertido a PDF, bajado del SII).
CREATE INDEX IF NOT EXISTS idx_facturas_dte
  ON facturas (rut_emisor, tipo_dte, folio)
  WHERE rut_emisor IS NOT NULL AND tipo_dte IS NOT NULL AND folio IS NOT NULL;

-- ---------- El motivo de rechazo nuevo ----------
--
-- `documentos_rechazados` lleva la bitácora de lo que NO entró y por qué.
-- Un duplicado tiene que quedar ahí como cualquier otro rechazo: si no,
-- el cliente ve que su documento no aparece y no hay dónde mirar la razón.
--
-- Mismo patrón idempotente de las migraciones 032 y 086: solo re-crea el
-- CHECK si todavía no admite el valor nuevo.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'documentos_rechazados'::regclass
       AND conname = 'documentos_rechazados_motivo_check'
       AND pg_get_constraintdef(oid) NOT LIKE '%duplicado%'
  ) THEN
    ALTER TABLE documentos_rechazados DROP CONSTRAINT documentos_rechazados_motivo_check;
    ALTER TABLE documentos_rechazados ADD CONSTRAINT documentos_rechazados_motivo_check
      CHECK (motivo IN ('sin_senal', 'formato_no_permitido', 'monto_fuera_de_rango',
                        'tipo_documento_no_calculable', 'rut_no_calza', 'duplicado'));
  END IF;
END $$;
