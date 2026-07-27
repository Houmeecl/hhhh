-- ============================================================
-- Registra la fuente que define los NOMBRES de las 15 categorías de
-- Alcance 3 (taxonomía, no un factor de emisión): GHG Protocol —
-- Corporate Value Chain (Scope 3) Accounting and Reporting Standard
-- (WRI/WBCSD, 2011). Documento DISTINTO de 'ghg_protocol_2004' (018):
-- aquel define los 3 alcances en general; este define las 15
-- categorías del Alcance 3. La usa services/alcanceGhg.js para citar
-- el origen de los nombres de categoría en el export de Alcance 3 de
-- mandante.js. No toca ninguna fila de motor_categorias ni su FK de
-- factor — es solo una fuente citable nueva.
-- ============================================================

INSERT INTO fuentes_metodologicas (codigo, organismo, documento, version_anio, url, notas) VALUES
  ('ghg_protocol_scope3_2011', 'WRI/WBCSD — GHG Protocol',
   'Corporate Value Chain (Scope 3) Accounting and Reporting Standard',
   '2011', 'https://ghgprotocol.org/standards/scope-3-standard',
   'Define las 15 categorías del Alcance 3 citadas en el export de mandantes. Avala la taxonomía, no a sicr3p.')
ON CONFLICT (codigo) DO NOTHING;
