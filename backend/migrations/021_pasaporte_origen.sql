-- ============================================================
-- 021: Pasaporte de Origen — trazabilidad minera multi-eslabón
-- (estilo Minespider, integrado a sicr3p).
--
-- Un LOTE MINERAL (lotes_minerales) viaja mina → planta → refinería →
-- exportador → comprador; cada actor añade un ESLABÓN (lote_eslabones,
-- append-only) con divulgación selectiva (publico/cadena/privado) y
-- vínculo OPCIONAL a una factura/DTE real (la diferenciación de sicr3p:
-- evidencia tributaria, no autodeclaración pura).
--
-- Cadena de hash POR LOTE: cada lote tiene su propio génesis y su
-- estado (ultimo_hash/n_eslabones) vive en la fila del lote (lock
-- FOR UPDATE al anexar, mismo patrón que cadena_estado). Se reutilizan
-- las primitivas de services/cadenaHash.js. La cadena global de
-- facturas NO se toca.
--
-- Normativa (campos alineados, jamás "certificados" — sicr3p no es
-- certificador ni autoridad):
--  · OECD Due Diligence Guidance minerales: checklist en
--    lote_declaraciones (5 pasos + banderas Anexo II).
--  · CBAM (Reglamento UE 2023/956): codigo_nc + emisiones incorporadas
--    directas/indirectas por tonelada + método, como columnas del lote.
--  · ESPR/DPP: identificador único (codigo + QR), composición, actores.
-- ============================================================

CREATE TABLE IF NOT EXISTS lotes_minerales (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo          TEXT UNIQUE NOT NULL,          -- público, va en QR/URL: 'LM-2026-000001'
  material        TEXT NOT NULL CHECK (material IN
                    ('cobre_catodo','concentrado_cobre','litio_carbonato','oro','otro')),
  descripcion     TEXT,
  codigo_nc       TEXT,                          -- nomenclatura combinada UE (4-8 dígitos)
  cantidad        NUMERIC(14,3) NOT NULL CHECK (cantidad > 0),
  unidad          TEXT NOT NULL DEFAULT 't' CHECK (unidad IN ('t','kg')),
  pais_origen     TEXT NOT NULL DEFAULT 'CL',    -- ISO-2
  faena_origen    TEXT,                          -- mina/faena (dato "instalación" CBAM/DPP)
  rut_titular     TEXT,                          -- RUT del dueño del lote
  composicion     JSONB NOT NULL DEFAULT '{}',   -- {ley_pct, pureza_pct, ...} — DPP composición
  -- CBAM-ready: DECLARADOS por el titular, por tonelada. El servidor los
  -- contrasta con lo trazado (suma de eslabones) y advierte divergencias.
  emisiones_directas_tco2e_t   NUMERIC(12,6) CHECK (emisiones_directas_tco2e_t >= 0),
  emisiones_indirectas_tco2e_t NUMERIC(12,6) CHECK (emisiones_indirectas_tco2e_t >= 0),
  metodo_emisiones TEXT CHECK (metodo_emisiones IN ('valores_reales','valores_defecto','mixto')),
  fuente_metodologica_id INT REFERENCES fuentes_metodologicas(id),
  estandar_externo JSONB NOT NULL DEFAULT '{}',  -- {copper_mark:{estado,anio,url}, irma:{...}}
  estado          TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto','cerrado')),
  -- Estado de la cadena de hash de ESTE lote (génesis = 64 ceros).
  ultimo_hash     TEXT NOT NULL DEFAULT repeat('0', 64),
  n_eslabones     INT  NOT NULL DEFAULT 0,
  creado_por      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lotes_rut
  ON lotes_minerales (regexp_replace(COALESCE(rut_titular,''), '[^0-9kK]', '', 'g'));
CREATE INDEX IF NOT EXISTS idx_lotes_estado ON lotes_minerales (estado);

-- Eslabones de la cadena de custodia: APPEND-ONLY. Nunca se editan ni
-- borran (rompería el hash); un error se corrige con un eslabón nuevo
-- que declare datos.corrige_eslabon = N.
CREATE TABLE IF NOT EXISTS lote_eslabones (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id       UUID NOT NULL REFERENCES lotes_minerales(id) ON DELETE CASCADE,
  eslabon       INT  NOT NULL,
  rol           TEXT NOT NULL CHECK (rol IN
                  ('mina','planta','refineria','transporte','comerciante','exportador','comprador')),
  rut_empresa   TEXT,                            -- nullable: extranjeros usan datos.tax_id_extranjero
  nombre_empresa TEXT,
  pais          TEXT NOT NULL DEFAULT 'CL',
  fecha         DATE NOT NULL,
  cantidad      NUMERIC(14,3) CHECK (cantidad > 0),  -- lo que este actor recibió/entregó (balance de masas)
  factura_id    UUID REFERENCES facturas(id),    -- vínculo opcional al DTE real
  co2e_aportado NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (co2e_aportado >= 0),
  visibilidad   TEXT NOT NULL DEFAULT 'publico' CHECK (visibilidad IN ('publico','cadena','privado')),
  datos         JSONB NOT NULL DEFAULT '{}',     -- {lat,lng,documento_transporte,tramo,tax_id_extranjero,corrige_eslabon,...}
  -- El nonce (16 bytes hex) entra al preimage del hash: un eslabón con
  -- visibilidad restringida publica su hash sin que el contenido sea
  -- adivinable por fuerza bruta del preimage. Jamás se expone.
  nonce         TEXT NOT NULL,
  hash_documento TEXT NOT NULL,
  hash_anterior  TEXT NOT NULL,
  hash_cadena    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lote_id, eslabon)
);
CREATE INDEX IF NOT EXISTS idx_lote_eslabones_lote ON lote_eslabones (lote_id, eslabon);
CREATE INDEX IF NOT EXISTS idx_lote_eslabones_rut
  ON lote_eslabones (regexp_replace(COALESCE(rut_empresa,''), '[^0-9kK]', '', 'g'));

