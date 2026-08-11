-- ============================================================
-- 025: Torre de control — flota y zona de estacionamiento.
--
-- Tercer destino de instrucción: 'estacionamiento' (la torre designa
-- una zona de espera/estacionamiento al chofer, ej. "Zona E-3, La
-- Negra"). La zona viaja en su propia columna para poder listarla y
-- filtrarla; sigue siendo texto operativo, no custodia.
-- ============================================================

ALTER TABLE torre_mensajes DROP CONSTRAINT IF EXISTS torre_mensajes_destino_check;
ALTER TABLE torre_mensajes ADD CONSTRAINT torre_mensajes_destino_check
  CHECK (destino IN ('puerto_seco', 'puerto', 'estacionamiento'));

ALTER TABLE torre_mensajes ADD COLUMN IF NOT EXISTS zona TEXT;
