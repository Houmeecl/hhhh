-- ============================================================
-- Activos del piloto: la camioneta, la maquinaria o el equipo que se
-- audita durante el Programa Norte.
--
-- POR QUÉ NO TRAE SU PROPIA EVIDENCIA. La tentación era darle documentos,
-- hashes y cobertura propios. Habría sido duplicar `expedientes` y
-- `expediente_documentos` —que ya modelan contrato, período, documentos
-- con hash y semáforo— y el día que las dos copias se separaran, el
-- adhesivo pegado en la camioneta diría una cosa y la pantalla otra.
--
-- Un activo es una ETIQUETA sobre evidencia que ya existe: apunta al
-- proveedor y al contrato, y su estado se calcula recorriendo los
-- expedientes de ese par. Nada que calcular acá.
--
-- migrate.js corre todos los .sql en cada arranque: todo idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS activos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- El código que va impreso y dentro del QR. Se genera con 8 bytes por
  -- la misma razón que el serial de la Tarjeta de Viaje: es la única
  -- credencial de una página pública, y con pocos caracteres se puede
  -- enumerar quién audita qué.
  codigo        TEXT NOT NULL UNIQUE,

  proveedor_id  UUID NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,

  -- Cómo se le dice en terreno: "Camioneta 4×4", "Grúa horquilla 3T".
  nombre        TEXT NOT NULL,
  tipo          TEXT NOT NULL DEFAULT 'vehiculo'
                  CHECK (tipo IN ('vehiculo', 'maquinaria', 'equipo', 'otro')),

  -- El vínculo con la evidencia. `contrato` calza con expedientes.contrato,
  -- que es como el piloto agrupa: 3 contratos × 3 activos.
  contrato      TEXT,

  -- La patente NO es obligatoria y no viaja a la página pública: sirve
  -- para que la empresa reconozca cuál es cuál en su propio panel. Ver
  -- services/inventarioDatos.js — es dato de la empresa, no de una
  -- persona, pero identifica un móvil y no hace falta publicarlo.
  identificador_interno TEXT,

  periodo_desde DATE,
  periodo_hasta DATE,

  activo        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activos_proveedor_idx ON activos (proveedor_id);
CREATE INDEX IF NOT EXISTS activos_contrato_idx  ON activos (proveedor_id, contrato);
