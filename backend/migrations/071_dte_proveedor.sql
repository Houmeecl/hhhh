-- ============================================================
-- 071: DTE del proveedor descargados desde el SII vía BaseAPI.
--
-- El proveedor entra a su panel, escribe su clave tributaria y descarga
-- su Registro de Compras y Ventas (RCV) de un período. Guardamos el
-- DETALLE de cada documento (folio, contraparte, montos) para poder
-- analizarlo — resumen, cruce de contrapartes, estimación referencial de
-- emisiones — SIN guardar jamás la clave: la clave viaja por request a
-- BaseAPI y se descarta al terminar el handler. Esta tabla NO tiene, ni
-- puede tener, ninguna columna de credencial. (Ver services/baseapiSii.js
-- y el router proveedor en routes/origen.js.)
--
-- 1 fila = 1 documento tributario de un período/tipo de un proveedor.
-- `tipo` = 'compra' (recibido) | 'venta' (emitido). `rut_contraparte` es
-- el proveedor del proveedor (en compras) o su cliente (en ventas).
--
-- La re-descarga de un mismo período es idempotente: el UNIQUE de abajo
-- + ON CONFLICT DO UPDATE en el UPSERT deja el período tal como está hoy
-- en el SII, sin duplicar (un documento anulado que desaparece del RCV
-- simplemente no vuelve a insertarse; el período se puede re-descargar
-- entero cuando el proveedor quiera).
-- ============================================================

CREATE TABLE IF NOT EXISTS dte_proveedor (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proveedor_id    UUID NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  periodo         TEXT NOT NULL,                 -- 'YYYY-MM'
  tipo            TEXT NOT NULL,                 -- 'compra' | 'venta'
  tipo_dte        TEXT,                          -- código SII: 33, 34, 61, 56, ...
  folio           TEXT NOT NULL,
  rut_contraparte TEXT,                          -- normalizado: sin puntos/guión
  razon_social    TEXT,
  neto            NUMERIC NOT NULL DEFAULT 0,
  iva             NUMERIC NOT NULL DEFAULT 0,
  total           NUMERIC NOT NULL DEFAULT 0,
  fecha           DATE,
  descargado_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dte_proveedor_tipo_chk CHECK (tipo IN ('compra', 'venta'))
);

-- Un documento se identifica por (proveedor, período, tipo, tipo_dte,
-- folio, contraparte): así la re-descarga del período es un UPSERT y no
-- duplica. Se incluye rut_contraparte porque un mismo folio puede
-- repetirse entre emisores distintos.
CREATE UNIQUE INDEX IF NOT EXISTS dte_proveedor_doc_uq
  ON dte_proveedor (proveedor_id, periodo, tipo, COALESCE(tipo_dte, ''), folio, COALESCE(rut_contraparte, ''));

CREATE INDEX IF NOT EXISTS dte_proveedor_prov_periodo_idx
  ON dte_proveedor (proveedor_id, periodo);

-- Para el cruce de contrapartes por RUT (¿esta contraparte ya está en
-- sicr3p?), igual que buscar.js consulta por RUT normalizado.
CREATE INDEX IF NOT EXISTS dte_proveedor_contraparte_idx
  ON dte_proveedor (rut_contraparte);
