-- ============================================================
-- 089: actualiza el factor de la cuenta AGUA de Capital Natural al
-- valor vigente citado — cierra el mismo bug de auditoría que arregló
-- services/capitalNatural.js (switch por categoria_codigo en vez de
-- nombre) y src/seed.js (nuevas instalaciones).
--
-- cuentas_naturales.factores.agua_kgco2e_m3 seguía en 0,344 — el mismo
-- número que motor_categorias usaba para la categoría 'agua', DESACTIVADA
-- por la migración 031 en favor de 'agua_potable' (0,41, DEFRA 2024,
-- citado). 0,344 no tiene fuente vigente: es un remanente. Esta cuenta es
-- independiente de motor_categorias (factor propio, editable desde el
-- panel admin), así que la 031 no la tocó — quedó desalineada.
--
-- Idempotente y respetuosa de ediciones del admin: mismo patrón de
-- guardia-por-firma que la 031 — solo actualiza si el factor sigue
-- siendo exactamente el 0,344 legado (si el admin ya lo cambió a otra
-- cosa desde el panel, esta migración no lo pisa).
-- ============================================================

UPDATE cuentas_naturales
   SET factores = jsonb_set(factores, '{agua_kgco2e_m3}', '0.41'::jsonb),
       fuente = 'DEFRA 2024 — agua potable (red)',
       updated_at = now()
 WHERE codigo = 'AGUA'
   AND (factores->>'agua_kgco2e_m3')::numeric = 0.344;
