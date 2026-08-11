-- ============================================================
-- 079 — Reclasificación por un operador, como asiento de ajuste encadenado.
--
-- EL PROBLEMA. Cuando ninguna palabra clave calza con la glosa de los ítems,
-- el motor no clasifica el documento (queda `sin_coincidencia`), y cuando no
-- hay ítems que clasificar tampoco (`sin_categoria`, migración 078). Esos
-- documentos calculan su CO2e por método de gasto con el factor del catch-all
-- y no reciben alcance GHG. Alguien tiene que poder decir qué eran.
--
-- POR QUÉ NO SE CORRIGE LA FILA. `facturas.hash_documento` incluye la
-- categoría y el CO2e (ver services/cadenaHash.hashDocumento), y cada factura
-- está encadenada a la anterior. Editar la fila rompe la cadena desde ese
-- punto — y esa cadena es la garantía que el producto vende y que el QR
-- público verifica. El documento sellado NO se toca.
--
-- QUÉ SE HACE EN CAMBIO. Un asiento nuevo, append-only, con SU PROPIA cadena
-- de hash: mismo patrón que Capital Natural (029) y las declaraciones de
-- embalaje (028), un conjunto acotado con su propio génesis en vez de
-- mezclarse con la cadena global de facturas. La factura original queda
-- verificable exactamente igual que antes; el ajuste queda verificable
-- aparte; y quién lo hizo, cuándo y por qué queda escrito.
--
-- ES APPEND-ONLY DE VERDAD: no hay UPDATE ni DELETE en el flujo. Si un
-- operador se equivoca, se anexa otro ajuste. Vale el ÚLTIMO por
-- `factura_id` (mayor `eslabon`), y los anteriores siguen ahí, legibles.
--
-- ESTO NO ES "CORRECCIÓN MANUAL DE DATOS DE FACTURA", que el proyecto
-- descartó a propósito (ver ETAPA3.md): no se edita ningún monto, RUT, folio
-- ni glosa leída del documento. Se asigna una CATEGORÍA que el motor no pudo
-- inferir, y se recalcula el CO2e con el factor de esa categoría por el mismo
-- método de gasto — porque dejar el número del catch-all bajo una etiqueta
-- nueva sería peor: el número y su rótulo dirían cosas distintas.
--
-- Idempotente: IF NOT EXISTS en todo, y la corrección del FK va con guardia
-- por nombre de constraint para que correrla dos veces no falle.
-- ============================================================

