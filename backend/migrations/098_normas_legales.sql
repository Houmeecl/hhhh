-- ============================================================
-- Normas legales en el registro citable (extiende `fuentes_metodologicas`
-- de la migración 018, en vez de crear una tabla paralela: la pregunta
-- que responden es la misma — "¿en qué se apoya este número?" — y los
-- consumidores ya saben leer esa tabla).
--
-- POR QUÉ AHORA. En marzo de 2026 el MMA retiró 43 decretos ambientales
-- del trámite de toma de razón en Contraloría; entre ellos el nuevo
-- Reglamento del RETC, que iba a hacer OBLIGATORIO el reporte de gases
-- de efecto invernadero vía HuellaChile. Al cierre de esta migración la
-- mayoría seguía sin reingresar. La lección para sicr3p es concreta: una
-- regla "aprobada" puede no entrar nunca en vigencia, y esta plataforma
-- SELLA cálculos que se apoyan en reglas. Si la regla cambia de estado,
-- el sello tiene que poder decir bajo qué versión se calculó.
--
-- El `estado` de 018 solo distinguía calidad metodológica
-- (avalada_referencial | validada_oficial). Una norma legal necesita
-- además decir en qué punto del ciclo está: un anteproyecto, un decreto
-- retirado y uno vigente no se pueden guardar con el mismo valor.
--
-- NADA de esta migración fija metas, porcentajes ni umbrales. Solo
-- registra la IDENTIDAD y el ESTADO de cada norma, con su URL, para que
-- las cifras se validen contra el texto oficial antes de codificarse.
-- Las que faltan por verificar quedan dichas en `notas`.
-- ============================================================

-- 1) Distinguir metodología de norma legal. Las 11 filas que ya existen
--    son todas metodológicas, así que el default las deja correctas.
ALTER TABLE fuentes_metodologicas
  ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'metodologia'
    CHECK (tipo IN ('metodologia', 'norma_legal'));

-- 2) Fechas propias de una norma. Nullable: una metodología no las tiene,
--    y una norma en trámite no tiene fecha de vigencia todavía.
ALTER TABLE fuentes_metodologicas ADD COLUMN IF NOT EXISTS fecha_publicacion DATE;
ALTER TABLE fuentes_metodologicas ADD COLUMN IF NOT EXISTS fecha_vigencia    DATE;

-- 3) Ampliar el vocabulario de estado con el ciclo de vida legal.
--    Se conservan los dos valores de 018 sin tocarlos — ninguna fila
--    existente cambia de estado con esta migración.
DO $$
BEGIN
  ALTER TABLE fuentes_metodologicas DROP CONSTRAINT IF EXISTS fuentes_metodologicas_estado_check;
  ALTER TABLE fuentes_metodologicas ADD CONSTRAINT fuentes_metodologicas_estado_check
    CHECK (estado IN (
      -- Metodológicos (018, sin cambio de significado)
      'avalada_referencial',
      'validada_oficial',
      -- Ciclo de vida de una norma legal
      'vigente',          -- publicada y en vigor
      'promulgada',       -- publicada, con vigencia diferida a futuro
      'en_tramitacion',   -- anteproyecto o en toma de razón
      'retirada',         -- salió del trámite; NO está en vigor
      'derogada'
    ));
END $$;

COMMENT ON COLUMN fuentes_metodologicas.tipo IS
  'metodologia = cómo se calcula (IPCC, GHG Protocol). norma_legal = qué exige la ley (Ley 20.920, D.S. 12).';
COMMENT ON COLUMN fuentes_metodologicas.estado IS
  'Para norma_legal, el estado REAL de vigencia. "retirada" existe porque en marzo de 2026 se retiraron 43 decretos ambientales de Contraloría: aprobado no es lo mismo que vigente.';

-- ---------- Seed de normas legales ----------
-- Identidad y estado solamente. Las cifras (metas, umbrales, tasas) NO
-- se registran acá: van en las tablas que las usan, y solo después de
-- validarse contra el texto oficial.
INSERT INTO fuentes_metodologicas
  (codigo, tipo, organismo, documento, version_anio, url, estado, fecha_publicacion, fecha_vigencia, notas)
VALUES
  ('ley_20920', 'norma_legal', 'Congreso Nacional de Chile',
   'Ley 20.920 — Marco para la gestión de residuos, la responsabilidad extendida del productor y fomento al reciclaje',
   '2016', 'https://www.bcn.cl/leychile/navegar?idNorma=1090894',
   'vigente', '2016-06-01', '2016-06-01',
   'Ley marco de la REP. Sin modificaciones detectadas en 2025-2026 (hay mociones en la Cámara, son proyectos).'),

  ('ds_12_2020_envases', 'norma_legal', 'Ministerio del Medio Ambiente',
   'D.S. 12/2020 — Metas de recolección y valorización de envases y embalajes',
   '2020', 'https://www.bcn.cl/leychile/navegar?idNorma=1157019',
   'vigente', '2021-03-16', '2023-09-16',
   'Base del módulo Ley REP. Las metas suben por calendario, no por reforma. PENDIENTE DE VALIDAR contra el articulado: (a) porcentajes por material del año en curso, (b) fecha exacta de término de la flexibilidad que permite cubrir hasta 50% de la meta de una subcategoría con otra (excluido vidrio), vigente solo los primeros 4 años.'),

  ('ds_22_2025_pilas_aee', 'norma_legal', 'Ministerio del Medio Ambiente',
   'D.S. 22/2025 — Metas de recolección y valorización de pilas y aparatos eléctricos y electrónicos',
   '2025', 'https://www.diariooficial.interior.gob.cl/',
   'promulgada', '2026-05-07', '2028-05-07',
   'Producto prioritario NUEVO, aún no modelado por sicr3p. Vigencia escalonada: inscripción en Ventanilla Única del RETC exigible desde la publicación; metas y obligaciones asociadas 24 meses después. Subcategorías: aparatos de intercambio de temperatura, paneles fotovoltaicos, otros AEE + pilas. PENDIENTE DE VALIDAR: metas por subcategoría y desde cuándo rige la obligación de puntos de recepción en salas de venta sobre 400 m2.'),

  ('ncg_519_cmf', 'norma_legal', 'Comisión para el Mercado Financiero',
   'NCG 519 — Adopción de los estándares NIIF S1 y S2 (ISSB); modifica NCG 30 y NCG 461',
   '2024', 'https://www.cmfchile.cl/normativa/ncg_519_2024.pdf',
   'vigente', '2024-10-28', '2026-01-01',
   'Obligación real y con fecha para entidades fiscalizadas por la CMF: NIIF S1/S2 desde el ejercicio 2026, primer reporte en 2027. NIIF S2 exige inventario de GEI bajo GHG Protocol con Alcances 1, 2 y 3 — es lo que sicr3p ya calcula. Convive con NCG 461.'),

  ('reglamento_retc_2025', 'norma_legal', 'Ministerio del Medio Ambiente',
   'Reglamento del Registro de Emisiones y Transferencias de Contaminantes (RETC) — actualización',
   '2025', 'https://mma.gob.cl/',
   'retirada', NULL, NULL,
   'RETIRADO de la toma de razón en Contraloría el 12-03-2026, junto a otros 42 decretos ambientales. Es el que habría hecho OBLIGATORIO el reporte de GEI vía HuellaChile (art. 21 Ley 21.455). Mientras siga retirado, ese reporte es VOLUNTARIO: sicr3p no debe presentarlo como exigencia legal. Registrado justamente para que quede asentado que no está vigente.')
ON CONFLICT (codigo) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_fuentes_tipo_estado ON fuentes_metodologicas(tipo, estado);
