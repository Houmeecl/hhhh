-- ============================================================
-- 042: paneles exclusivos para Puerto y Mandante — hasta ahora ambos
-- actores solo tenían acceso vía X-Api-Key (integración máquina a
-- máquina), sin ningún panel web propio para un operador humano.
--
-- Se reutiliza la infraestructura ya construida de `usuarios` (panel,
-- login, activación por correo, bcrypt) en vez de levantar un sistema
-- de credenciales paralelo: cada login de Puerto/Mandante es una fila
-- de `usuarios` con panel='puerto'|'mandante' y una FK a SU propia
-- entidad (puerto_id/mandante_id) — así el panel solo puede ver los
-- datos de la entidad a la que está atado, nunca la de otro actor.
--
-- El acceso por X-Api-Key (routes/puerto.js, routes/mandante.js) sigue
-- intacto para integraciones de sistemas externos — esta migración solo
-- agrega el camino de sesión humana, no reemplaza el existente.
-- ============================================================

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_panel_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_panel_check
  CHECK (panel IN ('sicrep', 'aduana_verde', 'puerto', 'mandante'));

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS puerto_id UUID REFERENCES puertos(id) ON DELETE CASCADE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS mandante_id UUID REFERENCES mandantes(id) ON DELETE CASCADE;

-- Cada panel exige su propia entidad; sicrep/aduana_verde no llevan ninguna.
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_panel_entidad_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_panel_entidad_check CHECK (
  (panel = 'puerto' AND puerto_id IS NOT NULL AND mandante_id IS NULL) OR
  (panel = 'mandante' AND mandante_id IS NOT NULL AND puerto_id IS NULL) OR
  (panel IN ('sicrep', 'aduana_verde') AND puerto_id IS NULL AND mandante_id IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_usuarios_puerto ON usuarios(puerto_id) WHERE puerto_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_usuarios_mandante ON usuarios(mandante_id) WHERE mandante_id IS NOT NULL;

-- Un login web por entidad alcanza para esta ronda (un solo operador por
-- puerto/mandante); si más adelante hace falta más de una cuenta por
-- entidad, se puede sumar sin romper nada quitando este UNIQUE.
CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_puerto_unico ON usuarios(puerto_id) WHERE puerto_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_mandante_unico ON usuarios(mandante_id) WHERE mandante_id IS NOT NULL;
