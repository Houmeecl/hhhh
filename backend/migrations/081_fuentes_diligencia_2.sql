-- ============================================================
-- Segunda ronda de diligencia de fuentes metodológicas (2026-08), agente
-- `investigacion`. Retoma exactamente donde quedó 075_fuentes_diligencia.sql
-- para las 4 fuentes que quedaron pendientes (defra_2024, mma_huellachile,
-- cen_sen, glec_v3) + el caso ipcc_2006_v2/Refinamiento 2019 + la decisión
-- sobre los factores "por gasto".
--
-- Conclusión de esta ronda: NINGUNA fuente se promueve a validada_oficial.
-- Honestidad primero — el detalle de por qué queda en las notas de cada
-- fila. Resumen:
--   · defra_2024: ya existen ediciones 2025 y 2026 (la 2026 es la vigente
--     hoy); las cifras 2025 encontradas son de fuentes secundarias sin
--     verificar y hay una discrepancia sin resolver entre factores "con" y
--     "sin" forzamiento radiativo en vuelos.
--   · mma_huellachile: existe una actualización v3 (nov-2024) localizada
--     por URL, pero su contenido no se pudo leer (dominio bloqueado desde
--     este entorno) para confirmar el factor eléctrico.
--   · cen_sen: se repite el mismo problema que la ronda anterior — cifras
--     de búsqueda con sospecha fuerte de mezcla Chile/México (el acrónimo
--     "SEN" también lo usa el sistema eléctrico mexicano). Se identificó el
--     reporte anual 2024 del CEN por URL exacta, pero no se pudo leer.
--   · glec_v3: hallazgo nuevo, más profundo que "hay edición más nueva" —
--     v3.1 y v3.2 (verificadas de primera mano, sin paywall) ya NO publican
--     el factor de contenedores en kg/t-km sino en g CO2e/TEU-km. Eso es
--     una decisión de producto (cambiar de unidad o documentar la
--     conversión propia), no solo actualizar el año — se deja anotado en
--     la categoría 'maritimo_contenedor' para que no se repita la confusión.
--   · ipcc_2006_v2: la evidencia (de segunda mano) es consistente en que el
--     Refinamiento 2019 no toca combustión estacionaria/móvil — la nota de
--     075 ya lo documenta; no hay nada nuevo que agregar aquí.
--   · factores "por gasto": no existe una base EEIO chilena vigente y
--     granular citable (EXIOBASE no cubre Chile como país individual, solo
--     como parte de "Rest of Americas"; el único candidato chileno — Banco
--     Central, Estudio Nº 135, base 2017 — es antiguo, agregado por sector
--     y no mapeado a las categorías del motor). La declaración de "proxy
--     interno sin cita externa" ya está generalizada a casi todas las
--     categorías desde 031_higiene_metodologica.sql; solo faltaba
--     'materiales', que tenía un texto distinto que insinuaba un aval del
--     GHG Protocol sobre la cifra misma (y no solo sobre el método).
--
-- Idempotente: mismo patrón de guardia por texto/estado que 031 y 075.
-- ============================================================

-- 1) 'materiales': mismo texto de "proxy interno sin cita externa" que ya
--    tienen las demás categorías desde 031 — el texto anterior daba a
--    entender que el GHG Protocol avala la cifra (avala el MÉTODO
--    spend-based, no el número).
UPDATE motor_categorias SET
  fuente = 'Factor físico: proxy interno sicr3p, sin fuente externa — validar antes de uso contractual. Método por gasto: spend-based (GHG Protocol avala el método, no esta cifra) · Factor por gasto: proxy interno referencial, sin cita externa.',
  updated_at = now()
WHERE codigo = 'materiales'
  AND activo = true
  AND fuente = 'Factor físico: proxy interno sicr3p, sin fuente externa — validar antes de uso contractual. Método por gasto avalado por GHG Protocol (spend-based).';

-- 2) 'maritimo_contenedor': GLEC v3.1/v3.2 (verificadas de primera mano en
--    esta diligencia) ya no publican el factor de contenedores en t-km,
--    solo en TEU-km — dejar la advertencia explícita para que la próxima
--    actualización no repita el error de comparar unidades distintas.
UPDATE motor_categorias SET
  fuente = fuente || ' Diligencia 2026-08 (segunda ronda): GLEC v3.1/v3.2 ya no publican el factor de contenedores en t-km, solo en g CO2e/TEU-km — antes de actualizar este factor hay que decidir si se cambia la unidad de la categoría o se documenta la conversión TEU→tonelaje usada.',
  updated_at = now()
