-- ============================================================
-- Catálogo de puntos de control del Corredor Bioceánico en BD — hasta
-- ahora vivía hardcodeado y duplicado (PUNTOS_CORREDOR en
-- frontend/src/lib/corredor.js con coordenadas, PUNTOS_CORREDOR_IDS en
-- backend/src/services/pasaporteOrigen.js solo con los ids): agregar o
-- corregir un punto requería un deploy. Con esta tabla el admin lo
-- gestiona desde el panel (routes/corredor.js) y el frontend la lee vía
-- GET /api/corredor/puntos con FALLBACK al catálogo estático si el
-- fetch falla — los arrays estáticos NO se eliminan: son el respaldo y
-- el estado inicial (ver services/catalogoCorredor.js).
--
-- PK = slug (no UUID): la identidad del punto ya está sellada como
-- datos.punto_id en eslabones históricos append-only — un UUID solo
-- agregaría una indirección. Por lo mismo NO hay DELETE jamás: un punto
-- que sale de servicio se marca activo=false y su id queda reservado
-- (los pasos históricos lo siguen referenciando).
--
-- `orden` es el índice del punto a lo largo del corredor (Campo Grande=0
-- → puertos de Antofagasta): lo usan la detección de retrocesos y los
-- KPIs de tiempo por tramo (pares consecutivos orden n → n+1).
-- ============================================================

CREATE TABLE IF NOT EXISTS puntos_corredor (
  id          TEXT PRIMARY KEY,
  nombre      TEXT NOT NULL,
  pais        TEXT NOT NULL CHECK (pais IN ('BR','PY','AR','CL')),
  lat         NUMERIC(9,6) NOT NULL,
  lng         NUMERIC(9,6) NOT NULL,
  orden       INTEGER NOT NULL,
  es_frontera BOOLEAN NOT NULL DEFAULT false,
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed: los 14 puntos fundacionales, espejo EXACTO del array estático
-- (mismo orden = mismo índice). Idempotente: si la fila ya existe (o el
-- admin ya la editó), no se toca.
INSERT INTO puntos_corredor (id, nombre, pais, lat, lng, orden, es_frontera) VALUES
  ('campo-grande',          'Campo Grande',                     'BR', -20.4697, -54.6201, 0,  false),
  ('ponta-pora',            'Ponta Porã (frontera BR/PY)',      'BR', -22.5361, -55.7256, 1,  true),
  ('loma-plata',            'Loma Plata',                       'PY', -22.3833, -59.85,   2,  false),
  ('mariscal-estigarribia', 'Mariscal Estigarribia',            'PY', -22.0333, -60.6167, 3,  false),
  ('pozo-hondo',            'Pozo Hondo (frontera PY/AR)',      'PY', -22.2833, -62.8667, 4,  true),
  ('tartagal',              'Tartagal',                         'AR', -22.5164, -63.8069, 5,  false),
  ('jujuy',                 'San Salvador de Jujuy',            'AR', -24.1858, -65.2995, 6,  false),
  ('susques',               'Susques',                          'AR', -23.4167, -66.3667, 7,  false),
  ('paso-de-jama',          'Paso de Jama (frontera AR/CL)',    'AR', -23.2358, -67.0333, 8,  true),
  ('san-pedro-de-atacama',  'San Pedro de Atacama',             'CL', -22.9098, -68.1997, 9,  false),
  ('calama',                'Calama',                           'CL', -22.4544, -68.9294, 10, false),
  ('puerto-seco',           'Puerto seco (La Negra, interior)', 'CL', -23.766,  -70.323,  11, false),
  ('puerto-antofagasta',    'Puerto Antofagasta',               'CL', -23.648,  -70.4046, 12, false),
  ('puerto-mejillones',     'Puerto Mejillones',                'CL', -23.0959, -70.4519, 13, false)
ON CONFLICT (id) DO NOTHING;
