-- ============================================================
-- 004: El corredor se define UN CRUCE A LA VEZ.
--
-- La migración 003 sembró reglas para los tres cruces —BR→PY, PY→AR y
-- AR→CL— como si los tres estuvieran confirmados. No lo están: el
-- catálogo se va armando FRONTERA POR FRONTERA, y el cruce a Chile
-- todavía no se revisó.
--
-- Ojo con el rol de Chile, que no es el de un país de tránsito más:
-- es el DESTINO. Ahí la carga llega a puerto, ahí se consolida el
-- expediente y ahí sicr3p emite el informe. Lo que está en definición no
-- es si Chile participa —participa en la punta del corredor— sino qué
-- documentos exige el cruce AR→CL al ingreso.
--
-- POR QUÉ IMPORTA Y NO ES UN DETALLE. Sin esta tabla, una carga que va
-- de Campo Grande a Antofagasta ve "FALTA declaración jurada de origen"
-- por el cruce AR→CL. Eso es una exigencia que sicr3p todavía no
-- confirmó contra fuente, presentada con la misma cara que las que sí.
-- Es exactamente el error que el resto del producto evita: NO DEFINIDO
-- NO ES LO MISMO QUE FALTANTE. Uno es gris, el otro es rojo.
--
-- Y al revés, que es peor: una carga que ya tiene todo lo de los cruces
-- definidos veía "Con todos los documentos del tramo" sin que nadie
-- hubiera revisado qué pide el último cruce. Un verde que no se puede
-- sostener es más caro que un gris incómodo.
-- ============================================================

CREATE TABLE IF NOT EXISTS cruces_corredor (
  pais_desde  TEXT NOT NULL,
  pais_hasta  TEXT NOT NULL,

  -- 'definido'      → las reglas de documentos_por_tramo para este cruce
  --                   están revisadas contra fuente y se pueden exigir.
  -- 'en_definicion' → todavía se está armando. Sus reglas NO se exigen:
  --                   el tramo que lo incluya queda en gris, con el
  --                   motivo a la vista.
  estado      TEXT NOT NULL DEFAULT 'en_definicion'
                CHECK (estado IN ('definido', 'en_definicion')),

  -- Desde cuándo rige lo definido. Se guarda pero NO se usa para
  -- calcular: las fechas de vigencia se mueven (el EUDR se postergó dos
  -- veces) y una fecha vencida escrita en el código se lee como verdad y
  -- nadie la revisa. Sirve para mostrarla y para auditar, no para decidir.
  vigente_desde DATE,

  -- Qué falta para darlo por definido. Se muestra tal cual al exportador:
  -- "todavía no está" sin decir qué falta es una excusa, no una razón.
  nota        TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (pais_desde, pais_hasta)
);

-- El estado de cada cruce al 20-08-2026.
--
-- BR→PY y PY→AR quedan definidos: sus documentos se verificaron contra
-- las fuentes de MAPA, SENAVE e INFONA.
--
-- AR→CL queda EN DEFINICIÓN. Chile todavía no está: las reglas que la
-- migración 003 sembró para ese cruce se conservan —no se borran, ya
-- están escritas— pero no se exigen hasta que alguien las revise contra
-- el SAG y el SENASA. Ver el hallazgo de la revisión normativa: la nota
-- de la 003 dice que el SAG "lo exige al ingreso", y el SAG no emite
-- certificados fitosanitarios para carga de origen argentino — eso lo
-- emite el SENASA. Es justo el tipo de error que un cruce sin revisar
-- arrastra.
INSERT INTO cruces_corredor (pais_desde, pais_hasta, estado, vigente_desde, nota) VALUES
  ('BR', 'PY', 'definido', '2026-08-20',
   'Documentos revisados: certificado fitosanitario del MAPA y DOF del IBAMA para madera nativa.'),
  ('PY', 'AR', 'definido', '2026-08-20',
   'Documentos revisados: certificado del SENAVE y guía de circulación del INFONA.'),
  ('AR', 'CL', 'en_definicion', NULL,
   'Chile es el destino: es donde la carga llega a puerto y donde sicr3p consolida el expediente y emite el informe. Lo que falta definir no es su rol, sino qué documentos exige ESTE CRUCE al ingreso: hay que confirmarlo con el SAG (que exige) y con el SENASA (que emite en origen) antes de exigirle nada a una carga.')
ON CONFLICT (pais_desde, pais_hasta) DO NOTHING;
