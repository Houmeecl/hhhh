-- ============================================================
-- Atribución del plan de cuentas de Capital Natural: el copy citaba
-- "SEEA (ONU)" a secas, como si fuera solo el estándar internacional
-- genérico. Chile tiene su propia adopción oficial de ese estándar —
-- el Plan Nacional de Cuentas Ambientales, del Comité de Capital
-- Natural (MMA, Hacienda, Economía) — y el copy debe dar crédito a
-- ambos, no solo al marco de la ONU.
--
-- Idempotente y respetuosa de ediciones del admin (mismo patrón que
-- 031_higiene_metodologica.sql): cada UPDATE lleva una guardia con el
-- texto exacto del seed anterior — si el admin ya reescribió `marco`
-- desde el panel, no se pisa.
-- ============================================================

UPDATE cuentas_naturales SET marco = 'Plan Nacional de Cuentas Ambientales de Chile (MMA) — SEEA Marco Central (ONU)', updated_at = now()
WHERE codigo IN ('AGUA','ENER') AND marco = 'SEEA Marco Central (ONU)';

UPDATE cuentas_naturales SET marco = 'Plan Nacional de Cuentas Ambientales de Chile (MMA) — SEEA / Ley REP', updated_at = now()
WHERE codigo = 'MATR' AND marco = 'SEEA / Ley REP';

UPDATE cuentas_naturales SET marco = 'Plan Nacional de Cuentas Ambientales de Chile (MMA) — SEEA Cuentas de Ecosistemas', updated_at = now()
WHERE codigo = 'SUEL' AND marco = 'SEEA Cuentas de Ecosistemas';

UPDATE cuentas_naturales SET marco = 'Plan Nacional de Cuentas Ambientales de Chile (MMA) — TNFD / SEEA EA', updated_at = now()
WHERE codigo = 'BIOD' AND marco = 'TNFD / SEEA EA';
