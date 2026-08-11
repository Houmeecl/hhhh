-- ============================================================
-- Tercera ronda de diligencia de fuentes metodológicas (2026-08).
--
-- Resultado central: NINGUNA fuente se promueve a 'validada_oficial'.
-- WebFetch quedó bloqueado para los 12 dominios oficiales probados
-- (gov.uk, coordinador.cl, huellachile.mma.gob.cl, ipcc.ch, etc.), así
-- que nada de esta ronda califica como confirmación de primera mano —
-- honestidad primero, igual que en 075 y 081. Lo que SÍ deja la ronda:
--
-- 1) defra_2024: la edición vigente es la 2026 (DESNZ, publicada
--    11-jun-2026) — se actualizan documento/año/URL de la fila (la cita
--    apunta a la edición que hay que abrir, no a la superada) sin
--    promover.
-- 2) CORRECCIÓN DE ETIQUETA en vuelo_corto/vuelo_largo: el seed 018 los
--    rotula "sin forzamiento radiativo", pero los valores (0,15/0,19)
--    calzan con los factores CON forzamiento de las ediciones DEFRA
--    2021-2024, y la etiqueta "sin" es aritméticamente imposible: sus
--    equivalentes CON forzamiento (~1,7x) serían ~0,26/0,32, cifras que
--    DEFRA nunca publicó para esas categorías; además el vuelo doméstico
--    CON forzamiento de la edición 2026 (0,229) es MENOR que el 0,245
--    del motor. Es un error de rotulación visible en informes — se
--    corrige el texto; los NÚMEROS no se tocan (eso exige la planilla
--    2026 abierta de primera mano).
-- 3) transporte_modos (Cat. 7) recibe su primera diligencia: los textos
--    de fuente pasan de "Referencial — validar" a citas concretas
--    (DEFRA/DESNZ 2026, referencial) con los desfases detectados
--    anotados (tren ~-13% y bus/coach ~+42% en la edición 2026);
--    'camioneta' se declara proxy interno (no existe análogo DEFRA por
--    pasajero-km). Los factores numéricos NO cambian.
-- 4) Notas de tercera ronda en las 5 fuentes trabajadas, con las URLs
--    exactas listas para que un humano con navegador cierre la
--    verificación (~15 minutos: 4 documentos).
--
-- Idempotente: el runner re-ejecuta todos los .sql en cada arranque —
-- cada UPDATE lleva guardia por texto/estado actual (patrón 075/081).
-- ============================================================

-- 1) defra_2024 → la fila cita la edición vigente (2026), sigue referencial.
UPDATE fuentes_metodologicas SET
  documento = 'Greenhouse gas reporting: conversion factors 2026 (DESNZ, antes DEFRA)',
  version_anio = '2026',
  url = 'https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2026',
  notas = notas || ' Diligencia 2026-08 (tercera ronda): edición 2026 publicada el 11-jun-2026 por DESNZ (existencia y fecha trianguladas en 6+ fuentes; la planilla misma sigue inaccesible desde este entorno). Cifras vía espejos: kerosene 2,54269 kgCO2e/L y residuos a relleno 446,242 kgCO2e/t calzan con el motor (±1%); vuelos corregidos a la baja desde la edición 2025 (load factors post-COVID) — el motor queda sobrestimado ~+19% (corto) y ~+62% (largo) frente a los valores CON forzamiento 2026 de espejos; agua con etiquetas supply/treatment en conflicto entre espejos. Abrir la planilla oficial (condensed set) antes de promover o actualizar números.'
WHERE codigo = 'defra_2024'
  AND estado = 'avalada_referencial'
  AND notas NOT LIKE '%tercera ronda%';

-- 2) mma_huellachile → cita al PDF v3 exacto; candidata Nº1 a promoción.
UPDATE fuentes_metodologicas SET
  version_anio = '2024 (v3, nov-2024)',
  url = 'https://huellachile.mma.gob.cl/wp-content/uploads/2024/11/HuellaChile-DCC-Factores-de-emision-nivel-basico_v3.pdf',
  notas = notas || ' Diligencia 2026-08 (tercera ronda): el contenido indexado del propio PDF v3 (28-nov-2024) publica electricidad SEN 2023 = 0,2421 kgCO2e/kWh — coincide EXACTO con el factor vigente del motor. Candidata Nº1 a promoción: solo falta que un admin abra el PDF de primera mano. Para el año de reporte 2024 existe además la "Base de datos factores de emisión 2024" en el mismo sitio (sección Recursos > Material de apoyo).'
