-- ============================================================
-- Llave de archivo: credencial de inicio de sesión que vive en un
-- archivo (.sicr3p-llave) que el usuario guarda en un pendrive común.
-- Tercera vía de acceso junto a la contraseña y la llave FIDO2
-- (migración 061) — y, dicho sin rodeos, la MÁS DÉBIL de las tres:
-- un archivo se puede copiar. Las mitigaciones son un PIN de 6
-- dígitos verificado en el SERVIDOR (bcrypt + bloqueo tras 5 fallos;
-- un PIN corto cifrando el archivo se rompería offline en segundos,
-- por eso el archivo NO va cifrado y el PIN no viaja en él), y la
-- revocación permanente por un admin.
--
-- El archivo lleva un token opaco de 48 bytes (alta entropía); acá
-- solo queda su sha256 — mismo criterio que tokens_password
-- (services/cuentas.js). El PIN sí va con bcrypt: es corto y ahí el
-- costo del hash importa. Token y PIN viajan UNA sola vez, en la
-- emisión. No hay "cambio de PIN": se revoca y se emite otra, que
-- rota token y PIN juntos.
-- ============================================================

CREATE TABLE IF NOT EXISTS credenciales_archivo (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id        UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  serial            TEXT NOT NULL UNIQUE,          -- LA-XXXX, identificador público
  token_hash        TEXT NOT NULL,                 -- sha256 hex del token del archivo
  pin_hash          TEXT NOT NULL,                 -- bcrypt del PIN de 6 dígitos
  nombre            TEXT,                          -- etiqueta ("USB azul oficina")
  activo            BOOLEAN NOT NULL DEFAULT true, -- revocación permanente: nunca vuelve a true
  intentos_fallidos INT NOT NULL DEFAULT 0 CHECK (intentos_fallidos >= 0),
  bloqueado_hasta   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_credenciales_archivo_usuario ON credenciales_archivo(usuario_id);
