-- ============================================================
-- sicr3p — Esquema del dataset de BigQuery
-- Ejecutar una vez en el proyecto GCP (bq query --use_legacy_sql=false)
-- reemplazando `PROYECTO` por el BQ_PROJECT_ID real.
-- Los RUT se guardan normalizados (sin puntos ni guión) para cruces.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS `PROYECTO.sicr3p`
  OPTIONS (location = 'southamerica-west1');  -- región Santiago

CREATE TABLE IF NOT EXISTS `PROYECTO.sicr3p.facturas` (
  id STRING NOT NULL,
  sesion_id STRING,
  numero_venta STRING,
  archivo_original STRING,
  rut_emisor STRING,
  rut_receptor STRING,
  rut_cliente STRING,
  empresa_cliente STRING,
  categoria STRING,
  total_co2e FLOAT64,
  origen STRING,            -- flujo_publico | corredor
  hash_documento STRING,    -- cadena de hash interna (tipo blockchain, sin red externa)
  hash_anterior STRING,
  hash_cadena STRING,
  eslabon INT64,
  created_at TIMESTAMP
)
PARTITION BY DATE(created_at)
CLUSTER BY rut_receptor, rut_emisor;

CREATE TABLE IF NOT EXISTS `PROYECTO.sicr3p.line_items` (
  factura_id STRING NOT NULL,
  descripcion STRING,
  cantidad FLOAT64,
  co2e FLOAT64,
  porcentaje_total FLOAT64
);

CREATE TABLE IF NOT EXISTS `PROYECTO.sicr3p.documentos_corredor` (
  id STRING NOT NULL,
  pais_origen STRING,
  pais_destino STRING,
  tramo STRING,
  tipo_documento STRING,
  numero_documento STRING,
  rut_emisor STRING,
  rut_receptor STRING,
  metodologia_pais STRING,
  estado STRING,
  categoria STRING,
  total_co2e FLOAT64,
  origen STRING,
  created_at TIMESTAMP
)
PARTITION BY DATE(created_at)
CLUSTER BY rut_receptor, rut_emisor;

-- Ejemplo de cruce por RUT (proveedores de un cliente a escala):
--   SELECT rut_emisor, COUNT(*) docs, SUM(total_co2e) tco2e
--   FROM `PROYECTO.sicr3p.facturas`
--   WHERE rut_receptor = '111111111'
--   GROUP BY rut_emisor ORDER BY tco2e DESC;

-- Declaraciones de embalaje REP (Ley 20.920) — una fila por VERSIÓN de la
-- declaración (en Postgres solo vive la vigente; acá queda el historial).
CREATE TABLE IF NOT EXISTS `PROYECTO.sicr3p.declaraciones_embalaje` (
  id                 STRING NOT NULL,
  sesion_id          STRING NOT NULL,
  rut_cliente        STRING,
  componentes        STRING,           -- JSON [{material, peso_gr, cantidad, reciclable}]
  n_componentes      INT64,
  peso_total_gr      NUMERIC,
  peso_reciclable_gr NUMERIC,
  porcentaje         NUMERIC,          -- % reciclabilidad (recalculado en servidor)
  nivel              STRING,           -- Alto | Medio | Bajo
  created_at         TIMESTAMP NOT NULL
);

-- Compensaciones del POS de mostrador — una fila por VERSIÓN del cobro
-- (en Postgres solo vive el cobro vigente por sesión; acá el historial).
CREATE TABLE IF NOT EXISTS `PROYECTO.sicr3p.compensaciones` (
  id               STRING NOT NULL,
  sesion_id        STRING NOT NULL,
  rut_cliente      STRING,
  terminal_id      STRING,
  t_co2e           NUMERIC,
  tarifa_clp_tco2e NUMERIC,            -- tarifa vigente aplicada (CLP por t CO2e)
  monto_clp        NUMERIC,            -- ROUND(t_co2e × tarifa); 0 si 'omitido'
  metodo           STRING,
  estado           STRING,             -- simulado | omitido | pendiente | pagado
  created_at       TIMESTAMP NOT NULL
);

