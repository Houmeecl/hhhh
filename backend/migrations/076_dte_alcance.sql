-- ============================================================
-- 076: clasificación por alcance GHG de los documentos del RCV.
--
-- El motor YA calculaba la categoría de cada documento de compra
-- (motorPropio.calcularFactura) y `descargarYCalcular` la descartaba: solo
-- guardaba `co2e` y `metodo` (migración 072). Como `motor_categorias` ya
-- trae `alcance_ghg` (migración 017), guardar el código de categoría es lo
-- único que faltaba para desglosar las emisiones por alcance 1/2/3 — no
-- hay cálculo nuevo, solo dejar de botar lo que ya se calcula.
--
-- `categoria` va SIN llave foránea a motor_categorias(codigo) a propósito:
-- la migración 075 desactivó la categoría `transporte` sin borrar el
-- histórico, y una FK ataría los documentos ya calculados a la vida del
-- catálogo. Se guarda el código y el alcance se resuelve por JOIN al leer.
--
-- `alcance_ghg` NO se denormaliza acá. Es una decisión ya tomada y escrita
-- en services/alcanceGhg.js: el campo es texto libre editable desde el
-- panel, así que una columna derivada persistida podría desincronizarse sin
-- que nada la vuelva a derivar.
--
-- `motor_version_id` es lo que hace honesta la cita metodológica. Hasta
-- ahora el análisis informaba la versión VIGENTE AL LEER (versionVigente()),
-- no la que se usó al calcular: citar esa versión era peor que no citar
-- ninguna. `facturas` ya estampa la versión desde la migración 056; el RCV
-- del proveedor la necesitaba por el mismo motivo, y además permite
-- resolver el alcance contra el snapshot congelado motor_categorias_version
-- en vez del catálogo vivo — que es justo para lo que ese snapshot existe.
--
-- SIN BACKFILL, y no es por pereza: dte_proveedor nunca guardó los ítems
-- del DTE (migraciones 071/072). La categoría sale de clasificar la glosa
-- de cada ítem, y esos ítems se extrajeron del XML en memoria durante la
-- descarga y se descartaron. No hay nada en la base desde donde
-- reclasificar. Clasificar por la razón social de la contraparte
-- ("COPEC" → combustible) sería inventar el dato, con el agravante de
-- producir números que parecen calculados. Las filas viejas quedan en
-- `categoria IS NULL`, se muestran como "sin clasificar" con su CO2e
-- incluido en el total, y se arreglan volviendo a descargar el período
-- (el UPSERT ya es idempotente y las repuebla).
-- ============================================================

-- `categoria_origen` es lo que impide que este desglose mienta, y es la
-- columna más importante de la migración. La advertencia de más arriba
-- ("clasificar por la razón social sería inventar el dato") no es hipotética:
-- los adaptadores que solo traen el RCV (siiSimpleapi, siiApigateway, y
-- baseapiSii cuando el DTE viene sin XML) fabrican UN ítem sintético por
-- documento cuyo nombre ES la razón social de la contraparte, y las palabras
-- clave del motor incluyen marcas de proveedor a propósito (migración 026:
-- 'copec', 'enel', 'starken'). Sin esta columna, una factura de compra a
-- COPEC quedaba contabilizada como Alcance 1 — emisiones DIRECTAS de la
-- propia operación del comprador — por el solo hecho del nombre del emisor.
--
--   'xml'            → la categoría salió de una glosa real de ítem del DTE.
--                      Es la única que habilita atribución de alcance GHG.
--   'razon_social'   → salió del nombre de la contraparte (ítem sintético).
--                      Sirve para estimar el gasto; NO dice si la empresa
--                      quemó ese combustible o compró un servicio que lo
--                      incluía, que es justo lo que separa Alcance 1 de 3.
--   'sin_coincidencia' → ninguna palabra clave calzó y el motor usó su
--                      catch-all ('servicios'). Hay factor con que calcular,
--                      no hay clasificación.
--
-- El CO2e de los tres SIGUE contando en el total del período. Lo que cambia
-- es que solo 'xml' entra a un alcance; el resto se muestra aparte, rotulado.
ALTER TABLE dte_proveedor ADD COLUMN IF NOT EXISTS categoria        TEXT;
ALTER TABLE dte_proveedor ADD COLUMN IF NOT EXISTS categoria_origen TEXT
  CHECK (categoria_origen IS NULL OR categoria_origen IN ('xml', 'razon_social', 'sin_coincidencia'));
ALTER TABLE dte_proveedor ADD COLUMN IF NOT EXISTS motor_version_id INT REFERENCES motor_versiones(id);

CREATE INDEX IF NOT EXISTS dte_proveedor_categoria_idx
  ON dte_proveedor (proveedor_id, periodo, categoria);
