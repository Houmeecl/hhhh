-- ============================================================
-- Superadmin: una cuenta del panel sicrep, marcada explícitamente, que
-- puede "canjear" un token de vista para cualquier otro panel (ver
-- POST /api/admin/entrar-a-panel en routes/admin.js). NO afloja
-- requireHomePanel ni los checks manuales de puerto/mandante/agencia/
-- trazador: el canje emite un token que ya los cumple tal cual están.
--
-- Es un nivel por ENCIMA de admin de sicrep, no un rol paralelo — de
-- ahí el CHECK: no tiene sentido una cuenta base de otro panel con
-- superpoderes cross-panel.
--
-- No hay UI para marcar la primera cuenta superadmin (igual que no la
-- hay para crear el primer admin): se hace a mano en BD, una vez:
--   UPDATE usuarios SET es_superadmin = true WHERE email = '...';
-- ============================================================

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS es_superadmin BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'usuarios_superadmin_requiere_sicrep_admin' AND conrelid = 'usuarios'::regclass
  ) THEN
    ALTER TABLE usuarios ADD CONSTRAINT usuarios_superadmin_requiere_sicrep_admin
      CHECK (NOT es_superadmin OR (panel = 'sicrep' AND rol = 'admin'));
  END IF;
END $$;
