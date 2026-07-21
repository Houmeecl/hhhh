-- ============================================================
-- 023: Tres tipos de pasaporte de origen — el módulo deja de estar
-- amarrado a minería:
--   · 'documental' → Corredor Bioceánico: trazabilidad de carga y
--     documentos por tramos (vinculable a documentos_corredor).
--   · 'producto'   → ciudad / Aduana Verde: productos de comercios de
--     cualquier rubro (alimentos, textil, embalajes, …).
--   · 'mineral'    → lo construido en 021 queda como un tipo más.
--
-- La tabla conserva su nombre físico `lotes_minerales` por
-- compatibilidad (FKs, código); conceptualmente es "lotes".
-- Los catálogos de material y rol pasan a validarse EN EL SERVICIO
-- por tipo (services/pasaporteOrigen.js), por eso se sueltan los
-- CHECK rígidos de 021/022.
-- ============================================================

ALTER TABLE lotes_minerales ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'mineral'
  CHECK (tipo IN ('mineral','producto','documental'));

-- El catálogo de materiales ahora depende del tipo (servicio):
ALTER TABLE lotes_minerales DROP CONSTRAINT IF EXISTS lotes_minerales_material_check;
-- Los roles ahora dependen del tipo (servicio):
ALTER TABLE lote_eslabones DROP CONSTRAINT IF EXISTS lote_eslabones_rol_check;

-- El tipo documental ancla eslabones también a los documentos del
-- Corredor (MIC/DTA, manifiestos — migración 002), no solo a facturas.
ALTER TABLE lote_eslabones ADD COLUMN IF NOT EXISTS
  documento_corredor_id UUID REFERENCES documentos_corredor(id);
