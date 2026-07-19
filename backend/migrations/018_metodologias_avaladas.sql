-- ============================================================
-- sicr3p — Registro de metodologías avaladas + nuevas categorías del motor.
--
-- 1) fuentes_metodologicas: registro citable de los documentos que avalan
--    la METODOLOGÍA (IPCC, GHG Protocol, DEFRA, MMA, CEN, GLEC). Honestidad
--    primero: esos organismos avalan el MÉTODO, no a sicr3p; nada de esto
--    es un "certificado". Toda fuente parte como 'avalada_referencial' y
--    solo un admin la sube a 'validada_oficial' cuando tiene descargada la
--    edición vigente del documento.
--    (No confundir con metodologias_pais de la migración 002: aquella es
--    la habilitación por país del Corredor Bioceánico; esta tabla cita
--    documentos metodológicos. Roles distintos, tablas distintas.)
-- 2) motor_categorias.fuente_metodologica_id: FK opcional a la fuente que
--    respalda el factor de la categoría. El informe PDF la cita como
--    "organismo — documento (año)".
-- 3) config_pos.tipo_cambio_usd_clp: NULL = sin fijar (el frontend no
--    muestra USD). Lo fija el admin a mano citando su fuente; jamás se
--    consulta un tipo de cambio automático desde el servidor.
-- 4) Seed de 10 categorías nuevas del motor propio, cada una con factor
--    citado y marcado "Referencial — validar". Solo INSERT ... ON CONFLICT
--    DO NOTHING y UPDATE ... WHERE ... IS NULL: no se pisan ediciones
--    del admin (mismo patrón de 017).
-- ============================================================

