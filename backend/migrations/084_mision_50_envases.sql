-- ============================================================
-- sicr3p — "Sube y Suma": segunda misión de reciclaje (50 envases).
-- Incluye backfill del progreso: evaluarMisionesContador solo suma hacia
-- adelante, así que sin esto los jugadores que ya reciclaron partirían en
-- cero. El backfill NO marca la misión como completada ni otorga puntos
-- aunque el progreso ya supere la meta: otorgar puntos desde una migración
-- rompería el patrón transaccional de otorgarPuntos y dejaría la bitácora
-- puntos_eventos sin el evento — el próximo reciclaje del jugador la
-- completa por el flujo normal.
-- ============================================================

INSERT INTO misiones (codigo, nombre, descripcion, tipo, meta_valor, puntos_recompensa) VALUES
  ('primeros_50_envases', 'Reciclador constante', 'Entrega 50 envases reciclables en puntos limpios', 'contar_envases', 50, 200)
ON CONFLICT (codigo) DO NOTHING;

-- Backfill idempotente: ON CONFLICT DO NOTHING respeta el progreso que el
-- flujo normal ya haya acumulado en corridas posteriores del runner.
INSERT INTO misiones_progreso (jugador_id, mision_id, progreso)
SELECT r.jugador_id, m.id, SUM(r.total_envases)::int
FROM reciclajes r
CROSS JOIN (SELECT id FROM misiones WHERE codigo = 'primeros_50_envases') m
GROUP BY r.jugador_id, m.id
ON CONFLICT (jugador_id, mision_id) DO NOTHING;