WHERE codigo = 'mma_huellachile'
  AND estado = 'avalada_referencial'
  AND notas NOT LIKE '%tercera ronda%';

-- 3) cen_sen → URL exacta del reporte 2024 + cifra puente 2023 + veto México.
UPDATE fuentes_metodologicas SET
  notas = notas || ' Diligencia 2026-08 (tercera ronda): PDF del reporte 2024 localizado con URL exacta (https://www.coordinador.cl/wp-content/uploads/2025/04/CEN-Reporte-Art-72-15-ano-2024.pdf, subido abr-2025), contenido aún inaccesible desde este entorno. Cifra puente verificable por nota de prensa del propio CEN: factor SEN 2023 = 0,2384 tCO2eq/MWh (la diferencia con el 0,2421 de HuellaChile es esperable por alcance/metodología). VETO reforzado al "0,444 tCO2e/MWh" de búsquedas: viene atribuido a la CRE y al RENE — organismos MEXICANOS (Chile tiene CNE y RETC); es el SEN de México, no el chileno.'
WHERE codigo = 'cen_sen'
  AND estado = 'avalada_referencial'
  AND notas NOT LIKE '%tercera ronda%';

-- 4) ipcc_2006_v2 → cierre conceptual del impedimento de 075.
UPDATE fuentes_metodologicas SET
  notas = notas || ' Diligencia 2026-08 (tercera ronda): material oficial del TFI (indexado; presentación "Refinements in Volume 2 Energy" y capítulos del Refinamiento) indica que el 2019 Refinement NO modifica los factores por defecto de combustión estacionaria (Vol. 2 Cap. 2: secciones de factores marcadas "no refinement") y NO incluye refinamiento del Cap. 3 (combustión móvil); sus cambios del Vol. 2 son solo emisiones fugitivas (Cap. 4), que el motor no usa. El impedimento de la ronda 1 queda resuelto conceptualmente; promovible cuando un admin abra el índice del Refinamiento de primera mano (https://www.ipcc.ch/site/assets/uploads/2019/12/19R_V0_01_Overview.pdf).'
WHERE codigo = 'ipcc_2006_v2'
  AND estado = 'avalada_referencial'
  AND notas NOT LIKE '%tercera ronda%';

-- 5) glec_v3 → cita bibliográfica fijada; la decisión de unidad no cambia.
UPDATE fuentes_metodologicas SET
  notas = notas || ' Diligencia 2026-08 (tercera ronda): referencia bibliográfica fijada — Smart Freight Centre (2025), GLEC Framework v3.2, alineado a ISO 14083, oct-2025, smartfreightcentre.org (verificado de primera mano en la segunda ronda). Se mantiene la decisión de producto: el motor sigue en t-km y la advertencia TEU-km de maritimo_contenedor queda vigente.'
WHERE codigo = 'glec_v3'
  AND estado = 'avalada_referencial'
  AND notas NOT LIKE '%tercera ronda%';

-- 6) Corrección de etiqueta en vuelos (ver encabezado, punto 2). El factor
--    numérico NO cambia — solo el texto deja de afirmar "sin forzamiento".
UPDATE motor_categorias SET
  fuente = 'DEFRA — vuelo corto, CON forzamiento radiativo: 0,15 kgCO2e por pasajero-km (etiqueta corregida en diligencia 2026-08, tercera ronda: el valor calza con los factores CON forzamiento de las ediciones 2021-2024; la etiqueta anterior "sin forzamiento" era inconsistente con la cifra). Referencial — validar contra la planilla DESNZ 2026 (que corrigió los factores aéreos a la baja; ~+19% de sobrestimación estimada por fuentes secundarias) y confirmar la fila exacta (economy vs average passenger). · Factor por gasto: proxy interno referencial, sin cita externa.',
  updated_at = now()
WHERE codigo = 'vuelo_corto'
  AND activo = true
  AND fuente LIKE '%sin forzamiento radiativo%';

UPDATE motor_categorias SET
  fuente = 'DEFRA — vuelo largo, CON forzamiento radiativo: 0,19 kgCO2e por pasajero-km (etiqueta corregida en diligencia 2026-08, tercera ronda: el valor calza con los factores CON forzamiento de las ediciones 2021-2024; la etiqueta anterior "sin forzamiento" era inconsistente con la cifra). Referencial — validar contra la planilla DESNZ 2026 (que corrigió los factores aéreos a la baja; ~+62% de sobrestimación estimada por fuentes secundarias) y confirmar la fila exacta (economy vs average passenger: 0,19 calza con average, no con economy). · Factor por gasto: proxy interno referencial, sin cita externa.',
  updated_at = now()