-- Auditoría de CRUCES de datos: cuándo alguien (staff sicrep vía
-- routes/buscar.js, o un mandante vía routes/mandante.js) consultó datos
-- de una contraparte. En Postgres el mismo evento vive en actividad_log
-- (fuente de verdad); acá queda como copia externa consultable a escala.
CREATE TABLE IF NOT EXISTS `PROYECTO.sicr3p.accesos_cruce` (
  id               STRING NOT NULL,
  tipo             STRING NOT NULL,    -- consulta_cruce_rut | consulta_proveedores_mandante | consulta_proveedor_mandante
  actor_tipo       STRING NOT NULL,    -- usuario | mandante
  actor_id         STRING,
  rut_consultado   STRING,
  detalle          STRING,            -- JSON con el detalle del cruce (n_documentos, etc.)
  created_at       TIMESTAMP NOT NULL
)
PARTITION BY DATE(created_at)
CLUSTER BY rut_consultado, actor_id;

-- "Sube y Suma" — capa de gamificación (juego de escaneo para empleados
-- de una empresa cliente). Las tres tablas son append-only (una fila por
-- evento, nunca se reemplazan), sin PARTITION BY/CLUSTER BY: volumen bajo,
-- igual que line_items.

-- Bitácora de puntaje: cada vez que un jugador escanea un documento,
-- completa una misión, cierra un trayecto o entrega envases reciclables.
-- Si la tabla ya existía sin reciclaje_id, agregarla con:
--   ALTER TABLE `PROYECTO.sicr3p.puntos_eventos` ADD COLUMN IF NOT EXISTS reciclaje_id STRING;
CREATE TABLE IF NOT EXISTS `PROYECTO.sicr3p.puntos_eventos` (
  id            STRING NOT NULL,
  jugador_id    STRING NOT NULL,
  tipo          STRING NOT NULL,    -- documento_escaneado | mision_completada | trayecto_registrado | envase_reciclado
  puntos        INT64 NOT NULL,
  factura_id    STRING,
  mision_id     STRING,
  trayecto_id   STRING,
  reciclaje_id  STRING,
  created_at    TIMESTAMP NOT NULL
);

-- Canje de una recompensa simbólica (insignia o constancia) por puntos.
CREATE TABLE IF NOT EXISTS `PROYECTO.sicr3p.canjes` (
  id               STRING NOT NULL,
  jugador_id       STRING NOT NULL,
  recompensa_id    STRING NOT NULL,
  puntos_gastados  INT64 NOT NULL,
  serial           STRING,
  hash             STRING,
  created_at       TIMESTAMP NOT NULL
);

-- Trayecto de ida/vuelta a la empresa — solo se exporta ya cerrado (con
-- llegada_at/puntos), nunca al abrirse. Si la tabla ya existía sin las
-- columnas de GPS/distancia, agregarlas con ALTER TABLE ... ADD COLUMN IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS `PROYECTO.sicr3p.trayectos` (
  id               STRING NOT NULL,
  jugador_id       STRING NOT NULL,
  salida_at        TIMESTAMP NOT NULL,
  llegada_at       TIMESTAMP,
  modo_transporte  STRING,          -- caminando | bicicleta | transporte_publico | auto | moto | otro
  puntos           INT64 NOT NULL,
  salida_lat       NUMERIC,
  salida_lng       NUMERIC,
  llegada_lat      NUMERIC,
  llegada_lng      NUMERIC,
  distancia_m      NUMERIC,
  created_at       TIMESTAMP NOT NULL
);

-- Entrega de envases reciclables validada en un punto limpio. `envases`
-- es JSON [{material, cantidad}] tal como lo validó el backend.
CREATE TABLE IF NOT EXISTS `PROYECTO.sicr3p.reciclajes` (
  id               STRING NOT NULL,
  jugador_id       STRING NOT NULL,
  punto_limpio_id  STRING NOT NULL,
  lat              NUMERIC,
  lng              NUMERIC,
  distancia_m      NUMERIC,
  envases          STRING,          -- JSON [{material, cantidad}]
  total_envases    INT64 NOT NULL,
  puntos           INT64 NOT NULL,
  created_at       TIMESTAMP NOT NULL
);