WHERE codigo = 'maritimo_contenedor'
  AND activo = true
  AND fuente NOT LIKE '%segunda ronda%';

-- 3) Notas de la segunda ronda en las 4 fuentes que siguen sin promoverse.
UPDATE fuentes_metodologicas SET
  notas = notas || ' Diligencia 2026-08 (segunda ronda): ya existe la edición 2026 (vigente hoy) además de la 2025 detectada en la primera ronda; las cifras 2025 encontradas para kerosene/Jet A-1, residuos y vuelos son de fuentes secundarias sin verificar contra la planilla oficial, y hay una discrepancia sin resolver entre factores "con" y "sin" forzamiento radiativo para vuelos. Revisar directamente la planilla 2026 en gov.uk antes de promover.'
WHERE codigo = 'defra_2024'
  AND estado = 'avalada_referencial'
  AND notas NOT LIKE '%segunda ronda%';

UPDATE fuentes_metodologicas SET
  notas = notas || ' Diligencia 2026-08 (segunda ronda): localizado el documento de actualización "HuellaChile-DCC-Factores-de-emision-nivel-basico_v3.pdf" (huellachile.mma.gob.cl, nov-2024), pero su contenido no se pudo leer desde este entorno (dominio bloqueado) para confirmar el factor eléctrico vigente. Falta que un admin con acceso directo lo descargue y compare.'
WHERE codigo = 'mma_huellachile'
  AND estado = 'avalada_referencial'
  AND notas NOT LIKE '%segunda ronda%';

UPDATE fuentes_metodologicas SET
  notas = notas || ' Diligencia 2026-08 (segunda ronda): localizado el "Reporte Anual de Desempeño del Sistema Eléctrico Nacional 2024" (Art. 72°-15) del CEN por URL exacta, pero no se pudo leer su contenido (dominio bloqueado). Se repite el mismo problema de la ronda anterior: aparecen cifras de búsqueda ("0,444 tCO2e/MWh") con sospecha fuerte de mezclar el SEN chileno con el "Sistema Eléctrico Nacional" mexicano (comparten la sigla) — NO usar esa cifra. Un admin con acceso directo a coordinador.cl debe extraer el valor real de la tabla del reporte 2024.'
WHERE codigo = 'cen_sen'
  AND estado = 'avalada_referencial'
  AND notas NOT LIKE '%segunda ronda%';

UPDATE fuentes_metodologicas SET
  notas = notas || ' Diligencia 2026-08 (segunda ronda): v3.1 (feb/mar-2025) y v3.2 (oct-2025, alineada a ISO 14083) verificadas de primera mano, sin paywall. Hallazgo más profundo que "hay edición nueva": ninguna de las dos publica ya el factor de contenedores en t-km, solo en g CO2e/TEU-km (Tabla "Sea transport emission intensity values – Container Vessels") — ver nota en la categoría motor_categorias.maritimo_contenedor. Actualizar esta fuente requiere antes decidir la unidad, no solo el año.'
WHERE codigo = 'glec_v3'
  AND estado = 'avalada_referencial'
  AND notas NOT LIKE '%segunda ronda%';

-- 4) Congelar una versión del motor con el cambio de texto de 'materiales'
--    y 'maritimo_contenedor' — mismo patrón que 075 (crearVersion manual).
DO $$
DECLARE
  v_id INT;
BEGIN
  IF EXISTS (SELECT 1 FROM motor_versiones WHERE nota LIKE 'Migración 081%') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'motor_versiones') THEN
    RETURN;
  END IF;

  INSERT INTO motor_versiones (nota, origen)
  VALUES (
    'Migración 081: segunda ronda de diligencia de fuentes metodológicas — ' ||
    'ninguna fuente promovida a validada_oficial; texto de materiales generalizado ' ||
    'a "proxy interno sin cita externa"; advertencia de unidad (t-km vs TEU-km) en ' ||
    'maritimo_contenedor.',
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
