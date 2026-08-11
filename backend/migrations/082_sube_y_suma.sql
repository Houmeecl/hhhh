-- ============================================================
-- sicr3p — "Sube y Suma": escaneo gamificado de boletas para equipos de
-- una empresa cliente (ver ETAPA3.md y el plan de la sesión). Reutiliza el
-- flujo real de carga (POST /api/sesiones, motor propio) — este módulo solo
-- puntúa sobre resultados ya calculados, nunca inventa CO2e propio.
--
-- Identidad: el "jugador" es la misma persona con magic link (rol
-- 'cliente' hoy), pero con una fila PERSISTENTE — el JWT de cliente actual
-- es efímero (7 días, sin fila en BD) y no puede acumular puntos entre
-- sesiones. Un jugador queda ligado al código de invitación (y por tanto a
-- la empresa) con el que se unió; el ranking nunca cruza empresas.
--
-- Recompensas 100% simbólicas por decisión explícita del usuario: insignias
-- y constancias de participación, nunca dinero ni descuentos reales (no
-- existe pasarela de pago conectada — mismo criterio que
-- COMPENSACION_HABILITADA).
-- ============================================================

-- Un código de campaña "Sube y Suma" es un codigos_acceso normal (mismo
-- cupo de documentos, misma validación de créditos) con este flag en true.
ALTER TABLE codigos_acceso ADD COLUMN IF NOT EXISTS modo_juego BOOLEAN NOT NULL DEFAULT false;

-- El magic link necesita saber con qué código se solicitó para poder crear
-- la fila de jugador en el momento en que se canjea el token — nullable:
-- un magic link normal (rol 'cliente', ver /mis-sesiones) no trae código.
ALTER TABLE tokens_magic ADD COLUMN IF NOT EXISTS codigo_id UUID REFERENCES codigos_acceso(id);

CREATE TABLE IF NOT EXISTS jugadores (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL,
  nombre          TEXT,
  codigo_id       UUID NOT NULL REFERENCES codigos_acceso(id),
  empresa         TEXT,
  puntos_totales  INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (email, codigo_id)
);
CREATE INDEX IF NOT EXISTS idx_jugadores_codigo ON jugadores(codigo_id);

CREATE TABLE IF NOT EXISTS misiones (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo             TEXT UNIQUE NOT NULL,
  nombre             TEXT NOT NULL,
  descripcion        TEXT,
  tipo               TEXT NOT NULL CHECK (tipo IN ('contar_documentos', 'alcanzar_puntos', 'contar_trayectos')),
  meta_valor         INT NOT NULL,
  puntos_recompensa  INT NOT NULL,
  activo             BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS misiones_progreso (
  jugador_id     UUID NOT NULL REFERENCES jugadores(id) ON DELETE CASCADE,
  mision_id      UUID NOT NULL REFERENCES misiones(id) ON DELETE CASCADE,
  progreso       INT NOT NULL DEFAULT 0,
  completada_at  TIMESTAMPTZ,
  PRIMARY KEY (jugador_id, mision_id)
);

-- Trayecto: hora de salida/llegada y medio de transporte usado para venir a
-- escanear/entregar documentos. Bonus de puntos para medios de bajo
-- carbono (caminando/bicicleta/transporte público) — coherente con lo que
-- el resto de sicr3p ya mide (Alcance 3, transporte por modo).
CREATE TABLE IF NOT EXISTS trayectos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jugador_id       UUID NOT NULL REFERENCES jugadores(id) ON DELETE CASCADE,
  salida_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  llegada_at       TIMESTAMPTZ,
  modo_transporte  TEXT CHECK (modo_transporte IN ('caminando', 'bicicleta', 'transporte_publico', 'auto', 'moto', 'otro')),
  puntos           INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trayectos_jugador ON trayectos(jugador_id);

-- Bitácora append-only de puntos. jugadores.puntos_totales es la suma
-- denormalizada (actualizada en la misma transacción, mismo patrón de
-- lock que el consumo de créditos en codigos_acceso) — esta tabla es la
-- fuente de verdad auditable.
CREATE TABLE IF NOT EXISTS puntos_eventos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jugador_id   UUID NOT NULL REFERENCES jugadores(id) ON DELETE CASCADE,
  tipo         TEXT NOT NULL CHECK (tipo IN ('documento_escaneado', 'mision_completada', 'trayecto_registrado')),
  puntos       INT NOT NULL,
  factura_id   UUID REFERENCES facturas(id) ON DELETE SET NULL,
  mision_id    UUID REFERENCES misiones(id) ON DELETE SET NULL,
  trayecto_id  UUID REFERENCES trayectos(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_puntos_eventos_jugador ON puntos_eventos(jugador_id);

CREATE TABLE IF NOT EXISTS recompensas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo         TEXT UNIQUE NOT NULL,
  nombre         TEXT NOT NULL,
  descripcion    TEXT,
  costo_puntos   INT NOT NULL,
  tipo           TEXT NOT NULL CHECK (tipo IN ('insignia', 'constancia')),
  activo         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS canjes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jugador_id       UUID NOT NULL REFERENCES jugadores(id) ON DELETE CASCADE,
  recompensa_id    UUID NOT NULL REFERENCES recompensas(id),
  puntos_gastados  INT NOT NULL,
  serial           TEXT UNIQUE,
  hash             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_canjes_jugador ON canjes(jugador_id);

-- ---------- Seed: misiones y recompensas simbólicas ----------
INSERT INTO misiones (codigo, nombre, descripcion, tipo, meta_valor, puntos_recompensa) VALUES
  ('primeros_5', 'Primeros pasos', 'Escanea 5 documentos', 'contar_documentos', 5, 50),
  ('primeros_20', 'Racha de datos', 'Escanea 20 documentos', 'contar_documentos', 20, 150),
  ('primer_trayecto_verde', 'Llegada verde', 'Registra un trayecto en bicicleta, caminando o transporte público', 'contar_trayectos', 1, 30)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO recompensas (codigo, nombre, descripcion, costo_puntos, tipo) VALUES
  ('insignia_nivel_2', 'Insignia Nivel 2', 'Insignia digital de reconocimiento — sin valor monetario.', 100, 'insignia'),
  ('constancia_participacion', 'Constancia de participación Sube y Suma', 'Constancia de participación interna emitida por sicr3p; no constituye una certificación acreditada de terceros.', 300, 'constancia')
ON CONFLICT (codigo) DO NOTHING;
