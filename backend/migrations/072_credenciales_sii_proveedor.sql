-- ============================================================
-- 072: el proveedor autoriza GUARDAR su clave tributaria del SII para no
-- reescribirla en cada descarga (botón "descargar" directo).
--
-- IMPORTANTE — cambio de política respecto de la 071: hasta acá la clave
-- SII jamás se persistía (uso por-request). El titular ahora pide
-- explícitamente conservarla. Para acotar el riesgo:
--  - `clave_cifrada` guarda la clave con AES-256-GCM (services/cripto.js);
--    la llave de cifrado vive SOLO en env (SII_CRED_KEY), nunca en la BD.
--    Si se filtra la base de datos, la clave queda cifrada e inservible.
--  - 1 fila por proveedor (PK = proveedor_id); el proveedor puede
--    borrarla cuando quiera (DELETE en el panel).
--  - `rut_sii` es el RUT con que se autentica en el SII (puede ser el del
--    representante), distinto del RUT de la empresa (proveedores.rut).
--
-- Además: `dte_proveedor` gana `co2e`/`metodo` para guardar el cálculo de
-- emisiones POR DOCUMENTO — al descargar las compras se extrae el detalle
-- de ítems del XML del DTE y se corre el motor propio (físico donde hay
-- unidades reales, gasto si no), como en el pipeline principal.
-- ============================================================

CREATE TABLE IF NOT EXISTS credenciales_sii_proveedor (
  proveedor_id  UUID PRIMARY KEY REFERENCES proveedores(id) ON DELETE CASCADE,
  rut_sii       TEXT NOT NULL,           -- RUT que ingresa al SII (normalizado)
  clave_cifrada TEXT NOT NULL,           -- AES-256-GCM: "iv:tag:ciphertext" en base64
  actualizada_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE dte_proveedor ADD COLUMN IF NOT EXISTS co2e   NUMERIC;   -- tCO2e referencial por documento (NULL si no se pudo calcular)
ALTER TABLE dte_proveedor ADD COLUMN IF NOT EXISTS metodo TEXT;      -- 'fisico' | 'gasto' (método dominante del documento)
