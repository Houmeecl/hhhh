-- ============================================================
-- 061: login sin contraseña con llave USB FIDO2 con sensor de huella
-- (YubiKey Bio, Kensington VeriMark, Feitian BioPass — hardware estándar
-- que se compra ya hecho, no se fabrica nada). El navegador ya sabe hablar
-- WebAuthn de forma nativa; esto NO agrega ningún proceso nativo en la
-- máquina del usuario ni cambia el modelo de sesión (sigue siendo el
-- mismo JWT access+refresh de siempre — ver signAccess/signRefresh en
-- middleware/auth.js). La huella se valida DENTRO de la llave física y
-- nunca llega a este servidor: solo se guarda la clave pública y un
-- contador anti-clonado, como exige el protocolo FIDO2.
-- ============================================================

-- Una fila por llave física registrada. N:1 con usuarios: una cuenta
-- puede tener más de una llave (ej. una de respaldo).
CREATE TABLE IF NOT EXISTS credenciales_webauthn (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id          UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  credential_id       TEXT NOT NULL UNIQUE,   -- base64url que devuelve el authenticator
  public_key          TEXT NOT NULL,          -- clave pública COSE, base64
  counter             BIGINT NOT NULL DEFAULT 0,
  device_type         TEXT,                   -- 'singleDevice' | 'multiDevice'
  backed_up           BOOLEAN NOT NULL DEFAULT false,
  transports          JSONB,                  -- ej. ["usb"]
  nombre_dispositivo  TEXT,                   -- etiqueta libre puesta por el admin
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_credenciales_webauthn_usuario ON credenciales_webauthn(usuario_id);

-- Challenges de un solo uso (registro o login), TTL corto verificado en el
-- momento de confirmar la respuesta. Se guarda en Postgres y no en
-- memoria del proceso: el proyecto no tiene Redis ni garantía de
-- instancia única del backend. El UNIQUE + ON CONFLICT DO UPDATE (ver
-- routes/webauthn.js y admin.js) invalida el challenge anterior de ese
-- mismo usuario/tipo sin necesitar un cron de limpieza aparte.
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL CHECK (tipo IN ('registro', 'login')),
  challenge   TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (usuario_id, tipo)
);