CREATE TABLE IF NOT EXISTS ajustes_clasificacion (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ON DELETE SET NULL, no CASCADE: una cadena append-only no puede perder
  -- eslabones. Si se borra la factura (purga por retención, migración 048),
  -- el asiento se queda huérfano pero LEGIBLE y verificable — igual que
  -- `movimientos_naturales` en Capital Natural. Con CASCADE, borrar un
  -- documento partía la cadena de ajustes en dos y la verificación pasaba a
  -- reportar una alteración que nunca ocurrió.
  factura_id       UUID REFERENCES facturas(id) ON DELETE SET NULL,

  -- La clasificación que asigna el operador. `categoria_codigo` es la clave
  -- estable; `categoria` guarda el NOMBRE con que se mostró, congelado, para
  -- que renombrarla en el panel del motor no reescriba lo que se firmó.
  categoria_codigo TEXT NOT NULL,
  categoria        TEXT NOT NULL,

  -- CO2e recalculado con el factor de esa categoría. Se guarda junto con el
  -- del documento original: el ajuste declara su propio efecto en vez de que
  -- haya que deducirlo restando.
  co2e_ajustado    NUMERIC(14,4) NOT NULL,
  co2e_original    NUMERIC(14,4) NOT NULL,

  -- Quién y por qué. `usuario_id` no cascadea a NULL a propósito: borrar la
  -- cuenta de un operador no puede dejar un asiento firmado sin firmante.
  usuario_id       UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  motivo           TEXT NOT NULL,

  -- Cadena propia (génesis en repeat('0',64), estado en cadena_ajustes_estado).
  hash_documento   TEXT NOT NULL,
  hash_anterior    TEXT NOT NULL,
  hash_cadena      TEXT NOT NULL,
  eslabon          BIGINT NOT NULL,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- El ajuste vigente de una factura es el de mayor eslabón: este índice es el
-- que hace barato el DISTINCT ON de la vista de abajo.
CREATE INDEX IF NOT EXISTS idx_ajustes_clasif_factura
  ON ajustes_clasificacion (factura_id, eslabon DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ajustes_clasif_eslabon
  ON ajustes_clasificacion (eslabon);

-- Estado de la cadena de ajustes. Fila única, igual que `cadena_estado`.
CREATE TABLE IF NOT EXISTS cadena_ajustes_estado (
  id          INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ultimo_hash TEXT NOT NULL DEFAULT repeat('0', 64),
  n_eslabones BIGINT NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO cadena_ajustes_estado (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- La lectura: `facturas` con su ajuste vigente aplicado.
--
-- Existe para que las pantallas y los informes no tengan que acordarse de
-- hacer el JOIN — que es exactamente el olvido que produce dos PDF del mismo
-- documento diciendo cosas distintas.
--
-- Las columnas de HASH salen SIN TOCAR: la verificación de integridad y el QR
-- público leen la factura original, que es lo que se firmó. Un ajuste no
-- puede cambiar lo que la cadena dice del documento sellado, y por eso
-- services/cadenaGlobal.js sigue leyendo `facturas` directamente.
-- ============================================================
CREATE OR REPLACE VIEW facturas_vigentes AS
SELECT
  f.id, f.sesion_id, f.invoice_id_simple, f.numero_venta, f.archivo_original,
  f.rut_emisor, f.rut_receptor, f.status, f.motor, f.motor_version_id, f.clay_id,
  f.hash_documento, f.hash_anterior, f.hash_cadena, f.eslabon, f.created_at,
  COALESCE(a.co2e_ajustado, f.total_co2e)      AS total_co2e,
  COALESCE(a.categoria, f.categoria)           AS categoria,
  COALESCE(a.categoria_codigo, f.categoria_codigo) AS categoria_codigo,
  CASE WHEN a.id IS NOT NULL THEN 'operador' ELSE f.categoria_origen END AS categoria_origen,
  -- Lo que el documento decía antes del ajuste, para que el informe pueda
  -- declarar el cambio en vez de presentarlo como si siempre hubiera sido así.
  f.total_co2e   AS total_co2e_original,
  f.categoria    AS categoria_original,
  a.id           AS ajuste_id,
  a.motivo       AS ajuste_motivo,
  a.created_at   AS ajuste_fecha
FROM facturas f
LEFT JOIN LATERAL (
  SELECT * FROM ajustes_clasificacion ac
   WHERE ac.factura_id = f.id
   ORDER BY ac.eslabon DESC
   LIMIT 1
) a ON true;

-- El FK nació como ON DELETE CASCADE, que parte la cadena al borrar una
-- factura. Se corrige acá para las bases que ya tomaron la versión anterior;
-- en una base nueva el CREATE TABLE de arriba ya lo deja bien y este bloque
-- no encuentra nada que cambiar.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conname = 'ajustes_clasificacion_factura_id_fkey' AND c.confdeltype = 'c'
  ) THEN
    ALTER TABLE ajustes_clasificacion DROP CONSTRAINT ajustes_clasificacion_factura_id_fkey;
    ALTER TABLE ajustes_clasificacion ALTER COLUMN factura_id DROP NOT NULL;
    ALTER TABLE ajustes_clasificacion ADD CONSTRAINT ajustes_clasificacion_factura_id_fkey
      FOREIGN KEY (factura_id) REFERENCES facturas(id) ON DELETE SET NULL;
  END IF;
END $$;

-- `factura_id` se pone en NULL cuando el documento se purga por retención, y
-- el hash del asiento se calcula sobre el id que se firmó. Sin una copia
-- inmutable, la verificación de contenido denunciaría como alteración lo que
-- fue una purga legítima. Esta columna guarda el id como TEXTO, sin FK: es
-- parte de lo firmado, no una referencia viva.
ALTER TABLE ajustes_clasificacion ADD COLUMN IF NOT EXISTS factura_id_firmada TEXT;
UPDATE ajustes_clasificacion SET factura_id_firmada = factura_id::text
 WHERE factura_id_firmada IS NULL AND factura_id IS NOT NULL;
