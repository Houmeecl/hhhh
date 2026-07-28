-- ============================================================
-- 053: retención y purga de datos personales.
--
-- Hasta ahora nada se borraba nunca. La Ley 21.719 pide conservar los
-- datos personales solo mientras dure la finalidad que los justifica, así
-- que aparece una purga periódica (services/retencion.js).
--
-- No hay tablas de negocio nuevas: lo que se agrega es el índice que la
-- purga necesita para no recorrer el log entero, y la bitácora de lo que
-- efectivamente corrió — porque la ley no pide tener una política, pide
-- poder demostrar que se aplica.
--
-- Nada de lo que la purga toca está encadenado por hash. Las facturas,
-- las declaraciones REP y los movimientos de Capital Natural quedan
-- fuera por diseño: borrar o editar una fila encadenada invalidaría
-- todos los eslabones posteriores. Ver services/inventarioDatos.js.
-- ============================================================

-- La purga busca filas viejas que todavía tienen IP. El índice parcial
-- es chico —solo las no anonimizadas— y se va encogiendo solo a medida
-- que la purga avanza.
CREATE INDEX IF NOT EXISTS idx_actividad_ip_pendiente
  ON actividad_log(created_at) WHERE ip IS NOT NULL;

CREATE TABLE IF NOT EXISTS purgas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'automatica' (el temporizador) o 'manual' (alguien la pidió del panel)
  origen      TEXT NOT NULL DEFAULT 'automatica'
                CHECK (origen IN ('automatica', 'manual')),
  usuario_id  UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  -- Detalle por tarea: cuántas filas anonimizó o borró cada una.
  resultado   JSONB NOT NULL DEFAULT '{}',
  filas       INT NOT NULL DEFAULT 0,
  duracion_ms INT,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purgas_created ON purgas(created_at DESC);
