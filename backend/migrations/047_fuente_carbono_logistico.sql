-- ============================================================
-- 047: fuente metodológica para el carbono logístico de la Carga
-- Bioceánica — GHG Protocol Categoría 4 (transporte upstream: toneladas
-- × km × factor), NO Categoría 7 (transporte_viajes, migración 008, es
-- para transporte de personal — mode+km+pasajeros — semánticamente
-- distinto y no se reutiliza para carga). Mismo patrón de seed que
-- 018_metodologias_avaladas.sql.
-- ============================================================

INSERT INTO fuentes_metodologicas (codigo, organismo, documento, version_anio, url, notas)
VALUES (
  'ghg_protocol_cat4_transporte', 'WRI/WBCSD — GHG Protocol',
  'Corporate Value Chain (Scope 3) Standard — Categoría 4: Upstream Transportation and Distribution',
  '2011', 'https://ghgprotocol.org/corporate-value-chain-scope-3-standard',
  'Cálculo por toneladas transportadas × distancia × factor de emisión (t-km), distinto de la Categoría 7 (transporte de personal) que ya usa transporte_viajes.'
)
ON CONFLICT (codigo) DO NOTHING;
