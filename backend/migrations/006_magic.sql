-- ============================================================
-- sicr3p — Acceso de clientes con magic link (sin contraseña).
-- Tokens de un solo uso, hasheados, con expiración corta.
-- El email del cliente NO necesita cuenta en `usuarios`.
-- ============================================================

CREATE TABLE IF NOT EXISTS tokens_magic (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL,
  token_hash  TEXT NOT NULL,
  expira_at   TIMESTAMPTZ NOT NULL,
  usado       BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tokens_magic_hash ON tokens_magic(token_hash);
CREATE INDEX IF NOT EXISTS idx_tokens_magic_email ON tokens_magic(email);
