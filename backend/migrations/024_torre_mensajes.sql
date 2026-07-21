-- ============================================================
-- 024: Torre de control — mensajes operativos al portador de la carga.
--
-- La torre (autenticada como terminal, rol 'pos') le envía una
-- instrucción al camión de un lote: dirigirse al PUERTO SECO (interior)
-- o al PUERTO (terminal marítimo). El portador la ve en su credencial
-- /v/{serial}; la torre pública /torre/{codigo} muestra el historial.
--
-- APPEND-ONLY: el historial es el estado y la instrucción vigente es la
-- última fila del lote. Los mensajes NO entran en la cadena de hash del
-- lote: son operación (dónde ir), no custodia (qué pasó) — un paso real
-- sigue existiendo solo como eslabón sellado.
-- ============================================================

CREATE TABLE IF NOT EXISTS torre_mensajes (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id  UUID NOT NULL REFERENCES lotes_minerales(id) ON DELETE CASCADE,
  destino  TEXT NOT NULL CHECK (destino IN ('puerto_seco', 'puerto')),
  nota     TEXT,                    -- opcional, <=200 (recortado en la ruta)
  emisor   TEXT,                    -- nombre del terminal que la envió
  creado   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_torre_mensajes_lote ON torre_mensajes (lote_id, creado DESC);
