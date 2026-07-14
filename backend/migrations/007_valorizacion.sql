-- ============================================================
-- sicr3p — Valorización de inventario FIFO/PMP (CLP + CO2e).
-- Entradas automáticas desde DTE XML (precio real por ítem) y
-- movimientos manuales. La valorización se calcula al vuelo.
-- ============================================================

CREATE TABLE IF NOT EXISTS inventario_movimientos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rut_cliente_norm TEXT NOT NULL,           -- RUT sin puntos ni guión
  descripcion      TEXT NOT NULL,           -- ítem/SKU
  fecha            DATE NOT NULL DEFAULT CURRENT_DATE,
  tipo             TEXT NOT NULL CHECK (tipo IN ('entrada','salida')),
  cantidad         NUMERIC(14,3) NOT NULL CHECK (cantidad > 0),
  precio_unitario  NUMERIC(14,2) NOT NULL DEFAULT 0,   -- CLP (solo entradas)
  co2e_unitario    NUMERIC(14,6) NOT NULL DEFAULT 0,   -- tCO2e por unidad (solo entradas)
  factura_id       UUID REFERENCES facturas(id) ON DELETE SET NULL,
  origen           TEXT NOT NULL DEFAULT 'documento' CHECK (origen IN ('documento','manual')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inv_mov_cliente_item
  ON inventario_movimientos(rut_cliente_norm, descripcion, fecha, created_at);
