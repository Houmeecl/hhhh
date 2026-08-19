-- ============================================================
-- 002: Cargas, parcelas y tramo — el pasaporte de exportación.
--
-- La carga del Corredor NO es un `lotes_minerales` con tipo='documental'.
-- Es su propia tabla, en su propia base. Lo anterior queda donde está y
-- deja de crearse por ahí: se empieza limpio, porque mover una cadena de
-- hash a otra base obliga a resellarla, y resellar rompe la verificación o
-- arrastra hashes que ya no se pueden comprobar contra su origen.
--
-- SIN POSICIÓN DE VEHÍCULOS. Ninguna tabla de este archivo guarda dónde
-- está una carga. La carga cruza cuatro países con niveles de seguridad
-- muy distintos y un rastro en vivo es exactamente el mapa que necesita
-- quien la quiera interceptar. Se registra el HITO —el paso por un punto
-- de control conocido, que tiene sus propias coordenadas fijas— y nunca el
-- móvil. Ver docs/CORREDOR-PLAN.md §4.0.
-- ============================================================

-- ---------- Puntos de control del corredor ----------
-- Copia propia del catálogo: es otra base, no se puede referenciar el de
-- `sicr3p`. Coordenadas FIJAS y públicas de lugares conocidos (aduanas,
-- puertos, depósitos) — no tienen nada que ver con dónde está una carga.
CREATE TABLE IF NOT EXISTS puntos_corredor (
  id          TEXT PRIMARY KEY,          -- slug estable; se sella en los pasos
  nombre      TEXT NOT NULL,
  pais        TEXT NOT NULL,
  lat         NUMERIC(9,6) NOT NULL,
  lng         NUMERIC(9,6) NOT NULL,
  orden       INTEGER NOT NULL DEFAULT 0,
  es_frontera BOOLEAN NOT NULL DEFAULT false,
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Parcelas: el requisito que el EUDR no perdona ----------
-- El reglamento exige la geolocalización de cada predio donde se produjo.
-- Es dato estructurado, no un PDF adjunto.
CREATE TABLE IF NOT EXISTS parcelas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exportador_id  UUID NOT NULL REFERENCES exportadores(id) ON DELETE CASCADE,
  nombre         TEXT NOT NULL,
  pais           TEXT NOT NULL,
  region         TEXT,

  -- Decide si basta un punto o se exige polígono: sobre 4 ha el EUDR pide
  -- el perímetro completo.
  area_ha        NUMERIC(12,4),

  lat            NUMERIC(9,6),
  lng            NUMERIC(9,6),
  poligono       JSONB,                 -- GeoJSON; NULL cuando basta el punto

  -- De dónde salió la coordenada. NO existen 'gps' ni 'perimetro': se
  -- descartaron a propósito. Mandar a alguien a recorrer un predio con un
  -- teléfono en zona de frontera es el riesgo que este producto no corre,
  -- y además el archivo del catastro es más preciso que ese recorrido.
  origen_coordenada TEXT NOT NULL DEFAULT 'archivo'
                      CHECK (origen_coordenada IN ('archivo', 'registro', 'mapa')),
  precision_declarada_m NUMERIC(10,2),  -- la que trae el archivo, si trae

  -- 1 declarado · 2 documentado · 3 consistente · 4 validado en fuente.
  -- Misma escalera que el expediente de evidencia del otro producto, y por
  -- las mismas razones. LO CALCULA EL SERVIDOR: si se recibiera del
  -- cliente, cualquiera se declararía en el nivel más alto con un curl.
  -- El 5 (revisión externa) no está: necesitaría un rol de auditor que no
  -- existe, y emitirlo sería declarar una revisión que nadie hizo.
  nivel_confianza SMALLINT NOT NULL DEFAULT 1 CHECK (nivel_confianza BETWEEN 1 AND 4),

  validado_por    TEXT,
  validado_fuente TEXT,
  validado_at     TIMESTAMPTZ,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parcelas_exportador ON parcelas (exportador_id, created_at DESC);

DO $$
BEGIN
  -- Una parcela sin ubicación no es una parcela declarada: o hay punto, o
  -- hay polígono. Aceptar ninguna de las dos dejaría filas que se ven
  -- completas y no ubican nada.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parcelas_con_ubicacion') THEN
    ALTER TABLE parcelas ADD CONSTRAINT parcelas_con_ubicacion
      CHECK (poligono IS NOT NULL OR (lat IS NOT NULL AND lng IS NOT NULL));
  END IF;

  -- El nivel 4 exige los tres campos de la validación. Sin quién, contra
  -- qué y cuándo, "validado en fuente" es una etiqueta que no se puede
  -- comprobar. Mismo CHECK que gobierna `datos_trazables` en la otra base.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parcelas_nivel4_exige_validador') THEN
    ALTER TABLE parcelas ADD CONSTRAINT parcelas_nivel4_exige_validador
      CHECK (nivel_confianza < 4
             OR (validado_por IS NOT NULL AND validado_fuente IS NOT NULL AND validado_at IS NOT NULL));
  END IF;
END $$;

-- ---------- La carga ----------
CREATE TABLE IF NOT EXISTS cargas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- CB-AAAA-NNNNNN. No 'LM' (Lote Mineral), que es como salía una carga de
  -- soya de Brasil en el modelo viejo.
  codigo         TEXT NOT NULL UNIQUE,

  exportador_id  UUID NOT NULL REFERENCES exportadores(id) ON DELETE RESTRICT,

  -- Decide el régimen —EUDR, CBAM o exportación— y con eso, qué se le pide
  -- al resto del formulario. Por eso es lo primero que se pregunta.
  codigo_nc      TEXT,

  descripcion    TEXT NOT NULL,
  cantidad       NUMERIC(18,4) NOT NULL CHECK (cantidad > 0),
  unidad         TEXT NOT NULL DEFAULT 't' CHECK (unidad IN ('t', 'kg')),
  pais_origen    TEXT NOT NULL,
  region_origen  TEXT,

  -- CBAM: la instalación productiva y sus emisiones incorporadas.
  instalacion    TEXT,
  emisiones_directas_tco2e_t   NUMERIC(12,6) CHECK (emisiones_directas_tco2e_t >= 0),
  emisiones_indirectas_tco2e_t NUMERIC(12,6) CHECK (emisiones_indirectas_tco2e_t >= 0),
  metodo_emisiones TEXT CHECK (metodo_emisiones IN ('valores_reales', 'valores_defecto', 'mixto')),

  estado         TEXT NOT NULL DEFAULT 'abierta'
                   CHECK (estado IN ('abierta', 'cerrada', 'anulada')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cargas_exportador ON cargas (exportador_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cargas_nc ON cargas (codigo_nc);

-- ---------- De qué parcelas salió ----------
CREATE TABLE IF NOT EXISTS carga_parcelas (
  carga_id    UUID NOT NULL REFERENCES cargas(id) ON DELETE CASCADE,
  parcela_id  UUID NOT NULL REFERENCES parcelas(id) ON DELETE RESTRICT,
  -- Qué proporción de la carga viene de esta parcela. Mayor que 0: un
  -- aporte de 0% no es un origen, y registrarlo diría lo contrario de lo
  -- que significa.
  aporte_pct  NUMERIC(6,3) NOT NULL DEFAULT 100 CHECK (aporte_pct > 0 AND aporte_pct <= 100),
  PRIMARY KEY (carga_id, parcela_id)
);

-- ---------- Producción: los otros requisitos del EUDR ----------
CREATE TABLE IF NOT EXISTS carga_produccion (
  carga_id  UUID PRIMARY KEY REFERENCES cargas(id) ON DELETE CASCADE,

  -- Intervalo, no fecha: una cosecha es una ventana.
  desde     DATE,
  hasta     DATE,

  -- Sí explícito, no "cualquier valor con verdad". "Libre de deforestación"
  -- es una afirmación que alguien tiene que hacer.
  libre_deforestacion_declarado BOOLEAN NOT NULL DEFAULT false,
  legalidad_declarada           BOOLEAN NOT NULL DEFAULT false,

  -- sicr3p NO determina si un predio fue deforestado: eso exige análisis de
  -- imágenes satelitales contra una línea base. Lo que se guarda es la
  -- determinación que hizo OTRO, con quién la emitió y contra qué. Misma
  -- doctrina que "el nivel más alto nunca se emite solo": no se declara una
  -- revisión que nadie hizo.
  determinacion_emisor     TEXT,
  determinacion_linea_base TEXT,
  determinacion_at         DATE,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'carga_produccion_intervalo') THEN
    ALTER TABLE carga_produccion ADD CONSTRAINT carga_produccion_intervalo
      CHECK (desde IS NULL OR hasta IS NULL OR desde <= hasta);
  END IF;
END $$;

-- ---------- El tramo ----------
-- Origen y destino del catálogo de puntos. Puntos FIJOS: acá no se guarda
-- por dónde va la carga, se guarda por dónde va a pasar.
CREATE TABLE IF NOT EXISTS carga_tramo (
  carga_id       UUID PRIMARY KEY REFERENCES cargas(id) ON DELETE CASCADE,
  punto_origen   TEXT REFERENCES puntos_corredor(id),
  punto_destino  TEXT REFERENCES puntos_corredor(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Qué documento exige cada frontera ----------
-- Un cruce Brasil→Paraguay no pide lo mismo que Argentina→Chile. Sin esto,
-- el semáforo documental usa una lista única para toda carga y le dice a
-- todos que les falta lo mismo.
CREATE TABLE IF NOT EXISTS documentos_por_tramo (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pais_desde     TEXT NOT NULL,
  pais_hasta     TEXT NOT NULL,
  tipo_documento TEXT NOT NULL,
  obligatorio    BOOLEAN NOT NULL DEFAULT true,
  nota           TEXT,
  UNIQUE (pais_desde, pais_hasta, tipo_documento)
);

-- ---------- Documentos de la carga, encadenados ----------
-- Cadena de hash PROPIA. La de `sicr3p` vive en otra base y no se puede
-- continuar desde acá — ni conviene: son dos cadenas de dos productos.
CREATE TABLE IF NOT EXISTS carga_documentos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  carga_id       UUID NOT NULL REFERENCES cargas(id) ON DELETE CASCADE,
  tipo_documento TEXT NOT NULL,
  archivo_original TEXT,
  extension      TEXT,
  tamano_bytes   BIGINT,
  sha256         TEXT,

  hash_documento TEXT,
  hash_anterior  TEXT,
  hash_cadena    TEXT,
  eslabon        INTEGER,

  estado         TEXT NOT NULL DEFAULT 'pendiente_revision'
                   CHECK (estado IN ('leido', 'pendiente_revision', 'sin_texto', 'rechazado')),
  subido_por     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_carga_documentos_carga ON carga_documentos (carga_id, created_at DESC);

-- ---------- Los hitos del viaje ----------
-- UN EVENTO, NO UN RASTRO. Se registra que la carga pasó por un punto de
-- control conocido, con la hora. No hay columna de latitud ni longitud
-- acá, y no la va a haber: las coordenadas que importan son las del punto,
-- que ya están en `puntos_corredor` y son fijas.
CREATE TABLE IF NOT EXISTS carga_pasos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  carga_id      UUID NOT NULL REFERENCES cargas(id) ON DELETE CASCADE,
  punto_id      TEXT NOT NULL REFERENCES puntos_corredor(id),
  registrado_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Cuándo lo capturó el dispositivo, que puede ser bastante antes de
  -- cuándo llegó al servidor: los pasos fronterizos son justo donde no hay
  -- señal, y el registro se encola y se reintenta.
  capturado_at  TIMESTAMPTZ,
  via_qr        BOOLEAN NOT NULL DEFAULT false,
  nota          TEXT
);

CREATE INDEX IF NOT EXISTS idx_carga_pasos_carga ON carga_pasos (carga_id, registrado_at);
