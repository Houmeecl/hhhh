-- ============================================================
-- 003: El tramo con contenido — catálogo de puntos y qué documento
--      pide cada cruce.
--
-- La 002 creó `puntos_corredor` y `documentos_por_tramo` vacías. Vacías
-- no sirven: sin puntos no se puede definir un tramo, y sin reglas el
-- semáforo documental le dice a todas las cargas que les falta lo mismo.
--
-- QUÉ ES ESTA LISTA Y QUÉ NO ES. Es la evidencia que sicr3p le pide al
-- exportador para armar el expediente que van a exigir CBAM, el EUDR o el
-- comprador. NO es la lista de la aduana: el despacho y el tránsito los
-- ve el agente de aduana, y sicr3p no opina de eso (docs/CORREDOR-ALCANCE.md).
-- Por eso cada regla lleva su `nota` diciendo PARA QUÉ se pide.
--
-- Todo con ON CONFLICT DO NOTHING: `migrate.js` no lleva registro de
-- migraciones y corre todos los .sql en cada arranque.
-- ============================================================

-- ---------- Catálogo de puntos ----------
-- Mismos puntos y mismas coordenadas que la migración 093 de la otra base.
-- Es una copia, no una referencia: son dos bases distintas y Postgres no
-- permite claves foráneas entre ellas. Lugares fijos y públicos —aduanas,
-- ciudades, puertos—, nada que diga dónde está una carga.
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

-- ---------- Qué documento pide cada cruce ----------
-- '*' en pais_desde/pais_hasta = cualquiera. Sirve para lo que se pide
-- por EXPORTAR y no por cruzar una frontera en particular; repetirlo país
-- por país obligaría a editar la misma regla en doce filas.
INSERT INTO documentos_por_tramo (pais_desde, pais_hasta, tipo_documento, obligatorio, nota) VALUES
  -- Se pide en todo tramo, cruce fronteras o no.
  ('*', '*', 'factura_comercial', true,
   'Respalda la operación y el valor declarado. La necesita el comprador para su propio inventario y el importador para su declaración CBAM.'),
  ('*', '*', 'certificado_origen', true,
   'Acredita el país de origen de la mercancía. Es la base del expediente: sin origen, ninguno de los regímenes se puede sostener.'),
  ('*', '*', 'carta_porte_internacional', true,
   'Documento de transporte del tramo terrestre (CRT). Acredita que la carga recorrió efectivamente este tramo, con quién y cuándo.'),
  ('*', '*', 'packing_list', false,
   'Detalle de bultos y pesos. No lo exige ninguna norma ambiental, pero es lo que permite cuadrar la cantidad declarada con lo que llegó.'),

  -- Brasil → Paraguay. Salida de la zona productora del Cono Sur: soya y
  -- madera, ambas del Anexo I del EUDR.
  ('BR', 'PY', 'certificado_fitosanitario', true,
   'Emitido por el MAPA para producto de origen vegetal. Es la evidencia de legalidad en el país de producción que pide el EUDR.'),
  ('BR', 'PY', 'documento_origen_forestal', false,
   'DOF brasileño. Obligatorio SOLO si la carga es madera o derivados: acredita el origen legal de la extracción (EUDR, legalidad).'),

  -- Paraguay → Argentina.
  ('PY', 'AR', 'certificado_fitosanitario', true,
   'Emitido por el SENAVE si el producto es de origen vegetal. Evidencia de legalidad en el país de producción (EUDR).'),
  ('PY', 'AR', 'guia_forestal', false,
   'Guía del INFONA. Obligatoria SOLO si la carga es madera o derivados.'),

  -- Argentina → Chile (Paso de Jama). Último cruce terrestre antes del
  -- puerto: acá se junta lo del tramo con lo del embarque.
  ('AR', 'CL', 'declaracion_jurada_origen', true,
   'Declaración del exportador sobre el origen del producto, que es lo que después firma en la diligencia debida del EUDR.'),
  ('AR', 'CL', 'certificado_fitosanitario', false,
   'Reemplaza o complementa al del cruce anterior cuando el SAG lo exige al ingreso.')
ON CONFLICT (pais_desde, pais_hasta, tipo_documento) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_documentos_por_tramo_cruce
  ON documentos_por_tramo (pais_desde, pais_hasta);

-- ---------- Estado de la cadena de hash del Corredor ----------
-- Fila única que se bloquea con FOR UPDATE al anexar un documento, para
-- serializar dos subidas concurrentes. Es el mismo patrón que
-- `cadena_estado` en la base de sicr3p, y es una tabla APARTE porque son
-- dos cadenas de dos productos distintos: continuar la de sicr3p desde
-- otra base no se puede (Postgres no permite referencias entre bases) y
-- tampoco conviene — quien verifique un documento del Corredor no tiene
-- por qué poder recorrer la cadena de las facturas de otra empresa.
CREATE TABLE IF NOT EXISTS cadena_estado_corredor (
  id           INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ultimo_hash  TEXT NOT NULL DEFAULT repeat('0', 64),  -- génesis
  n_eslabones  BIGINT NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO cadena_estado_corredor (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Un mismo archivo no se sella dos veces para la misma carga: el sha256
-- es la identidad del documento, y dos filas con el mismo sha256 en la
-- misma carga son la misma evidencia contada dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS uq_carga_documentos_sha
  ON carga_documentos (carga_id, sha256) WHERE sha256 IS NOT NULL;
