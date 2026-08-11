-- ============================================================
-- Diligencia de vigencia de las 7 fuentes metodológicas (018) +
-- higiene de la cita visible en 'combustible'/'transporte' (010).
--
-- 1) Promoción a 'validada_oficial' SOLO de las fuentes que la
--    diligencia (2026-08, ver notas) confirmó como la edición vigente
--    hoy, sin revisión pendiente: ipcc_ar6_gwp y ghg_protocol_2004.
--    ipcc_2006_v2 sigue vigente como base pero está incompleta sin el
--    Refinamiento 2019 (IPCC, 49ª sesión) — se deja su nota al día,
--    sin promover, para no afirmar más certeza de la verificada.
-- 2) Las otras 4 (defra_2024, mma_huellachile, cen_sen, glec_v3) NO se
--    promueven: la diligencia encontró ediciones más nuevas (o, en el
--    caso de cen_sen, cifras contradictorias entre fuentes) — se deja
--    una nota accionable en cada una para que un admin las actualice
--    antes de promoverlas. Honestidad primero: nunca se marca oficial
--    lo que no se pudo confirmar vigente.
-- 3) 'combustible': el factor (2,68 kgCO2/L) ya calza con el cálculo
--    IPCC 2006 estándar y ya está vinculado a ipcc_2006_v2 (018) — solo
--    faltaba que el texto visible en pantalla lo dijera.
-- 4) 'transporte' (legacy, km): su factor no calza en unidades con
--    GLEC v3 (t·km, no vehículo-km) — vacío metodológico real, no
--    cosmético. Se desactiva (activo=false, sin borrar histórico) a
--    favor de transporte_modos (Cat. 7 GHG, factores DEFRA por modo) —
--    mismo patrón que 031 usó para desvincular 'materiales'.
--
-- Idempotente: cada UPDATE lleva guardia por estado/texto actual, mismo
-- patrón que 031_higiene_metodologica.sql.
-- ============================================================

-- 1) Promoción de las 2 fuentes confirmadas vigentes.
UPDATE fuentes_metodologicas SET
  estado = 'validada_oficial',
  notas = notas || ' Confirmada vigente en diligencia 2026-08 (sin edición posterior publicada).'
WHERE codigo = 'ipcc_ar6_gwp'
  AND estado = 'avalada_referencial';

UPDATE fuentes_metodologicas SET
  estado = 'validada_oficial',
  notas = notas || ' Confirmada vigente en diligencia 2026-08 (próxima edición del GHG Protocol aún no publicada, prevista ~2027).'
WHERE codigo = 'ghg_protocol_2004'
  AND estado = 'avalada_referencial';

-- ipcc_2006_v2: vigente como base, pero incompleta sin el Refinamiento
-- 2019 — se documenta, no se promueve.
UPDATE fuentes_metodologicas SET
  notas = 'Factores de combustión estacionaria y móvil. Avala la metodología, no a sicr3p. Diligencia 2026-08: la guía 2006 sigue vigente como base oficial del IPCC, complementada (no reemplazada) por el 2019 Refinement (adoptado 12-may-2019, IPCC 49ª sesión) — https://www.ipcc.ch/report/2019-refinement-to-the-2006-ipcc-guidelines-for-national-greenhouse-gas-inventories/. Referencial hasta citar también el Refinamiento.'
WHERE codigo = 'ipcc_2006_v2'
  AND estado = 'avalada_referencial'
  AND notas NOT LIKE '%Diligencia 2026-08%';

-- 2) Las 4 con edición más nueva encontrada: se deja nota accionable,
--    NO se promueven.
UPDATE fuentes_metodologicas SET
  notas = notas || ' Diligencia 2026-08: existen ediciones posteriores (DEFRA/DESNZ 2025 y 2026, esta última con cambio metodológico grande en el factor eléctrico UK) — actualizar version_anio/url a la edición vigente antes de promover.'
WHERE codigo = 'defra_2024'
  AND estado = 'avalada_referencial'
  AND notas NOT LIKE '%Diligencia 2026-08%';

UPDATE fuentes_metodologicas SET
  notas = notas || ' Diligencia 2026-08: existe una actualización de factores 2024 (HuellaChile, publicada ~feb-2025) posterior a la citada aquí — confirmar y actualizar version_anio/url antes de promover.'
