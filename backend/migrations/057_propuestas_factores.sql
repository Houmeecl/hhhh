-- ============================================================
-- Propuestas de actualización de factores.
--
-- El botón «Actualizar» le pide a la IA que busque la versión vigente de
-- las fuentes ya registradas en `fuentes_metodologicas` (MMA HuellaChile,
-- IPCC, DEFRA, GLEC, GHG Protocol). Lo que devuelve NO entra al motor:
-- entra acá, como propuesta pendiente de aprobación humana.
--
-- La razón es la misma regla dura que ya rige en analisisIA.js: la IA
-- extrae y propone, el cálculo es 100% determinista y nunca lo decide un
-- modelo. Un factor de emisión que entró solo a producción porque un
-- modelo lo leyó en una página es exactamente lo que no se puede
-- defender ante un auditor. Aprobar una propuesta es lo que congela una
-- versión nueva del motor (migración 056).
-- ============================================================

CREATE TABLE IF NOT EXISTS propuestas_factores (
  id             SERIAL PRIMARY KEY,
  categoria_codigo TEXT NOT NULL,      -- a qué categoría del motor apunta
  campo          TEXT NOT NULL
                   CHECK (campo IN ('factor_fisico_kgco2e', 'factor_gasto_kgco2e_clp1000', 'fuente_version_anio')),
  valor_actual   TEXT,                 -- lo que hay hoy, para poder comparar
  valor_propuesto TEXT NOT NULL,
  -- De dónde salió. Sin URL no se puede verificar, y una propuesta que no
  -- se puede verificar no se aprueba: por eso la columna es NOT NULL.
  fuente_url     TEXT NOT NULL,
  fuente_titulo  TEXT,
  fuente_anio    TEXT,
  justificacion  TEXT,                 -- qué dijo el modelo, en sus palabras
  modelo         TEXT,                 -- qué modelo la produjo
  estado         TEXT NOT NULL DEFAULT 'pendiente'
                   CHECK (estado IN ('pendiente', 'aprobada', 'descartada')),
  -- Trazabilidad de la decisión humana: quién, cuándo y por qué.
  resuelta_por   UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  resuelta_at    TIMESTAMPTZ,
  motivo_resolucion TEXT,
  version_creada_id INT REFERENCES motor_versiones(id),  -- si se aprobó, qué versión salió
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_propuestas_factores_estado
  ON propuestas_factores(estado, created_at DESC);

-- Una sola propuesta pendiente por (categoría, campo): si se vuelve a
-- apretar «Actualizar» antes de resolver la anterior, se reemplaza en vez
-- de acumular duplicados que después nadie revisa. Índice parcial, mismo
-- patrón que las solicitudes ARCOP pendientes.
CREATE UNIQUE INDEX IF NOT EXISTS idx_propuestas_factores_pendiente
  ON propuestas_factores(categoria_codigo, campo) WHERE estado = 'pendiente';

-- Bitácora de cada corrida del buscador, exitosa o no. Sirve para el panel
-- de transparencia y para no dejar el botón como una caja negra.
CREATE TABLE IF NOT EXISTS actualizaciones_factores (
  id            SERIAL PRIMARY KEY,
  disparada_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  exito         BOOLEAN NOT NULL,
  motivo_error  TEXT,
  n_propuestas  INT NOT NULL DEFAULT 0,
  modelo        TEXT,
  tokens_entrada INT,
  tokens_salida  INT,
  latencia_ms   INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
