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
