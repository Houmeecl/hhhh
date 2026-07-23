-- ============================================================
-- sicr3p — Panel diferenciado sicrep / Aduana Verde.
-- Agrega el ámbito de acceso de cada cuenta admin, ortogonal al rol
-- (admin/operador/cliente) que ya usan decenas de requireRole(...) — no
-- se toca esa columna para no auditar cada uso existente.
-- DEFAULT 'sicrep' cubre automáticamente todas las cuentas ya creadas:
-- siguen entrando exactamente igual al panel núcleo tras esta migración.
-- ============================================================

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS panel TEXT NOT NULL DEFAULT 'sicrep'
    CHECK (panel IN ('sicrep', 'aduana_verde'));

CREATE INDEX IF NOT EXISTS idx_usuarios_panel ON usuarios(panel);
