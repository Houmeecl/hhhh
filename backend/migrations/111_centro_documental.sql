-- ============================================================
-- 111: Centro documental de expedientes.
-- Reusa `expedientes` como carpeta y agrega solo la capa que faltaba:
-- archivo original + hash + revisión/votación por usuario.
--
-- No reemplaza expediente_documentos: esa tabla sigue describiendo qué
-- evidencia respalda una venta/dato. `expediente_archivos` conserva el
-- archivo entregado para que pueda verse, revisarse y dejar historial.
-- ============================================================

CREATE TABLE IF NOT EXISTS expediente_archivos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expediente_id    UUID NOT NULL REFERENCES expedientes(id) ON DELETE CASCADE,
  categoria        TEXT NOT NULL DEFAULT 'otro'
                     CHECK (categoria IN (
                       'xml_combustible','reporte_gps','horometro','contrato',
                       'calculo','ficha_activo','otro'
                     )),
  descripcion      TEXT,
  archivo_original TEXT NOT NULL,
  mime_type        TEXT NOT NULL,
  extension        TEXT,
  tamano_bytes     BIGINT NOT NULL CHECK (tamano_bytes >= 0),
  sha256           TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  contenido        BYTEA NOT NULL,
  version          INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  subido_por       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (expediente_id, sha256)
);

CREATE INDEX IF NOT EXISTS idx_expediente_archivos_exp
  ON expediente_archivos (expediente_id, created_at DESC);

CREATE TABLE IF NOT EXISTS expediente_archivo_votos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  archivo_id  UUID NOT NULL REFERENCES expediente_archivos(id) ON DELETE CASCADE,
  usuario_id  TEXT NOT NULL,
  decision    TEXT NOT NULL CHECK (decision IN ('aprobar','observar','rechazar')),
  comentario  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (archivo_id, usuario_id)
);

CREATE INDEX IF NOT EXISTS idx_expediente_archivo_votos_archivo
  ON expediente_archivo_votos (archivo_id);
