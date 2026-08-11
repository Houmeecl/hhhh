-- ============================================================
-- sicr3p — Interesados del sitio público (captación de leads).
--
-- Hueco real del embudo: 6 CTAs de las landings (/corredor, /instituto,
-- /prueba) terminaban en mailto: — en el celular suele no abrir nada y
-- el interesado se pierde sin dejar rastro — y la calculadora de la
-- portada dejaba estimar CO2e sin pedir el correo. Esta tabla recibe
-- esos contactos livianos (a diferencia de solicitudes_inscripcion, acá
-- NO se exige RUT: es un primer toque, no una postulación formal).
--
-- Datos personales: la entrada correspondiente vive en
-- services/inventarioDatos.js (base: consentimiento) y la purga de
-- descartados en services/retencion.js — el test de inventario obliga a
-- mantener las tres piezas sincronizadas.
-- ============================================================

CREATE TABLE IF NOT EXISTS interesados (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  origen     TEXT NOT NULL CHECK (origen IN
               ('calculadora','corredor','instituto','prueba','magic_sin_historial','otro')),
  nombre     TEXT,
  email      TEXT NOT NULL,
  empresa    TEXT,
  telefono   TEXT,
  mensaje    TEXT,
  estimacion JSONB,   -- solo origen 'calculadora': la estimación que hizo en la portada
  estado     TEXT NOT NULL DEFAULT 'nuevo'
               CHECK (estado IN ('nuevo','contactado','descartado')),
  ip         TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interesados_estado ON interesados(estado, created_at DESC);

-- Un mismo correo no acumula filas 'nuevo' por el mismo origen: reenviar
-- el formulario (o recalcular en la calculadora) actualiza la fila vía
-- ON CONFLICT en la ruta, en vez de duplicar y llenar la bandeja del
-- equipo con el mismo lead.
CREATE UNIQUE INDEX IF NOT EXISTS uq_interesado_nuevo
  ON interesados(lower(email), origen) WHERE estado = 'nuevo';
