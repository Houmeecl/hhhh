-- ============================================================
-- sicr3p — Motor de cálculo propio (independiente del motor externo).
--
-- Justificación de negocio: due diligence sobre el motor externo detectó
-- una licencia amplia y perpetua sobre los datos del cliente ("Customer
-- Data") en sus T&C, y un tope de responsabilidad de solo €1.000 (o lo
-- pagado en 12 meses, lo mayor). Reducir la dependencia de ese proveedor
-- es la motivación directa de este motor.
--
-- Alcance honesto: calcula CO2e real a partir de datos ya extraídos por
-- services/dte.js (DTE XML del SII) — cantidad, unidad y monto reales por
-- ítem. Para PDF/JPG/PNG/HEIC (sin texto extraíble sin OCR, que este
-- entorno no puede correr) se sigue usando el motor externo — sin
-- regresión, sin prometer algo que no se puede construir aquí.
-- ============================================================

CREATE TABLE IF NOT EXISTS motor_categorias (
  codigo                       TEXT PRIMARY KEY,  -- mismas 6 categorías que ya usan PDF/Charts/UI
  nombre                       TEXT NOT NULL,
  unidad_fisica                TEXT,               -- kWh, L, kg, m3, km — null si es solo gasto
  factor_fisico_kgco2e         NUMERIC(14,6),       -- kgCO2e por unidad_fisica (método físico)
  factor_gasto_kgco2e_clp1000  NUMERIC(14,6) NOT NULL,  -- kgCO2e por $1.000 CLP (proxy, spend-based)
  palabras_clave               TEXT[] NOT NULL DEFAULT '{}',  -- clasificación por glosa/nombre del ítem
  fuente                       TEXT,
  activo                       BOOLEAN NOT NULL DEFAULT true,
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Marca si una factura se calculó con el motor propio o con el externo
-- (mock o real) — visibilidad para medir avance de independencia.
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS motor TEXT NOT NULL DEFAULT 'externo'
  CHECK (motor IN ('propio','externo'));

INSERT INTO motor_categorias (codigo, nombre, unidad_fisica, factor_fisico_kgco2e, factor_gasto_kgco2e_clp1000, palabras_clave, fuente, activo) VALUES
  ('electricidad', 'Energía eléctrica', 'kWh', 0.2421, 0.60,
   ARRAY['electric','kwh','energia','suministro electrico','sen','luz','potencia'],
   'HuellaChile (MMA) — SEN 2023: 0,2421 kgCO2e/kWh', true),
  ('combustible', 'Combustibles', 'L', 2.68, 1.20,
   ARRAY['diesel','diésel','gasolina','bencina','combustible','glp','gas licuado','petroleo'],
   'Factor representativo diésel — ajustable por tipo de combustible', true),
  ('transporte', 'Transporte y logística', 'km', 0.12, 0.35,
   ARRAY['flete','transporte','distribucion','distribución','logistica','logística','envio','envío','courier','despacho'],
   'Factor referencial transporte de carga — validar por modo', true),
  ('materiales', 'Insumos y materiales', 'kg', 1.5, 0.45,
   ARRAY['papeleria','papelería','envase','repuesto','insumo','material','embalaje','toner'],
   'Factor genérico de insumos — mismo default de Capital Natural', true),
  ('agua', 'Agua', 'm3', 0.344, 0.30,
   ARRAY['agua','hidrico','hídrico','potable','sanitario'],
   'Factor referencial agua potable — mismo default de Capital Natural', true),
  ('servicios', 'Servicios', NULL, NULL, 0.25,
   ARRAY['servicio','aseo','mantencion','mantención','arriendo','asesoria','asesoría','honorario'],
   'Método basado en gasto (GHG Protocol, spend-based) — categoría catch-all', true)
ON CONFLICT (codigo) DO NOTHING;
