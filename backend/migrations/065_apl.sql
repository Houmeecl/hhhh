-- ============================================================
-- sicr3p — Acuerdos de Producción Limpia (APL).
-- Seguimiento del APL que un cliente suscribió: el acuerdo (a qué
-- APL sectorial adhirió y en qué etapa va) y sus metas/acciones
-- individuales, con el estado de avance y una nota de qué evidencia
-- de la plataforma lo respalda (informes, exports, declaraciones).
--
-- Honestidad: esta tabla es un REGISTRO INTERNO de seguimiento.
-- La certificación de cumplimiento de un APL la otorga el sistema
-- APL (auditoría de evaluación de conformidad), no sicr3p — por eso
-- el estado 'certificado' se marca a mano cuando el cliente recibe
-- su certificado, nunca lo "declara" la plataforma por sí sola.
-- ============================================================

CREATE TABLE IF NOT EXISTS apl_acuerdos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id     UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  nombre         TEXT NOT NULL,           -- nombre del APL sectorial (p. ej. "APL Logística ...")
  sector         TEXT,                    -- sector del acuerdo (logística, minería, agro...)
  fecha_adhesion DATE,
  plazo_meses    INT CHECK (plazo_meses IS NULL OR plazo_meses > 0),
  estado         TEXT NOT NULL DEFAULT 'adherido'
                   CHECK (estado IN ('adherido','en_implementacion','en_auditoria','certificado','cerrado')),
  notas          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_apl_acuerdos_cliente ON apl_acuerdos(cliente_id);

CREATE TABLE IF NOT EXISTS apl_metas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  acuerdo_id     UUID NOT NULL REFERENCES apl_acuerdos(id) ON DELETE CASCADE,
  numero         TEXT,                    -- numeración del acuerdo (p. ej. "Meta 3, Acción 3.1")
  descripcion    TEXT NOT NULL,
  tipo           TEXT NOT NULL DEFAULT 'otro'
                   CHECK (tipo IN ('energia','residuos','agua','emisiones','capacitacion','gestion','otro')),
  estado         TEXT NOT NULL DEFAULT 'pendiente'
                   CHECK (estado IN ('pendiente','en_avance','cumplida','no_aplica')),
  -- Qué respaldo aporta la plataforma para esta meta (elegido a mano):
  -- el módulo NUNCA marca una meta como cumplida por su cuenta.
  fuente_evidencia TEXT
                   CHECK (fuente_evidencia IS NULL OR fuente_evidencia IN
                     ('informe_mensual','alcance3','rep_declaraciones','capacitacion','cadena_hash','otra')),
  evidencia      TEXT,                    -- detalle libre (nº de informe, periodo, serial...)
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_apl_metas_acuerdo ON apl_metas(acuerdo_id);
