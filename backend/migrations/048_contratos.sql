-- ============================================================
-- 048: contrato de servicio por cliente.
--
-- Hasta ahora `clientes` guardaba el ESTADO del contrato
-- (estado_contrato, fecha_inicio, fecha_fin, plan) pero no existía el
-- contrato como documento: no había texto, ni PDF, ni registro de qué
-- versión de las condiciones aceptó cada empresa. Al alta de una empresa
-- se emite ahora un contrato en estado 'borrador'.
--
-- `datos` guarda una FOTO de las condiciones al momento de emitir (razón
-- social, RUT, plan, vigencia, tarifa referencial). No se lee del cliente
-- en vivo: si mañana cambia el plan, el contrato ya emitido debe seguir
-- diciendo lo que decía. Esa es toda la razón del snapshot.
--
-- NO se une a la cadena de hash global (`cadenaGlobal.js`). Esa cadena es
-- de documentos de contabilidad de carbono y trazabilidad; un contrato
-- comercial es de otra naturaleza y mezclarlo diluiría lo que la cadena
-- significa — misma decisión que se tomó con las constancias de
-- capacitación. Igual lleva `hash_documento`: sirve para detectar que el
-- PDF entregado corresponde a estas condiciones y no a otras.
-- ============================================================

CREATE TABLE IF NOT EXISTS contratos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id        UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  numero            TEXT NOT NULL UNIQUE,
  plantilla_version TEXT NOT NULL,
  estado            TEXT NOT NULL DEFAULT 'borrador'
                      CHECK (estado IN ('borrador', 'emitido', 'aceptado', 'anulado')),
  datos             JSONB NOT NULL DEFAULT '{}',
  hash_documento    TEXT NOT NULL,
  emitido_at        TIMESTAMPTZ,
  aceptado_at       TIMESTAMPTZ,
  aceptado_por      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contratos_cliente ON contratos(cliente_id, created_at DESC);

-- Un solo contrato vigente por cliente: 'anulado' no cuenta, así se puede
-- reemplazar un contrato por otro sin borrar el histórico.
CREATE UNIQUE INDEX IF NOT EXISTS uq_contratos_vigente
  ON contratos(cliente_id) WHERE estado <> 'anulado';
