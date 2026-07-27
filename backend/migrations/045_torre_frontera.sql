-- ============================================================
-- 045: cuarto destino de instrucción — 'frontera'. El Corredor
-- Bioceánico cruza tres pasos fronterizos (Ponta Porã BR/PY, Pozo Hondo
-- PY/AR, Paso de Jama AR/CL, ver PUNTOS_CORREDOR en frontend/src/lib/
-- corredor.js) — se reutiliza la columna `zona` ya existente (mismo
-- patrón que 'estacionamiento') para indicar cuál de los tres.
-- Sigue sin entrar en la cadena de hash del lote: es guía operativa de
-- la torre, no un eslabón sellado de custodia.
-- ============================================================

ALTER TABLE torre_mensajes DROP CONSTRAINT IF EXISTS torre_mensajes_destino_check;
ALTER TABLE torre_mensajes ADD CONSTRAINT torre_mensajes_destino_check
  CHECK (destino IN ('puerto_seco', 'puerto', 'estacionamiento', 'frontera'));
