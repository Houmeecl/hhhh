-- ============================================================
-- Higiene metodológica de los factores del motor propio.
--
-- 1) La categoría legada 'agua' (0,344 — "mismo default de Capital
--    Natural", sin fuente externa) se DESACTIVA a favor de
--    'agua_potable' (0,41 — DEFRA 2024, citada). Sus palabras clave
--    genéricas se traspasan para no perder clasificación.
-- 2) 'materiales' deja de atribuirle a GHG Protocol su factor FÍSICO
--    (el estándar avala el método por gasto, no el 1,5 kg/kg propio).
-- 3) 'electricidad' documenta el origen primario real del factor
--    (CEN — SEN), difundido por HuellaChile (MMA).
-- 4) Todos los factores por gasto quedan marcados explícitamente como
--    proxy interno referencial: NUNCA se inventa una cita.
--
-- Idempotente y respetuosa de ediciones del admin: cada UPDATE lleva
-- una guardia con la firma textual del seed (010/018) — si el admin
-- ya editó la fila desde el panel, no se pisa. Se re-ejecuta en cada
-- arranque como el resto de migrations/*.sql.
-- ============================================================

-- 1) Desactivar la categoría 'agua' legada (solo si sigue siendo la del seed).
UPDATE motor_categorias SET activo = false, updated_at = now()
WHERE codigo = 'agua'
  AND activo = true
  AND fuente LIKE 'Factor referencial agua potable — mismo default%';

-- Traspaso de keywords genéricas a agua_potable (dedupe, patrón 026).
UPDATE motor_categorias SET
  palabras_clave = (SELECT array_agg(DISTINCT x) FROM unnest(
    palabras_clave || ARRAY['agua','hidrico','hídrico','potable','sanitario']
  ) x),
  updated_at = now()
WHERE codigo = 'agua_potable'
  AND NOT (palabras_clave @> ARRAY['hidrico']);

-- 2) materiales: fuente honesta (guardia por firma textual del seed 010 —
--    si el admin ya reescribió la fuente, se respeta su texto).
UPDATE motor_categorias SET
  fuente = 'Factor físico: proxy interno sicr3p, sin fuente externa — validar antes de uso contractual. Método por gasto avalado por GHG Protocol (spend-based).',
  updated_at = now()
WHERE codigo = 'materiales'
  AND fuente = 'Factor genérico de insumos — mismo default de Capital Natural';

-- 2b) FK de materiales a NULL — statement SEPARADO y re-ejecutable en cada
--     arranque: la 018 vuelve a vincular ghg_protocol_2004 cuando ve la FK
--     en NULL (su guardia no distingue "nunca vinculada" de "anulada aquí"),
--     y como esta migración corre DESPUÉS, la anula de nuevo. Solo mientras
--     la fuente siga siendo el texto proxy de arriba: si el admin reescribe
--     la fuente, se respeta lo que haya decidido.
UPDATE motor_categorias SET
  fuente_metodologica_id = NULL,
  updated_at = now()
WHERE codigo = 'materiales'
  AND fuente LIKE 'Factor físico: proxy interno sicr3p, sin fuente externa%'
  AND fuente_metodologica_id = (SELECT id FROM fuentes_metodologicas WHERE codigo = 'ghg_protocol_2004');

-- 3) electricidad: origen primario CEN, difundido por HuellaChile.
UPDATE motor_categorias SET
  fuente = 'CEN — factor de emisión SEN 2023 (0,2421 kgCO2e/kWh), difundido por HuellaChile (MMA). Referencial — validar contra la edición vigente.',
  updated_at = now()
WHERE codigo = 'electricidad'
  AND fuente = 'HuellaChile (MMA) — SEN 2023: 0,2421 kgCO2e/kWh';

-- 4) Nota de proxy en los factores por gasto DEL SEED que aún no la llevan.
--    (Después de 2 y 3 para no duplicarla en materiales.)
--    Acotada a los códigos sembrados por 010/018: una categoría futura
--    creada por el admin con cita externa legítima de su factor por gasto
--    NO debe recibir este sello. La guardia NOT LIKE '%proxy%' también
--    salta las filas que ya declaran proxy con otras palabras (R-134a).
UPDATE motor_categorias SET
  fuente = fuente || ' · Factor por gasto: proxy interno referencial, sin cita externa.',
  updated_at = now()
WHERE factor_gasto_kgco2e_clp1000 IS NOT NULL
  AND codigo IN ('electricidad','combustible','transporte','materiales','agua','servicios',
                 'gas_natural','glp','kerosene_jet','refrigerante_r134a','refrigerante_r410a',
                 'residuos_relleno','agua_potable','vuelo_corto','vuelo_largo','maritimo_contenedor')
  AND fuente NOT LIKE '%proxy%';

-- Limitación conocida (deuda registrada, sin daño hoy): las guardias del
-- traspaso de keywords (statement del bloque 1) y de esta nota usan
-- marcadores del propio cambio ('hidrico' presente / 'proxy' presente),
-- no firma del seed — si el admin borra el marcador a mano, el arranque
-- siguiente lo re-aplica. Editar la fila desde el panel con otro texto
-- (sin el marcador exacto) NO se ve afectado.
