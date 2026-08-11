-- ============================================================
-- 062: proveedor como entidad persistente con login FIDO2 (panel
-- 'proveedor'). Mismo patrón que puertos (040) / agencias (046) /
-- trazadores (058): tabla de actor + usuarios.panel='proveedor' +
-- usuarios.proveedor_id, para poder registrar una llave FIDO2 sobre una
-- identidad estable (mecanismo de la migración 061, sin cambios).
--
-- NO se toca credenciales_proveedor (migración 038): esa tabla modela
-- 1 fila = 1 firma de un lote (agotable, de un solo uso) — correcta
-- para una credencial impresa, pero no para una empresa que firma
-- muchos lotes en el tiempo con la misma identidad. El stock ya
-- impreso con rol='proveedor' sigue resolviendo por GET /api/f/:serial
-- y firmando por POST /api/firma-proveedor/auth + /firmar exactamente
-- igual que hoy, para siempre — compatibilidad retro total, cero
-- ALTER/UPDATE sobre esa tabla ni sus rutas.
-- ============================================================

CREATE TABLE IF NOT EXISTS proveedores (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_empresa TEXT NOT NULL,
  rut            TEXT UNIQUE NOT NULL,   -- normalizado: sin puntos/guión, módulo 11
  activo         BOOLEAN NOT NULL DEFAULT true,
  ultimo_uso     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Autorización de firma por lote (N:N): 1 fila = "este proveedor PUEDE
-- firmar este lote", no 1 fila = 1 firma. firmado_at/eslabon_id marcan
-- que ya la usó (mismo criterio de "de un solo uso" que
-- credenciales_proveedor, pero acá el proveedor conserva su identidad
-- para la próxima asignación en otro lote).
CREATE TABLE IF NOT EXISTS proveedor_lotes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proveedor_id  UUID NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  lote_id       UUID NOT NULL REFERENCES lotes_minerales(id) ON DELETE CASCADE,
  activo        BOOLEAN NOT NULL DEFAULT true,
  firmado_at    TIMESTAMPTZ,              -- NULL = aún no firma; set = ya firmó esta asignación
  eslabon_id    UUID REFERENCES lote_eslabones(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (proveedor_id, lote_id)
);
CREATE INDEX IF NOT EXISTS idx_proveedor_lotes_proveedor ON proveedor_lotes(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_proveedor_lotes_lote ON proveedor_lotes(lote_id);

-- Guardias de re-ejecución (las migraciones corren completas en cada
-- arranque): los CHECK solo se recrean si la definición vigente aún no
-- conoce 'proveedor' — si una futura migración los volviera a ampliar,
-- esta pasada los dejará tal cual, igual que 058 respeta a 046.
DO $$
DECLARE def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'usuarios_panel_check' AND conrelid = 'usuarios'::regclass;
  IF def IS NULL OR def NOT LIKE '%proveedor%' THEN
    ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_panel_check;
    ALTER TABLE usuarios ADD CONSTRAINT usuarios_panel_check
      CHECK (panel IN ('sicrep', 'aduana_verde', 'puerto', 'mandante', 'agencia', 'trazador', 'proveedor'));
  END IF;
END $$;

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS proveedor_id UUID REFERENCES proveedores(id) ON DELETE CASCADE;

DO $$
DECLARE def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'usuarios_panel_entidad_check' AND conrelid = 'usuarios'::regclass;
  IF def IS NULL OR def NOT LIKE '%proveedor_id%' THEN
    ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_panel_entidad_check;
    ALTER TABLE usuarios ADD CONSTRAINT usuarios_panel_entidad_check CHECK (
      (panel = 'puerto' AND puerto_id IS NOT NULL AND mandante_id IS NULL AND agencia_id IS NULL AND trazador_id IS NULL AND proveedor_id IS NULL) OR
      (panel = 'mandante' AND mandante_id IS NOT NULL AND puerto_id IS NULL AND agencia_id IS NULL AND trazador_id IS NULL AND proveedor_id IS NULL) OR
      (panel = 'agencia' AND agencia_id IS NOT NULL AND puerto_id IS NULL AND mandante_id IS NULL AND trazador_id IS NULL AND proveedor_id IS NULL) OR
      (panel = 'trazador' AND trazador_id IS NOT NULL AND puerto_id IS NULL AND mandante_id IS NULL AND agencia_id IS NULL AND proveedor_id IS NULL) OR
      (panel = 'proveedor' AND proveedor_id IS NOT NULL AND puerto_id IS NULL AND mandante_id IS NULL AND agencia_id IS NULL AND trazador_id IS NULL) OR
      (panel IN ('sicrep', 'aduana_verde') AND puerto_id IS NULL AND mandante_id IS NULL AND agencia_id IS NULL AND trazador_id IS NULL AND proveedor_id IS NULL)
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_usuarios_proveedor ON usuarios(proveedor_id) WHERE proveedor_id IS NOT NULL;

-- Un login web por proveedor alcanza para esta ronda (mismo criterio que
-- puerto/mandante/agencia/trazador); si más adelante hace falta más de
-- una cuenta por proveedor, se puede sumar sin romper nada quitando este UNIQUE.
CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_proveedor_unico ON usuarios(proveedor_id) WHERE proveedor_id IS NOT NULL;
