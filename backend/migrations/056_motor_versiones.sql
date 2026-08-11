-- ============================================================
-- Versiones del motor de cálculo — para que un informe ya emitido
-- siga citando la metodología con la que REALMENTE se calculó.
--
-- El problema que resuelve: `motor_categorias` tiene `codigo` como
-- clave primaria y se edita con UPDATE, así que un cambio de factor
-- pisa el valor anterior y no queda historia. Al mismo tiempo,
-- services/pdf.js (fetchAlcancesGHG) leía esa tabla EN VIVO al armar
-- el PDF, y el PDF no se guarda: se rearma en cada descarga. Resultado:
-- cambiar un factor hoy hacía que el informe de marzo se re-imprimiera
-- con la metodología nueva junto a los números viejos — citando una
-- fuente que nunca produjo ese cálculo.
--
-- Los NÚMEROS nunca estuvieron en riesgo: facturas.total_co2e y
-- line_items.co2e se escriben una sola vez y hashDocumento() los sella
-- en la cadena. Lo que faltaba era el eslabón que dice bajo qué
-- versión del motor se produjeron.
--
-- Diseño: `motor_categorias` sigue siendo el estado VIGENTE (editable
-- como hasta ahora). Cada edición congela una copia completa de la
-- tabla en `motor_categorias_version`, y cada factura queda estampada
-- con la versión vigente al momento de su cálculo. Nada se reescribe:
-- versionar solo INSERTA.
-- ============================================================

CREATE TABLE IF NOT EXISTS motor_versiones (
  id          SERIAL PRIMARY KEY,
  nota        TEXT,          -- qué cambió y por qué
  origen      TEXT NOT NULL DEFAULT 'edicion_manual'
                CHECK (origen IN ('semilla', 'edicion_manual', 'propuesta_aprobada')),
  creada_por  UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  creada_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Copia congelada del plan de categorías en el instante de la versión.
-- La fuente metodológica va DESNORMALIZADA a propósito: `fuentes_metodologicas`
-- también es editable, y una FK dejaría la cita expuesta a que alguien
-- corrija el año del documento y con eso altere informes viejos. Acá se
-- guarda el texto tal como se citó.
CREATE TABLE IF NOT EXISTS motor_categorias_version (
  version_id                   INT NOT NULL REFERENCES motor_versiones(id) ON DELETE CASCADE,
  codigo                       TEXT NOT NULL,
  nombre                       TEXT NOT NULL,
  unidad_fisica                TEXT,
  factor_fisico_kgco2e         NUMERIC(14,6),
  factor_gasto_kgco2e_clp1000  NUMERIC(14,6) NOT NULL,
  palabras_clave               TEXT[] NOT NULL DEFAULT '{}',
  fuente                       TEXT,
  activo                       BOOLEAN NOT NULL,
  alcance_ghg                  TEXT,
  fuente_organismo             TEXT,
  fuente_documento             TEXT,
  fuente_version_anio          TEXT,
  PRIMARY KEY (version_id, codigo)
);

-- Bajo qué versión del motor se calculó esta factura. NULL = anterior al
-- versionado (ver semilla más abajo, que las estampa con la versión 1).
ALTER TABLE facturas
  ADD COLUMN IF NOT EXISTS motor_version_id INT REFERENCES motor_versiones(id);
CREATE INDEX IF NOT EXISTS idx_facturas_motor_version ON facturas(motor_version_id);

-- ---------- Semilla: versión 1 = estado actual ----------
-- Idempotente: solo corre si no hay ninguna versión todavía. Las
-- migraciones se re-ejecutan completas en cada arranque.
DO $$
DECLARE
  v_id INT;
BEGIN
  IF EXISTS (SELECT 1 FROM motor_versiones) THEN
    RETURN;
  END IF;

  INSERT INTO motor_versiones (nota, origen)
  VALUES (
    'Estado del motor al introducir el versionado. Las facturas anteriores a esta '
    'migración se estampan con esta versión: es el mejor dato disponible, no una '
    'reconstrucción — antes de este punto no se guardaba historia de factores.',
    'semilla'
  )
  RETURNING id INTO v_id;

  INSERT INTO motor_categorias_version (
    version_id, codigo, nombre, unidad_fisica, factor_fisico_kgco2e,
    factor_gasto_kgco2e_clp1000, palabras_clave, fuente, activo, alcance_ghg,
    fuente_organismo, fuente_documento, fuente_version_anio
  )
  SELECT
    v_id, mc.codigo, mc.nombre, mc.unidad_fisica, mc.factor_fisico_kgco2e,
    mc.factor_gasto_kgco2e_clp1000, mc.palabras_clave, mc.fuente, mc.activo, mc.alcance_ghg,
    f.organismo, f.documento, f.version_anio
  FROM motor_categorias mc
  LEFT JOIN fuentes_metodologicas f ON f.id = mc.fuente_metodologica_id;

  -- `facturas` es una tabla encadenada y la regla del proyecto es que no se
  -- toca (ver agente `privacidad`, regla 1). Este UPDATE es admisible y hay
  -- que poder defenderlo: `motor_version_id` es una columna nueva, no entra
  -- en hashDocumento() —que cubre numero_venta, rut_emisor, rut_receptor,
  -- total_co2e, categoria y archivo_original— así que ningún hash cambia y
  -- verificarCadenaGlobal() sigue dando el mismo resultado antes y después.
  -- Corre una sola vez, en la misma migración que crea la columna.
  UPDATE facturas SET motor_version_id = v_id WHERE motor_version_id IS NULL;
END $$;
