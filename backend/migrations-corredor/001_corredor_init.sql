-- ============================================================
-- 001: La base del Corredor Bioceánico — identidad y acceso.
--
-- ESTA BASE ES OTRA. `sicr3p_corredor` vive en el mismo servidor Postgres
-- que `sicr3p`, pero es una base distinta y no hay forma de hacer un JOIN
-- entre las dos. Eso es deliberado: son productos distintos y sus datos no
-- se mezclan.
--
-- LO QUE ESO IMPLICA AL ESCRIBIR ACÁ. No existen claves foráneas hacia
-- `sicr3p`. Ni a `usuarios`, ni a `proveedores`, ni a `facturas`. El
-- Corredor tiene sus propios usuarios y su propia cadena de hash. Si algún
-- día hace falta cruzar los dos mundos, se hace por RUT a nivel de
-- aplicación y se declara como cruce, nunca con una FK que no puede
-- existir.
--
-- IDEMPOTENCIA OBLIGATORIA. El migrador no lleva registro: corre todos los
-- .sql en cada arranque. Y la trampa que ya se pagó dos veces en la base
-- principal: `CREATE TABLE IF NOT EXISTS` NO agrega columnas a una tabla
-- que ya existe — cada columna posterior necesita su ALTER explícito.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- El exportador: la empresa cuya mercadería sale ----------
-- No es el operador logístico (mueve, no declara) ni la agencia de aduanas
-- (tramita, y tiene su propio panel en la otra base). Es quien tiene la
-- obligación de entregar la evidencia.
CREATE TABLE IF NOT EXISTS exportadores (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_empresa  TEXT NOT NULL,
  rut             TEXT NOT NULL UNIQUE,
  pais            TEXT NOT NULL DEFAULT 'CL',

  -- Número de registro del operador ante la aduana de la UE. El EUDR lo
  -- exige para identificar a quien pone el producto en el mercado, así que
  -- no es un campo administrativo: sin él la declaración no se presenta.
  eori            TEXT,

  direccion       TEXT,
  contacto_email  TEXT,
  contacto_nombre TEXT,
  activo          BOOLEAN NOT NULL DEFAULT true,
  onboarding_completado_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exportadores_rut ON exportadores (rut);

-- ---------- Usuarios propios ----------
-- No se puede apuntar a `sicr3p.usuarios` desde acá: es otra base. Así que
-- el Corredor tiene su propia tabla, con el mismo diseño que ya funciona
-- del otro lado (clave temporal + must_reset_password, o activación por
-- enlace) para no inventar un segundo flujo de acceso que mantener.
CREATE TABLE IF NOT EXISTS usuarios_corredor (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT NOT NULL UNIQUE,
  nombre         TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  exportador_id  UUID REFERENCES exportadores(id) ON DELETE CASCADE,

  -- 'operador' opera su propia empresa; 'admin' administra el Corredor
  -- completo. Sin exportador_id solo puede ser admin: un operador sin
  -- empresa no tendría nada que ver.
  rol            TEXT NOT NULL DEFAULT 'operador'
                   CHECK (rol IN ('operador', 'admin')),
  estado         TEXT NOT NULL DEFAULT 'activo'
                   CHECK (estado IN ('activo', 'suspendido')),
  must_reset_password BOOLEAN NOT NULL DEFAULT true,
  ultimo_acceso  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un solo acceso por empresa, igual que en los otros paneles. Índice
-- parcial porque los admin del Corredor no tienen exportador_id.
CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_corredor_exportador
  ON usuarios_corredor (exportador_id) WHERE exportador_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usuarios_corredor_operador_con_empresa') THEN
    ALTER TABLE usuarios_corredor ADD CONSTRAINT usuarios_corredor_operador_con_empresa
      CHECK (rol = 'admin' OR exportador_id IS NOT NULL);
  END IF;
END $$;

-- ---------- Tokens de activación y reset ----------
-- Solo se guarda el SHA-256 del token, nunca el token. Mismo criterio que
-- la base principal: si alguien lee esta tabla, no obtiene un enlace usable.
CREATE TABLE IF NOT EXISTS tokens_password_corredor (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  UUID NOT NULL REFERENCES usuarios_corredor(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  tipo        TEXT NOT NULL CHECK (tipo IN ('activacion', 'reset')),
  usado       BOOLEAN NOT NULL DEFAULT false,
  expira_at   TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tokens_corredor_hash ON tokens_password_corredor (token_hash);
CREATE INDEX IF NOT EXISTS idx_tokens_corredor_usuario ON tokens_password_corredor (usuario_id, tipo, usado);

-- ---------- Bitácora ----------
-- Sin FK a usuarios_corredor a propósito: si una cuenta se borra, lo que
-- hizo tiene que seguir constando. Un registro de actividad que desaparece
-- con su autor no sirve para lo único que sirve un registro de actividad.
CREATE TABLE IF NOT EXISTS actividad_corredor (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  UUID,
  email       TEXT,
  accion      TEXT NOT NULL,
  entidad     TEXT,
  entidad_id  UUID,
  detalle     JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_actividad_corredor_fecha ON actividad_corredor (created_at DESC);
