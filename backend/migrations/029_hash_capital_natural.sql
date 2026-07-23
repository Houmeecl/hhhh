-- ============================================================
-- sicr3p — Cadena de hash propia por cuenta de Capital Natural.
--
-- Cada cuenta (AGUA, ENER, CO2E, MATR, SUEL, BIOD) es un conjunto
-- acotado y autocontenido, igual que un lote de pasaporte de origen
-- (migración 021): se le da su propio génesis y su propia mini-cadena
-- de movimientos, en vez de mezclarla con la cadena global de
-- facturas (que inflaría esa cadena con eventos de otro dominio y
-- complicaría la verificación completa).
-- ============================================================

ALTER TABLE cuentas_naturales ADD COLUMN IF NOT EXISTS ultimo_hash TEXT NOT NULL DEFAULT repeat('0', 64);
ALTER TABLE cuentas_naturales ADD COLUMN IF NOT EXISTS n_eslabones INT  NOT NULL DEFAULT 0;

ALTER TABLE movimientos_naturales ADD COLUMN IF NOT EXISTS hash_documento TEXT;
ALTER TABLE movimientos_naturales ADD COLUMN IF NOT EXISTS hash_anterior  TEXT;
ALTER TABLE movimientos_naturales ADD COLUMN IF NOT EXISTS hash_cadena    TEXT;
ALTER TABLE movimientos_naturales ADD COLUMN IF NOT EXISTS eslabon        BIGINT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mov_nat_cuenta_eslabon ON movimientos_naturales(cuenta_codigo, eslabon);
