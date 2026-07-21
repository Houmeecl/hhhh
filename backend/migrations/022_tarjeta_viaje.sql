-- ============================================================
-- 022: Tarjeta de Viaje NFC/RFID + anclaje de lotes en la cadena global.
--
-- Contexto: Aduana Verde no puede obligar a la carga a pasar por puntos
-- fijos. El modelo se invierte: al inicio del corredor se ENTREGA una
-- tarjeta física (NFC NTAG / RFID) grabada con la URL /v/{serial}. La
-- tarjeta viaja CON la carga; cualquiera que la lea VE el pasaporte del
-- lote (solo lectura), y el PORTADOR autorizado (clave entregada junto
-- con la tarjeta, bcrypt como los terminales POS) registra PASOS que
-- entran como eslabones 'transporte' a la cadena del lote — la ruta es
-- la secuencia de pasos sellados con hash, sin GPS.
--
-- Al CERRAR el lote, su hash final se ancla como eslabón en la cadena
-- GLOBAL de sicr3p (cadena_anclajes comparte la secuencia de
-- cadena_estado con las facturas), y el expediente PDF sellado queda
-- como respaldo físico junto a la tarjeta.
-- ============================================================

CREATE TABLE IF NOT EXISTS tarjetas_viaje (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  serial            TEXT NOT NULL UNIQUE,   -- TV-XXXX, impreso en la tarjeta y grabado en su NDEF
  uid_fisico        TEXT UNIQUE,            -- UID de fábrica del chip (opcional, anti-clonación)
  lote_id           UUID REFERENCES lotes_minerales(id) ON DELETE SET NULL, -- NULL = en inventario
  portador          TEXT,                   -- transportista/empresa que la lleva (informativo)
  clave_hash        TEXT NOT NULL,          -- bcrypt; la clave viaja UNA sola vez (patrón POS/mandantes)
  activo            BOOLEAN NOT NULL DEFAULT true,
  ultima_actividad  TIMESTAMPTZ,
  pasos_registrados INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tarjetas_viaje_lote ON tarjetas_viaje (lote_id);

-- Anclajes: checkpoint del hash final de un lote CERRADO dentro de la
-- cadena global. Comparten la secuencia con facturas (cadena_estado se
-- avanza con lock FOR UPDATE), por eso TODA verificación global lee
-- facturas UNION cadena_anclajes ordenado por eslabon.
CREATE TABLE IF NOT EXISTS cadena_anclajes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id        UUID NOT NULL UNIQUE REFERENCES lotes_minerales(id) ON DELETE CASCADE,
  eslabon        INT NOT NULL UNIQUE,     -- posición en la cadena GLOBAL
  hash_documento TEXT NOT NULL,
  hash_anterior  TEXT NOT NULL,
  hash_cadena    TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
