-- ============================================================
-- 094: persistencia del archivo original de cada factura.
--
-- Hasta ahora el flujo público /cargar solo guardaba el NOMBRE del
-- archivo (archivo_original TEXT, migración 001) — el binario vivía en
-- memoria durante la petición y se descartaba al responder (ver
-- comentario histórico en routes/public.js: "solo guardamos el nombre
-- original, no el binario"). Para backup/compliance ahora se retiene el
-- binario también, comprimido con gzip (los PDF de factura son
-- altamente compresibles — texto e imágenes ya comprimidas rinden poco,
-- pero el caso común de PDF con texto sí baja bastante). Nullable:
-- facturas ya existentes (y el motor externo simpleApi, que hoy no pasa
-- el buffer hasta acá) no tienen archivo_binario retroactivo.
--
-- Mismo patrón de columnas que transporte_viajes (migración 090) y
-- lote_documentos (migración 043): extension + tamano_bytes + sha256
-- para poder decidir el Content-Type en la descarga y verificar
-- integridad sin descomprimir. `tamano_bytes` es el tamaño ORIGINAL (sin
-- comprimir) — el que le importa a quien decide si algo pesa demasiado,
-- no el tamaño en disco.
-- ============================================================

ALTER TABLE facturas ADD COLUMN IF NOT EXISTS archivo_binario BYTEA;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS extension TEXT;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS tamano_bytes INTEGER;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS sha256 TEXT;

-- OJO: facturas_vigentes (migración 079) NO se toca acá a propósito. Este
-- repo no lleva tabla de migraciones aplicadas (runMigrations() re-ejecuta
-- TODOS los .sql en cada arranque de test, ver src/lib/migrate.js) y varios
-- procesos de test corren en paralelo contra la misma BD — un segundo
-- CREATE OR REPLACE VIEW acá competiría con el de 079 sin ningún lock: si
-- 079 llegara a re-ejecutarse DESPUÉS de que este archivo ya corrió en otro
-- proceso, Postgres lo rechaza (42P16, "cannot drop columns from view").
-- routes/cliente.js resuelve `tamano_bytes` con un JOIN aparte contra
-- `facturas` en vez de pedírselo a la vista.
