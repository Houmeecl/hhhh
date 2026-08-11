-- ============================================================
-- 087: Ley REP real desde el panel del proveedor (sin POS).
--
-- Hasta ahora la declaración de envases REP (Ley 20.920) solo nacía en
-- el terminal POS de mostrador, armada por el OPERADOR por sesión
-- (migración 015). Pero el productor obligado por la ley es la EMPRESA
-- que pone productos envasados en el mercado — y en terreno no hay POS.
--
-- Este par de tablas invierte el flujo: la empresa mantiene su catálogo
-- de productos con la composición de su envase (misma estructura de
-- componentes y misma fórmula server-side que declaraciones_embalaje),
-- sube su factura de venta como evidencia y la "pega" a sus productos
-- (qué vendió y cuántas unidades). De ahí salen los KILOS REALES de
-- envases puestos en el mercado, por material — la base de su
-- declaración en RETC/SGR. sicr3p prepara ese insumo; la declaración
-- formal ante el MMA la hace la empresa, nunca sicr3p.
-- ============================================================

-- Catálogo de productos del proveedor con su envase declarado.
-- porcentaje/nivel SIEMPRE recalculados en el servidor (services/rep.js);
-- jamás se confía en lo que mande el cliente.
CREATE TABLE IF NOT EXISTS productos_proveedor (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proveedor_id       UUID NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  nombre             TEXT NOT NULL,
  codigo             TEXT,                 -- SKU/código interno, opcional
  componentes        JSONB NOT NULL,       -- [{material, peso_gr, cantidad, reciclable}] — envase de UNA unidad
  peso_total_gr      NUMERIC NOT NULL,     -- peso del envase por unidad (recalculado en servidor)
  peso_reciclable_gr NUMERIC NOT NULL,
  porcentaje         NUMERIC NOT NULL,     -- % reciclabilidad (fórmula SICREP, 1 decimal)
  nivel              TEXT NOT NULL CHECK (nivel IN ('Alto','Medio','Bajo')),
  activo             BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_productos_proveedor_prov ON productos_proveedor(proveedor_id);

-- Venta registrada por el proveedor: su factura (archivo como evidencia,
-- foto o PDF/XML) pegada a sus productos. `items` es un SNAPSHOT — congela
-- nombre, componentes y pesos del producto AL MOMENTO de la venta: editar
-- el producto después no reescribe la historia de lo ya declarado.
CREATE TABLE IF NOT EXISTS ventas_rep (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proveedor_id     UUID NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  numero_documento TEXT NOT NULL,
  fecha_documento  DATE NOT NULL,
  periodo          TEXT NOT NULL,          -- AAAA-MM derivado de fecha_documento (servidor)
  archivo          BYTEA NOT NULL,         -- evidencia: la factura tal como se subió
  archivo_nombre   TEXT NOT NULL,
  extension        TEXT NOT NULL,
  tamano_bytes     INTEGER NOT NULL,
  sha256           TEXT NOT NULL,          -- integridad del archivo subido
  items            JSONB NOT NULL,         -- [{producto_id, nombre, codigo, unidades, peso_total_gr, peso_reciclable_gr, componentes}]
  kg_envases       NUMERIC NOT NULL,       -- Σ unidades × peso envase (recalculado en servidor)
  kg_reciclables   NUMERIC NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ventas_rep_prov ON ventas_rep(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_ventas_rep_periodo ON ventas_rep(proveedor_id, periodo);
