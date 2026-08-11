-- ============================================================
-- sicr3p — "Reciclaje en punto limpio" (Sube y Suma): el admin crea
-- puntos limpios con cartel QR; el jugador escanea el QR, fotografía los
-- envases que entrega y la IA los cuenta por material. La foto NUNCA se
-- persiste: solo el resultado validado. Puntos 100% simbólicos, igual que
-- el resto del juego. Además, GPS obligatorio en trayectos: se guardan
-- coordenadas y distancia (la fórmula de puntos del trayecto no cambia).
-- ============================================================

-- Punto limpio: lugar físico de entrega de envases. codigo_id NULL = vale
-- para todas las campañas; con valor, solo para jugadores de esa campaña.
-- lat/lng nullable: sin coordenadas no se exige cercanía (queda a criterio
-- del admin cargarlas); con ellas, el backend exige estar cerca.
CREATE TABLE IF NOT EXISTS puntos_limpios (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      TEXT NOT NULL,
  direccion   TEXT,
  lat         NUMERIC(9,6),
  lng         NUMERIC(9,6),
  token       TEXT UNIQUE NOT NULL,
  codigo_id   UUID REFERENCES codigos_acceso(id) ON DELETE SET NULL,
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Registro de una entrega validada por la IA. `envases` es el JSONB
-- [{material, cantidad}] que validó el backend (nunca lo que declaró el
-- jugador — no existe declaración manual en este flujo).
CREATE TABLE IF NOT EXISTS reciclajes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jugador_id       UUID NOT NULL REFERENCES jugadores(id) ON DELETE CASCADE,
  punto_limpio_id  UUID NOT NULL REFERENCES puntos_limpios(id),
  lat              NUMERIC(9,6) NOT NULL,
  lng              NUMERIC(9,6) NOT NULL,
  distancia_m      NUMERIC,          -- NULL si el punto no tiene coordenadas
  envases          JSONB NOT NULL,
  total_envases    INT NOT NULL,
  puntos           INT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reciclajes_jugador ON reciclajes(jugador_id, created_at);

-- puntos_eventos: nuevo tipo 'envase_reciclado' + FK al reciclaje.
-- DROP IF EXISTS + ADD deja la migración idempotente (el nombre del
-- constraint es el autogenerado por Postgres para el CHECK inline de 082).
ALTER TABLE puntos_eventos ADD COLUMN IF NOT EXISTS reciclaje_id UUID REFERENCES reciclajes(id) ON DELETE SET NULL;
ALTER TABLE puntos_eventos DROP CONSTRAINT IF EXISTS puntos_eventos_tipo_check;
ALTER TABLE puntos_eventos ADD CONSTRAINT puntos_eventos_tipo_check
  CHECK (tipo IN ('documento_escaneado', 'mision_completada', 'trayecto_registrado', 'envase_reciclado'));

-- misiones: nuevo tipo contador 'contar_envases'.
ALTER TABLE misiones DROP CONSTRAINT IF EXISTS misiones_tipo_check;
ALTER TABLE misiones ADD CONSTRAINT misiones_tipo_check
  CHECK (tipo IN ('contar_documentos', 'alcanzar_puntos', 'contar_trayectos', 'contar_envases'));

-- Trayectos con GPS: coordenadas de salida/llegada y distancia en metros
-- (haversine, calculada en el backend). Solo informativa: los puntos del
-- trayecto siguen saliendo de calcularPuntosTrayecto, sin cambios.
ALTER TABLE trayectos ADD COLUMN IF NOT EXISTS salida_lat  NUMERIC(9,6);
ALTER TABLE trayectos ADD COLUMN IF NOT EXISTS salida_lng  NUMERIC(9,6);
ALTER TABLE trayectos ADD COLUMN IF NOT EXISTS llegada_lat NUMERIC(9,6);
ALTER TABLE trayectos ADD COLUMN IF NOT EXISTS llegada_lng NUMERIC(9,6);
ALTER TABLE trayectos ADD COLUMN IF NOT EXISTS distancia_m NUMERIC;

-- Seed: misión de reciclaje (mismo patrón ON CONFLICT que 082).
INSERT INTO misiones (codigo, nombre, descripcion, tipo, meta_valor, puntos_recompensa) VALUES
  ('primeros_10_envases', 'Punto limpio', 'Entrega 10 envases reciclables en un punto limpio', 'contar_envases', 10, 60)
ON CONFLICT (codigo) DO NOTHING;