CREATE TABLE IF NOT EXISTS fuentes_metodologicas (
  id           SERIAL PRIMARY KEY,
  codigo       TEXT NOT NULL UNIQUE,
  organismo    TEXT NOT NULL,       -- ej: 'IPCC', 'WRI/WBCSD — GHG Protocol'
  documento    TEXT NOT NULL,       -- título citable del documento
  version_anio TEXT,                -- edición/año de la versión usada
  url          TEXT,
  notas        TEXT,
  estado       TEXT NOT NULL DEFAULT 'avalada_referencial'
               CHECK (estado IN ('avalada_referencial', 'validada_oficial')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE motor_categorias
  ADD COLUMN IF NOT EXISTS fuente_metodologica_id INT REFERENCES fuentes_metodologicas(id);

-- NULL = tipo de cambio sin fijar; el frontend entonces no muestra USD.
ALTER TABLE config_pos ADD COLUMN IF NOT EXISTS tipo_cambio_usd_clp NUMERIC NULL;

-- ---------- Seed de fuentes metodológicas ----------
INSERT INTO fuentes_metodologicas (codigo, organismo, documento, version_anio, url, notas) VALUES
  ('ipcc_2006_v2', 'IPCC',
   '2006 IPCC Guidelines for National Greenhouse Gas Inventories, Vol. 2 (Energía)',
   '2006', 'https://www.ipcc-nggip.iges.or.jp/public/2006gl/',
   'Factores de combustión estacionaria y móvil. Avala la metodología, no a sicr3p. Referencial — validar contra el Refinamiento 2019 antes de marcar como validada.'),
  ('ipcc_ar6_gwp', 'IPCC',
   'Sexto Informe de Evaluación (AR6), GT1 — GWP100 de gases refrigerantes',
   '2021', 'https://www.ipcc.ch/report/ar6/wg1/',
   'Potenciales de calentamiento global a 100 años (GWP100) para HFC. Referencial — validar contra la tabla del AR6 descargada.'),
  ('ghg_protocol_2004', 'WRI/WBCSD — GHG Protocol',
   'GHG Protocol Corporate Accounting and Reporting Standard (edición revisada)',
   '2004', 'https://ghgprotocol.org/corporate-standard',
   'Define los alcances 1, 2 y 3 y el método por gasto (spend-based). Avala la metodología, no a sicr3p.'),
  ('defra_2024', 'DEFRA (Reino Unido)',
   'UK Government GHG Conversion Factors for Company Reporting',
   '2024', 'https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2024',
   'Residuos, agua y vuelos. Factores del Reino Unido usados como referencia: referencial — validar su aplicabilidad local.'),
  ('mma_huellachile', 'MMA Chile — HuellaChile',
   'Programa HuellaChile — factores de emisión de referencia nacional',
   '2023', 'https://huellachile.mma.gob.cl/',
   'Programa nacional voluntario del Ministerio del Medio Ambiente. Avala la metodología de cuantificación; no certifica a sicr3p.'),
  ('cen_sen', 'Coordinador Eléctrico Nacional',
   'Factor de emisión promedio del Sistema Eléctrico Nacional (SEN)',
   '2023', 'https://www.coordinador.cl/',
   'Fuente primaria del factor eléctrico chileno que difunde HuellaChile. Referencial — validar el promedio anual vigente.'),
  ('glec_v3', 'Smart Freight Centre — GLEC',
   'GLEC Framework v3 (alineado con ISO 14083)',
   '2023', 'https://www.smartfreightcentre.org/en/our-programs/global-logistics-emissions-council/',
   'Metodología de transporte de carga multimodal. Referencial — validar factores por modo antes de marcar como validada.')
ON CONFLICT (codigo) DO NOTHING;

-- ---------- Vincula las categorías EXISTENTES a su fuente ----------
-- Solo si el admin no vinculó otra antes (fuente_metodologica_id IS NULL).
UPDATE motor_categorias SET fuente_metodologica_id =
  (SELECT id FROM fuentes_metodologicas WHERE codigo = 'mma_huellachile')
  WHERE codigo = 'electricidad' AND fuente_metodologica_id IS NULL;
UPDATE motor_categorias SET fuente_metodologica_id =
  (SELECT id FROM fuentes_metodologicas WHERE codigo = 'ipcc_2006_v2')
  WHERE codigo = 'combustible' AND fuente_metodologica_id IS NULL;
UPDATE motor_categorias SET fuente_metodologica_id =
  (SELECT id FROM fuentes_metodologicas WHERE codigo = 'glec_v3')
  WHERE codigo = 'transporte' AND fuente_metodologica_id IS NULL;
UPDATE motor_categorias SET fuente_metodologica_id =
  (SELECT id FROM fuentes_metodologicas WHERE codigo = 'ghg_protocol_2004')
  WHERE codigo = 'materiales' AND fuente_metodologica_id IS NULL;
UPDATE motor_categorias SET fuente_metodologica_id =
  (SELECT id FROM fuentes_metodologicas WHERE codigo = 'defra_2024')
  WHERE codigo = 'agua' AND fuente_metodologica_id IS NULL;
UPDATE motor_categorias SET fuente_metodologica_id =
  (SELECT id FROM fuentes_metodologicas WHERE codigo = 'ghg_protocol_2004')
  WHERE codigo = 'servicios' AND fuente_metodologica_id IS NULL;

-- ---------- Categorías NUEVAS del motor propio ----------
-- Convenciones del motor (services/motorPropio.js): factor_fisico_kgco2e en
-- kgCO2e por unidad_fisica; el método físico solo aplica si la unidad del
-- DTE se normaliza a la misma unidad (kWh/L/kg/m3/km); si no, corre el
-- método por gasto (factor_gasto_kgco2e_clp1000, kgCO2e por $1.000 CLP,
-- proxy referencial). Un código ya existente NUNCA se toca.

-- Alcance 1 — combustión: gas natural (IPCC 2006, 2,02 kgCO2e/m³).
INSERT INTO motor_categorias (codigo, nombre, unidad_fisica, factor_fisico_kgco2e, factor_gasto_kgco2e_clp1000, palabras_clave, fuente, activo, alcance_ghg, fuente_metodologica_id) VALUES
  ('gas_natural', 'Gas natural', 'm3', 2.02, 0.90,
   ARRAY['gas natural','metrogas','gas de red','gnl'],
   'IPCC 2006 Guidelines Vol. 2 — combustión estacionaria: 2,02 kgCO2e/m³. Referencial — validar contra la fuente vigente.',
   true, 'Alcance 1 — combustión estacionaria (gas natural)',
   (SELECT id FROM fuentes_metodologicas WHERE codigo = 'ipcc_2006_v2'))
ON CONFLICT (codigo) DO NOTHING;

-- Alcance 1 — combustión: GLP (IPCC 2006, 1,61 kgCO2e/L).
INSERT INTO motor_categorias (codigo, nombre, unidad_fisica, factor_fisico_kgco2e, factor_gasto_kgco2e_clp1000, palabras_clave, fuente, activo, alcance_ghg, fuente_metodologica_id) VALUES
  ('glp', 'Gas licuado (GLP)', 'L', 1.61, 1.00,
   ARRAY['glp','gas licuado','lipigas','abastible','gasco','cilindro de gas','balon de gas'],
   'IPCC 2006 Guidelines Vol. 2 — GLP: 1,61 kgCO2e/L. Referencial — validar contra la fuente vigente.',
   true, 'Alcance 1 — combustión propia (GLP)',
   (SELECT id FROM fuentes_metodologicas WHERE codigo = 'ipcc_2006_v2'))
ON CONFLICT (codigo) DO NOTHING;

-- 'glp' y 'gas licuado' vivían en 'combustible' (factor diésel, 2,68 kg/L);
-- con la categoría dedicada (1,61 kg/L, IPCC) se trasladan para que la
-- clasificación no dependa del orden de lectura de la tabla. Solo corre si
-- las palabras siguen ahí Y la categoría glp está activa: si el admin
-- prefiere que GLP vuelva a combustible, desactiva la categoría glp y
-- esta migración no le vuelve a tocar sus palabras clave.
UPDATE motor_categorias
   SET palabras_clave = array_remove(array_remove(palabras_clave, 'glp'), 'gas licuado'),
       updated_at = now()
 WHERE codigo = 'combustible'
   AND palabras_clave && ARRAY['glp','gas licuado']
   AND EXISTS (SELECT 1 FROM motor_categorias WHERE codigo = 'glp' AND activo = true);

-- Alcance 1 — combustión: kerosene / Jet A-1 (DEFRA 2024, 2,54 kgCO2e/L).
INSERT INTO motor_categorias (codigo, nombre, unidad_fisica, factor_fisico_kgco2e, factor_gasto_kgco2e_clp1000, palabras_clave, fuente, activo, alcance_ghg, fuente_metodologica_id) VALUES
  ('kerosene_jet', 'Kerosene / Jet A-1', 'L', 2.54, 1.10,
   ARRAY['kerosene','kerosen','parafina','jet a1','jet a-1','combustible de aviacion'],
   'DEFRA 2024 — kerosene y Jet A-1: 2,54 kgCO2e/L. Referencial — validar contra la fuente vigente.',
   true, 'Alcance 1 — combustión propia (kerosene / Jet A-1)',
   (SELECT id FROM fuentes_metodologicas WHERE codigo = 'defra_2024'))
ON CONFLICT (codigo) DO NOTHING;

-- Alcance 1 — fugas de refrigerantes (GWP100 del IPCC AR6, por kg fugado).
INSERT INTO motor_categorias (codigo, nombre, unidad_fisica, factor_fisico_kgco2e, factor_gasto_kgco2e_clp1000, palabras_clave, fuente, activo, alcance_ghg, fuente_metodologica_id) VALUES
  ('refrigerante_r134a', 'Refrigerante R-134a (fuga)', 'kg', 1530, 25.0,
   ARRAY['r-134a','r134a','hfc-134a','refrigerante 134'],
   'IPCC AR6 — GWP100 R-134a = 1.530 kgCO2e por kg fugado. Factor por gasto: proxy referencial — validar contra la fuente vigente.',
   true, 'Alcance 1 — emisiones fugitivas de refrigerantes',
   (SELECT id FROM fuentes_metodologicas WHERE codigo = 'ipcc_ar6_gwp'))
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO motor_categorias (codigo, nombre, unidad_fisica, factor_fisico_kgco2e, factor_gasto_kgco2e_clp1000, palabras_clave, fuente, activo, alcance_ghg, fuente_metodologica_id) VALUES
  ('refrigerante_r410a', 'Refrigerante R-410A (fuga)', 'kg', 2256, 35.0,
   ARRAY['r-410a','r410a','refrigerante 410'],
   'IPCC AR6 — GWP100 R-410A aprox. 2.256 kgCO2e por kg fugado (mezcla R-32/R-125). Referencial — validar contra la fuente vigente.',
   true, 'Alcance 1 — emisiones fugitivas de refrigerantes',
   (SELECT id FROM fuentes_metodologicas WHERE codigo = 'ipcc_ar6_gwp'))
ON CONFLICT (codigo) DO NOTHING;

-- Alcance 3 · Cat. 5 — residuos a relleno sanitario (DEFRA 2024).
-- 0,45 tCO2e/t = 0,45 kgCO2e/kg (unidad de la tabla: kg).
INSERT INTO motor_categorias (codigo, nombre, unidad_fisica, factor_fisico_kgco2e, factor_gasto_kgco2e_clp1000, palabras_clave, fuente, activo, alcance_ghg, fuente_metodologica_id) VALUES
  ('residuos_relleno', 'Residuos a relleno sanitario', 'kg', 0.45, 0.50,
   ARRAY['relleno sanitario','disposicion final','retiro de residuos','residuos','vertedero','basura'],
   'DEFRA 2024 — disposición en relleno sanitario: 0,45 kgCO2e/kg (= 0,45 tCO2e/t). Referencial — validar contra la fuente vigente.',
   true, 'Alcance 3 · Cat. 5 — residuos generados en la operación',
   (SELECT id FROM fuentes_metodologicas WHERE codigo = 'defra_2024'))
ON CONFLICT (codigo) DO NOTHING;

-- Alcance 3 · Cat. 1 — agua potable de red (DEFRA 2024, suministro + tratamiento).
INSERT INTO motor_categorias (codigo, nombre, unidad_fisica, factor_fisico_kgco2e, factor_gasto_kgco2e_clp1000, palabras_clave, fuente, activo, alcance_ghg, fuente_metodologica_id) VALUES
  ('agua_potable', 'Agua potable (red)', 'm3', 0.41, 0.30,
   ARRAY['agua potable','aguas andinas','esval','essbio','smapa'],
   'DEFRA 2024 — agua potable, suministro más tratamiento: 0,41 kgCO2e/m³. Referencial — validar contra la fuente vigente.',
   true, 'Alcance 3 · Cat. 1 — bienes adquiridos (agua potable)',
   (SELECT id FROM fuentes_metodologicas WHERE codigo = 'defra_2024'))
ON CONFLICT (codigo) DO NOTHING;

-- Alcance 3 · Cat. 6 — vuelos de pasajeros (DEFRA 2024, economy, sin
-- forzamiento radiativo). El factor es por pasajero-km; el motor lo aplica
-- por km del pasaje cuando el documento trae la distancia.
INSERT INTO motor_categorias (codigo, nombre, unidad_fisica, factor_fisico_kgco2e, factor_gasto_kgco2e_clp1000, palabras_clave, fuente, activo, alcance_ghg, fuente_metodologica_id) VALUES
  ('vuelo_corto', 'Vuelo corto (pasajero)', 'km', 0.15, 0.70,
   ARRAY['vuelo','pasaje aereo','vuelo nacional','vuelo domestico','aereo nacional'],
   'DEFRA 2024 — vuelo corto, clase economy, sin forzamiento radiativo: 0,15 kgCO2e por pasajero-km. Referencial — validar contra la fuente vigente.',
   true, 'Alcance 3 · Cat. 6 — viajes de negocios (vuelo corto)',
   (SELECT id FROM fuentes_metodologicas WHERE codigo = 'defra_2024'))
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO motor_categorias (codigo, nombre, unidad_fisica, factor_fisico_kgco2e, factor_gasto_kgco2e_clp1000, palabras_clave, fuente, activo, alcance_ghg, fuente_metodologica_id) VALUES
  ('vuelo_largo', 'Vuelo largo (pasajero)', 'km', 0.19, 0.60,
   ARRAY['vuelo internacional','pasaje aereo internacional','flete aereo','aereo internacional','vuelo largo'],
   'DEFRA 2024 — vuelo largo, clase economy, sin forzamiento radiativo: 0,19 kgCO2e por pasajero-km. Referencial — validar contra la fuente vigente.',
   true, 'Alcance 3 · Cat. 6 — viajes de negocios (vuelo largo)',
   (SELECT id FROM fuentes_metodologicas WHERE codigo = 'defra_2024'))
ON CONFLICT (codigo) DO NOTHING;

-- Alcance 3 · Cat. 4 — carga marítima en contenedor (GLEC v3 / ISO 14083).
-- El DTE chileno no trae t-km, así que la unidad 't-km' no se normaliza y
-- hoy siempre aplica el método por gasto; el factor físico queda citado
-- para la calculadora y para cuando existan t-km reales.
INSERT INTO motor_categorias (codigo, nombre, unidad_fisica, factor_fisico_kgco2e, factor_gasto_kgco2e_clp1000, palabras_clave, fuente, activo, alcance_ghg, fuente_metodologica_id) VALUES
  ('maritimo_contenedor', 'Marítimo — contenedor', 't-km', 0.012, 0.20,
   ARRAY['flete maritimo','maritimo','naviera','contenedor','embarque maritimo'],
   'GLEC Framework v3 / ISO 14083 — carga marítima en contenedor: 0,012 kgCO2e/t-km. Referencial — validar contra la fuente vigente.',
   true, 'Alcance 3 · Cat. 4 — transporte y distribución (marítimo)',
   (SELECT id FROM fuentes_metodologicas WHERE codigo = 'glec_v3'))
ON CONFLICT (codigo) DO NOTHING;
