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

-- Compensaciones del POS Aduana Verde — una fila por VERSIÓN del cobro
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
