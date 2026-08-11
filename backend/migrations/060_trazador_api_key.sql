-- ============================================================
-- Camino de X-Api-Key para el panel trazador (migración 058), que hasta
-- ahora era exclusivamente login humano. Caso real: un socio externo
-- (ej. Kontax) cuyo propio sistema necesita consultar el RUT
-- programáticamente, sin que un operador entre a nuestro panel web.
--
-- A diferencia de puertos/agencias_aduana (token_hash NOT NULL desde su
-- creación: siempre integran vía API), aquí es OPCIONAL — un trazador
-- puede seguir existiendo solo como cuenta humana, sin ninguna key. La
-- key se genera aparte (POST /trazadores/:id/generar-api-key), cuando el
-- caso lo requiere.
-- ============================================================

ALTER TABLE trazadores ADD COLUMN IF NOT EXISTS token_hash TEXT UNIQUE;
