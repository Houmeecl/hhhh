-- ============================================================
-- 111: Contabilidad financiera privada por empresa.
--
-- Es un libro auxiliar de doble partida para la operación contable de cada
-- cliente. No comparte tablas, factores ni cadena de la contabilidad de
-- carbono/capital natural. Los asientos registrados son append-only: una
-- corrección se representa con un nuevo asiento, no cambiando historia.
-- ============================================================

CREATE TABLE IF NOT EXISTS contabilidad_periodos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id  UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  desde       DATE NOT NULL,
  hasta       DATE NOT NULL,
  estado      TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto','cerrado')),
  creado_por  UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cliente_id, nombre),
  CHECK (hasta >= desde)
);

CREATE TABLE IF NOT EXISTS contabilidad_cuentas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id  UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  codigo      TEXT NOT NULL,
  nombre      TEXT NOT NULL,
  tipo        TEXT NOT NULL CHECK (tipo IN ('activo','pasivo','patrimonio','ingreso','costo','gasto')),
  activa      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cliente_id, codigo)
);

CREATE TABLE IF NOT EXISTS contabilidad_asientos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id   UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  periodo_id   UUID NOT NULL REFERENCES contabilidad_periodos(id) ON DELETE RESTRICT,
  numero       INTEGER NOT NULL CHECK (numero > 0),
  fecha        DATE NOT NULL,
  glosa        TEXT NOT NULL,
  referencia   TEXT,
  origen_tipo  TEXT NOT NULL DEFAULT 'manual' CHECK (origen_tipo IN ('manual','sii','documento','ajuste')),
  origen_id    TEXT,
  estado       TEXT NOT NULL DEFAULT 'registrado' CHECK (estado IN ('registrado','reversado')),
  hash_asiento TEXT NOT NULL,
  creado_por   UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cliente_id, periodo_id, numero)
);

CREATE TABLE IF NOT EXISTS contabilidad_lineas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asiento_id  UUID NOT NULL REFERENCES contabilidad_asientos(id) ON DELETE RESTRICT,
  cuenta_id   UUID NOT NULL REFERENCES contabilidad_cuentas(id) ON DELETE RESTRICT,
  glosa       TEXT,
  debito      NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (debito >= 0),
  haber       NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (haber >= 0),
  CHECK ((debito > 0 AND haber = 0) OR (haber > 0 AND debito = 0))
);

CREATE INDEX IF NOT EXISTS idx_contab_periodos_cliente ON contabilidad_periodos(cliente_id, desde DESC);
CREATE INDEX IF NOT EXISTS idx_contab_cuentas_cliente ON contabilidad_cuentas(cliente_id, codigo);
CREATE INDEX IF NOT EXISTS idx_contab_asientos_periodo ON contabilidad_asientos(cliente_id, periodo_id, fecha, numero);
CREATE INDEX IF NOT EXISTS idx_contab_lineas_asiento ON contabilidad_lineas(asiento_id);
CREATE INDEX IF NOT EXISTS idx_contab_lineas_cuenta ON contabilidad_lineas(cuenta_id);

CREATE OR REPLACE FUNCTION bloquear_mutacion_contable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Los asientos financieros registrados son inmutables; registra un asiento de reversa.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS contab_asientos_inmutables ON contabilidad_asientos;
CREATE TRIGGER contab_asientos_inmutables
  BEFORE UPDATE OR DELETE ON contabilidad_asientos
  FOR EACH ROW EXECUTE FUNCTION bloquear_mutacion_contable();

DROP TRIGGER IF EXISTS contab_lineas_inmutables ON contabilidad_lineas;
CREATE TRIGGER contab_lineas_inmutables
  BEFORE UPDATE OR DELETE ON contabilidad_lineas
  FOR EACH ROW EXECUTE FUNCTION bloquear_mutacion_contable();