-- Checklist normativo por lote. El catálogo de códigos vive como
-- constante en services/pasaporteOrigen.js (versionado con el código,
-- i18n en el frontend) — acá solo se persiste el estado por lote.
CREATE TABLE IF NOT EXISTS lote_declaraciones (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id       UUID NOT NULL REFERENCES lotes_minerales(id) ON DELETE CASCADE,
  codigo        TEXT NOT NULL,   -- 'oecd_p1'..'oecd_p5', 'oecd_a2_*', 'dpp_*'
  estado        TEXT NOT NULL DEFAULT 'pendiente'
                CHECK (estado IN ('pendiente','declarado','con_evidencia','no_aplica')),
  detalle       TEXT,
  evidencia_url TEXT,
  declarado_por UUID,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lote_id, codigo)
);

-- ---------- Seed: fuentes metodológicas citables (patrón 018) ----------
INSERT INTO fuentes_metodologicas (codigo, organismo, documento, version_anio, url, notas) VALUES
  ('oecd_ddg_3ed', 'OCDE',
   'OECD Due Diligence Guidance for Responsible Supply Chains of Minerals from Conflict-Affected and High-Risk Areas, 3rd Edition',
   '2016', 'https://www.oecd.org/en/publications/oecd-due-diligence-guidance-for-responsible-supply-chains-of-minerals-from-conflict-affected-and-high-risk-areas_9789264252479-en.html',
   'Marco de 5 pasos + Anexo II. Avala el marco de referencia del checklist, no a sicr3p: sicr3p registra declaraciones y evidencia de los actores, no audita ni certifica.'),
  ('cbam_2023_956', 'Unión Europea',
   'Reglamento (UE) 2023/956 — Mecanismo de Ajuste en Frontera por Carbono (CBAM)',
   '2023', 'https://eur-lex.europa.eu/eli/reg/2023/956/oj',
   'Estructura de datos alineada (código NC, emisiones incorporadas directas/indirectas por tonelada, método). La declaración CBAM la presenta el importador UE; el cobre no está en el Anexo I vigente.')
ON CONFLICT (codigo) DO NOTHING;

-- (Fase 3, documentado a propósito: al CERRAR un lote, registrar su
-- ultimo_hash como checkpoint en la cadena global de facturas para
-- heredar la auditabilidad de /api/publico/cadena.)
