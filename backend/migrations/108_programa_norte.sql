-- ============================================================
-- Programa SICR3P Norte 2026-2030: eventos y cupos de formación.
--
-- LA REGLA QUE ORDENA ESTE ARCHIVO. La propuesta de patrocinio la escribe
-- así: «sólo se presentarán como integrantes confirmados quienes hayan
-- aceptado formalmente participar». La portada no muestra a nadie —ni
-- patrocinador, ni empresa piloto, ni profesional— hasta que hay una
-- aceptación registrada. Eso ya lo resuelven `solicitudes_auspicio.estado`
-- y `auspiciadores` (migraciones 051 y 052): acá no se duplica.
--
-- Lo que falta y se agrega es lo otro: dónde y cuándo son las charlas, y
-- cuánta gente cabe en la formación.
--
-- migrate.js no lleva registro de lo aplicado: corre TODOS los .sql en
-- cada arranque. Por eso cada sentencia es idempotente.
-- ============================================================

-- ---------- Cupos de formación ----------
-- El programa capacita a un número acotado de personas. Sin este dato la
-- página tendría que llevar el límite escrito a mano en el código, y el
-- día que cambie nadie se acuerda de tocarlo.
--
-- NULL = sin límite, que es como quedan los cursos que ya existen. No se
-- inventa un cupo para ellos.
ALTER TABLE cursos ADD COLUMN IF NOT EXISTS cupo INT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cursos_cupo_positivo') THEN
    ALTER TABLE cursos ADD CONSTRAINT cursos_cupo_positivo
      CHECK (cupo IS NULL OR cupo > 0);
  END IF;
END $$;

-- ---------- Eventos y charlas ----------
-- Sin datos personales: son lugares, fechas y temas. Por eso no aparece
-- ninguna columna de contacto — quien quiera inscribirse lo hace por el
-- formulario general, que ya está inventariado.
CREATE TABLE IF NOT EXISTS eventos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo       TEXT NOT NULL,
  descripcion  TEXT,
  ciudad       TEXT NOT NULL,
  lugar        TEXT,
  -- Momento de inicio. Con hora, no solo fecha: una charla a las 09:00 y
  -- otra a las 18:00 del mismo día son eventos distintos para quien viaja.
  inicia_at    TIMESTAMPTZ NOT NULL,
  -- `publicado` separa el borrador de lo que ve el mundo. Un evento a
  -- medio cargar no debe aparecer en la portada mientras se decide.
  publicado    BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- La portada pide los publicados que todavía no ocurren, en orden. Este
-- índice es exactamente esa consulta.
CREATE INDEX IF NOT EXISTS eventos_publicados_idx
  ON eventos (inicia_at) WHERE publicado = true;
