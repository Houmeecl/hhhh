-- ============================================================
-- 107 — 'lanzamiento' como origen válido de un interesado.
--
-- POR QUÉ EXISTE. La portada de la cuenta regresiva manda sus leads con
-- `origen: 'lanzamiento'`. El catálogo de services/interesados.js lo
-- aceptaba, pero la 091 dejó un CHECK en la tabla que no lo conocía, así
-- que cada inscripción respondía 500. Los tests en JS pasaban —el catálogo
-- estaba bien— y el error solo aparecía contra la base real.
--
-- Es la lección de siempre: una lista de valores permitidos escrita en dos
-- lugares se separa sola. Acá se arregla el lado de la base; el día que se
-- agregue otro origen hay que tocar los dos, y por eso la migración
-- reconstruye el CHECK completo en vez de parchar el valor nuevo: así el
-- archivo dice la lista entera y se puede comparar de un vistazo con
-- ORIGENES de services/interesados.js.
--
-- IDEMPOTENTE. migrate.js no lleva registro de qué corrió: aplica TODOS
-- los .sql en cada arranque. DROP ... IF EXISTS seguido de ADD deja el
-- mismo estado se ejecute una vez o cincuenta.
-- ============================================================

ALTER TABLE interesados DROP CONSTRAINT IF EXISTS interesados_origen_check;

ALTER TABLE interesados ADD CONSTRAINT interesados_origen_check
  CHECK (origen IN (
    'calculadora',
    'corredor',
    'instituto',
    'prueba',
    'lanzamiento',
    'magic_sin_historial',
    'otro'
  ));