WHERE codigo = 'vuelo_largo'
  AND activo = true
  AND fuente LIKE '%sin forzamiento radiativo%';

-- 7) Primera diligencia de transporte_modos (Cat. 7): citas concretas en el
--    texto de fuente, factores numéricos intactos.
UPDATE transporte_modos SET
  fuente = 'DEFRA/DESNZ GHG Conversion Factors 2026, business travel land ("average car"; DEFRA publica por vehículo-km — como pasajero-km asume 1 ocupante). Referencial — validar con la planilla abierta (diligencia 2026-08, tercera ronda).',
  updated_at = now()
WHERE codigo = 'auto' AND fuente NOT LIKE '%tercera ronda%';

UPDATE transporte_modos SET
  fuente = 'Proxy interno sicr3p, sin cita externa (no existe análogo DEFRA por pasajero-km para camioneta compartida) — editable; misma condición declarada que otros proxies internos del motor (diligencia 2026-08, tercera ronda).',
  updated_at = now()
WHERE codigo = 'camioneta' AND fuente NOT LIKE '%tercera ronda%';

UPDATE transporte_modos SET
  fuente = 'DEFRA/DESNZ GHG Conversion Factors 2026, business travel land ("national rail"). Referencial — la edición 2026 lo bajó ~13% (primera actualización desde 2021): validar y actualizar con la planilla abierta (diligencia 2026-08, tercera ronda).',
  updated_at = now()
WHERE codigo = 'tren' AND fuente NOT LIKE '%tercera ronda%';

UPDATE transporte_modos SET
  fuente = 'DEFRA/DESNZ GHG Conversion Factors 2026, business travel land ("coach"). Referencial — la edición 2026 lo subió ~42% (datos nuevos de operador): el factor actual queda subestimado, validar y actualizar con la planilla abierta (diligencia 2026-08, tercera ronda).',
  updated_at = now()
WHERE codigo = 'bus' AND fuente NOT LIKE '%tercera ronda%';

UPDATE transporte_modos SET
  fuente = 'DEFRA/DESNZ GHG Conversion Factors 2026, business travel air ("domestic flight", promedio pasajero, CON forzamiento radiativo). Referencial — 2026 publica 0,229 kgCO2e/pkm (secundario): el factor actual queda ~+7% arriba, validar con la planilla abierta (diligencia 2026-08, tercera ronda).',
  updated_at = now()
WHERE codigo = 'avion' AND fuente NOT LIKE '%tercera ronda%';

-- 8) Congelar una versión del motor con estos cambios de texto — mismo
--    patrón que 075/081 (los informes citan el snapshot, no la tabla viva).
DO $$
DECLARE
  v_id INT;
BEGIN
  IF EXISTS (SELECT 1 FROM motor_versiones WHERE nota LIKE 'Migración 085%') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'motor_versiones') THEN
    RETURN;
  END IF;

  INSERT INTO motor_versiones (nota, origen)
  VALUES (
    'Migración 085: tercera ronda de diligencia de fuentes metodológicas — ' ||
    'ninguna fuente promovida (verificación de primera mano sigue bloqueada por red); ' ||
    'defra_2024 actualizada a la edición DESNZ 2026; corrección de etiqueta de ' ||
    'forzamiento radiativo en vuelo_corto/vuelo_largo (los valores son CON forzamiento); ' ||
    'primera diligencia de transporte_modos (Cat. 7) con citas DEFRA 2026 y camioneta ' ||
    'declarada proxy interno. Factores numéricos sin cambios.',
    'edicion_manual'
  )
  RETURNING id INTO v_id;

  INSERT INTO motor_categorias_version (
    version_id, codigo, nombre, unidad_fisica, factor_fisico_kgco2e,
    factor_gasto_kgco2e_clp1000, palabras_clave, fuente, activo, alcance_ghg,
    fuente_organismo, fuente_documento, fuente_version_anio
  )
  SELECT
    v_id, mc.codigo, mc.nombre, mc.unidad_fisica, mc.factor_fisico_kgco2e,
    mc.factor_gasto_kgco2e_clp1000, mc.palabras_clave, mc.fuente, mc.activo, mc.alcance_ghg,
    f.organismo, f.documento, f.version_anio
  FROM motor_categorias mc
  LEFT JOIN fuentes_metodologicas f ON f.id = mc.fuente_metodologica_id;
END $$;
