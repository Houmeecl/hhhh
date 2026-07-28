-- ============================================================
-- 054: ejercicio de derechos del titular (Ley 21.719).
--
-- Acceso, rectificación, supresión, oposición y portabilidad. Hasta ahora
-- no había ningún canal: la única forma de borrar a alguien era un DELETE
-- a mano desde el panel, sin constancia de quién lo pidió ni de qué se
-- respondió.
--
-- Quien ejerce puede no tener cuenta: el contacto de un cliente, el
-- conductor de una tarjeta, alguien que postuló a un auspicio hace un
-- año. Por eso la solicitud se identifica por RUT o correo, no por
-- usuario_id, y el formulario es público.
--
-- IMPORTANTE — la supresión tiene un límite que hay que responder, no
-- ejecutar: los registros contables encadenados por hash se conservan por
-- obligación legal y para el ejercicio de reclamaciones. `resolucion`
-- guarda qué se hizo y qué quedó retenido con su fundamento, para que la
-- respuesta al titular salga del sistema y no de la memoria de quien
-- atendió. Ver services/inventarioDatos.js.
-- ============================================================

CREATE TABLE IF NOT EXISTS solicitudes_arcop (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  derecho        TEXT NOT NULL
                   CHECK (derecho IN ('acceso','rectificacion','supresion','oposicion','portabilidad')),
  -- Identificación del titular. Al menos uno de los dos; el CHECK lo exige.
  rut            TEXT,
  email          TEXT,
  nombre         TEXT,
  -- Qué pide, en sus palabras. Para rectificación es donde dice qué está mal.
  detalle        TEXT,
  estado         TEXT NOT NULL DEFAULT 'pendiente'
                   CHECK (estado IN ('pendiente','resuelta','rechazada')),
  -- Qué se hizo y qué quedó retenido, con su fundamento.
  resolucion     TEXT,
  resuelta_por   UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  resuelta_at    TIMESTAMPTZ,
  ip             TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT solicitudes_arcop_identificacion
    CHECK (COALESCE(rut, '') <> '' OR COALESCE(email, '') <> '')
);

-- La bandeja se ordena por antigüedad: lo que lleva más días esperando va
-- primero, porque la ley fija un plazo de respuesta.
CREATE INDEX IF NOT EXISTS idx_arcop_pendientes
  ON solicitudes_arcop(created_at) WHERE estado = 'pendiente';

-- Una sola solicitud pendiente por titular y derecho: reenviar el
-- formulario no llena la bandeja de duplicados. Las ya resueltas no
-- cuentan, así que se puede volver a ejercer el mismo derecho más
-- adelante. Mismo patrón que uq_solicitud_auspicio_pendiente.
CREATE UNIQUE INDEX IF NOT EXISTS uq_arcop_pendiente_rut
  ON solicitudes_arcop(rut, derecho) WHERE estado = 'pendiente' AND rut IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_arcop_pendiente_email
  ON solicitudes_arcop(email, derecho) WHERE estado = 'pendiente' AND rut IS NULL AND email IS NOT NULL;