WHERE codigo = 'mma_huellachile'
  AND estado = 'avalada_referencial'
  AND notas NOT LIKE '%Diligencia 2026-08%';

UPDATE fuentes_metodologicas SET
  notas = notas || ' Diligencia 2026-08: hay reportes del CEN posteriores a 2023 (incl. reporte anual 2024) y las cifras de búsqueda fueron contradictorias entre fuentes — un admin con acceso directo a coordinador.cl/energiaabierta.cl debe confirmar el valor vigente antes de promover.'
WHERE codigo = 'cen_sen'
  AND estado = 'avalada_referencial'
  AND notas NOT LIKE '%Diligencia 2026-08%';

UPDATE fuentes_metodologicas SET
  notas = notas || ' Diligencia 2026-08: Smart Freight Centre publicó v3.1 (mar-2025) y v3.2 (oct-2025, alineada a ISO 14083) posteriores a la v3 citada aquí — revalidar factores por modo y actualizar version_anio/url antes de promover.'
WHERE codigo = 'glec_v3'
  AND estado = 'avalada_referencial'
  AND notas NOT LIKE '%Diligencia 2026-08%';

-- 3) 'combustible': cita explícita en el texto visible (guardia por
--    prefijo del seed 010, tolerante al sufijo "proxy por gasto" que
--    031_higiene_metodologica.sql ya le agregó — si el admin reescribió
--    la fuente con otro texto, no calza y se respeta lo suyo). El sufijo
--    de proxy se conserva: el factor FÍSICO ahora cita IPCC, pero el
--    factor por GASTO sigue siendo un proxy interno sin cita externa.
UPDATE motor_categorias SET
  fuente = 'IPCC 2006 Guidelines Vol. 2 (Energía) — factor de combustión diésel: 2,68 kgCO2/L. Ajustable por tipo de combustible. · Factor por gasto: proxy interno referencial, sin cita externa.',
  updated_at = now()
WHERE codigo = 'combustible'
  AND fuente LIKE 'Factor representativo diésel — ajustable por tipo de combustible%';

-- 4) 'transporte' (legacy, km): desactivar a favor de transporte_modos
--    (Cat. 7, DEFRA por modo) — el factor no calza en unidades con
--    GLEC v3 (t·km, no vehículo-km). Mismo criterio de guardia tolerante
--    al sufijo de proxy que combustible.
UPDATE motor_categorias SET
  activo = false,
  fuente = 'Factor referencial transporte de carga por km — reemplazado por "Transporte Cat. 7" (transporte_modos), con factores DEFRA por modo. Se desactiva por vacío metodológico: GLEC v3 factura en t·km, no en vehículo-km.',
  updated_at = now()
WHERE codigo = 'transporte'
  AND activo = true
  AND fuente LIKE 'Factor referencial transporte de carga — validar por modo%';

-- 5) Congelar una versión del motor con estos cambios — igual que hace
--    PUT /admin/motor/fuentes/:id y PUT /admin/motor/categorias/:codigo
--    (services/motorVersiones.js: crearVersion). Sin esto, los cambios
--    de arriba quedarían en `motor_categorias`/`fuentes_metodologicas`
--    pero los informes seguirían citando la versión congelada anterior
--    (facturas.motor_version_id apunta a la última versión al momento
--    del cálculo, no a la tabla en vivo). Guardado por nota: solo corre
--    una vez, igual que la semilla de 056_motor_versiones.sql.
DO $$
DECLARE
  v_id INT;
BEGIN
  IF EXISTS (SELECT 1 FROM motor_versiones WHERE nota LIKE 'Migración 075%') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'motor_versiones') THEN
    RETURN;
  END IF;

  INSERT INTO motor_versiones (nota, origen)
  VALUES (
    'Migración 075: diligencia de fuentes metodológicas (promoción a validada_oficial de '
    'ipcc_ar6_gwp y ghg_protocol_2004) + cita explícita de IPCC 2006 en combustible + '
    'desactivación de transporte legacy (reemplazada por transporte_modos, Cat. 7).',
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
