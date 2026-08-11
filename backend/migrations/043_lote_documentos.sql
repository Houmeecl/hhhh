-- ============================================================
-- 043: documentos múltiples por lote (Pasaporte Bioceánico / Carga
-- Bioceánica). Hasta ahora un lote_eslabon solo podía vincular UN
-- documento (documento_corredor_id opcional, migración 023) — nunca
-- varios. Esta tabla es la brecha real: agrupar factura, packing list,
-- carta de porte, MIC/DTA, certificado de origen, SAG, seguro, pesaje,
-- fotos y comprobantes de frontera bajo un mismo lote (el "expediente").
--
-- Cadena de hash PROPIA (doc_ultimo_hash/doc_n_documentos en el lote),
-- separada de la cadena de custodia de lote_eslabones — subir un
-- documento nunca toca el hash de los eslabones, y viceversa. Mismo
-- patrón de aislamiento que cuentas_naturales (migración 029).
--
-- Cola de revisión (estado='pendiente_revision' + archivo_pendiente):
-- a diferencia de documentos_rechazados (que por diseño NUNCA guarda el
-- binario — ver migración 030), aquí SÍ se retiene temporalmente el
-- archivo para que un humano de sicrep pueda revisarlo y corregir su
-- clasificación antes de aceptarlo o descartarlo. Es una excepción
-- deliberada y acotada a este flujo (documentos de una Carga Bioceánica
-- capturados por la agencia de aduanas) — el flujo público /cargar de
-- autoservicio sigue exactamente igual (rechazo 422, sin revisión).
-- El binario se borra al resolver la revisión (aprobado o rechazado):
-- nunca queda un binario huérfano.
-- ============================================================

ALTER TABLE lotes_minerales ADD COLUMN IF NOT EXISTS doc_ultimo_hash TEXT NOT NULL DEFAULT repeat('0', 64);
ALTER TABLE lotes_minerales ADD COLUMN IF NOT EXISTS doc_n_documentos INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS lote_documentos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id           UUID NOT NULL REFERENCES lotes_minerales(id) ON DELETE CASCADE,
  eslabon_id        UUID REFERENCES lote_eslabones(id),
  tipo_documento    TEXT NOT NULL CHECK (tipo_documento IN
                       ('factura', 'packing_list', 'carta_porte', 'mic_dta', 'cert_origen',
                        'sag', 'seguro', 'pesaje', 'foto', 'comprobante_frontera', 'otro')),
  archivo_original  TEXT NOT NULL,
  extension         TEXT,
  tamano_bytes      BIGINT,
  sha256            TEXT NOT NULL,
  estado            TEXT NOT NULL DEFAULT 'leido'
                       CHECK (estado IN ('leido', 'sin_texto', 'pendiente_revision', 'rechazado')),
  etapa_lectura     TEXT,
  archivo_pendiente BYTEA,
  visibilidad       TEXT NOT NULL DEFAULT 'publico' CHECK (visibilidad IN ('publico', 'cadena', 'privado')),
  datos             JSONB NOT NULL DEFAULT '{}',
  nonce             TEXT NOT NULL,
  hash_documento    TEXT NOT NULL,
  hash_anterior     TEXT NOT NULL,
  hash_cadena       TEXT NOT NULL,
  subido_por        UUID,
  revisado_por      UUID,
  revisado_en       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lote_documentos_lote ON lote_documentos(lote_id, created_at);
CREATE INDEX IF NOT EXISTS idx_lote_documentos_eslabon ON lote_documentos(eslabon_id);
CREATE INDEX IF NOT EXISTS idx_lote_documentos_pendientes ON lote_documentos(estado) WHERE estado = 'pendiente_revision';
