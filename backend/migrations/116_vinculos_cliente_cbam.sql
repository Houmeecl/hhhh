-- Vínculo explícito entre una empresa del libro privado y un lote de origen.
-- No se infiere por RUT, nombre ni código: un administrador confirma la
-- relación y su respaldo. El vínculo no modifica ni certifica el lote CBAM.

CREATE TABLE IF NOT EXISTS cliente_cbam_vinculos (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id            UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  lote_id               UUID NOT NULL REFERENCES lotes_minerales(id) ON DELETE RESTRICT,
  relacion              TEXT NOT NULL CHECK (relacion IN ('titular_lote','operador_instalacion','exportador','financiado')),
  referencia_respaldo   TEXT NOT NULL CHECK (length(trim(referencia_respaldo)) >= 3),
  observaciones         TEXT,
  estado                TEXT NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente','revocado')),
  confirmado_por        UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  confirmado_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  revocado_por          UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  revocado_at           TIMESTAMPTZ,
  motivo_revocacion     TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (estado = 'vigente' AND revocado_at IS NULL AND motivo_revocacion IS NULL)
    OR
    (estado = 'revocado' AND revocado_at IS NOT NULL AND length(trim(COALESCE(motivo_revocacion, ''))) >= 3)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cliente_cbam_vinculo_vigente
  ON cliente_cbam_vinculos(cliente_id, lote_id) WHERE estado = 'vigente';
CREATE INDEX IF NOT EXISTS idx_cliente_cbam_vinculos_cliente
  ON cliente_cbam_vinculos(cliente_id, estado, confirmado_at DESC);
