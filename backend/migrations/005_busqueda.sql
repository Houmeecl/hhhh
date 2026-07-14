-- ============================================================
-- sicr3p — Búsqueda por RUT y texto con cruces de clientes.
-- pg_trgm para búsqueda parcial + índices sobre RUT normalizado.
-- (Cuando el volumen lo exija, esta capa se reemplaza por
--  Elasticsearch/OpenSearch sin cambiar el endpoint.)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- RUT normalizado (sin puntos ni guión) para cruces exactos.
CREATE INDEX IF NOT EXISTS idx_fact_rut_emisor_norm
  ON facturas ((regexp_replace(COALESCE(rut_emisor,''), '[^0-9kK]', '', 'g')));
CREATE INDEX IF NOT EXISTS idx_fact_rut_receptor_norm
  ON facturas ((regexp_replace(COALESCE(rut_receptor,''), '[^0-9kK]', '', 'g')));
CREATE INDEX IF NOT EXISTS idx_ses_rut_cliente_norm
  ON sesiones ((regexp_replace(COALESCE(rut_cliente,''), '[^0-9kK]', '', 'g')));

-- Búsqueda parcial por texto (número de venta, archivo, empresa, tramo).
CREATE INDEX IF NOT EXISTS idx_fact_numero_trgm ON facturas USING gin (numero_venta gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_fact_archivo_trgm ON facturas USING gin (archivo_original gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_ses_nombre_trgm ON sesiones USING gin (nombre_cliente gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_cli_nombre_trgm ON clientes USING gin (nombre_empresa gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_doc_numero_trgm ON documentos_corredor USING gin (numero_documento gin_trgm_ops);
