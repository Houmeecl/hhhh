-- ============================================================
-- 055: registro de brechas de seguridad (Ley 21.719).
--
-- La ley obliga a notificar las vulneraciones a la Agencia sin dilación,
-- y a los titulares afectados cuando el riesgo para ellos es alto. Eso
-- exige tener dónde anotar qué pasó, cuándo se supo, a quién se avisó y
-- cuándo — porque en una brecha la cronología ES la defensa.
--
-- El PLAZO exacto de notificación no se fija acá ni en el código: hay que
-- contrastarlo con el texto oficial antes de escribirlo en ninguna parte.
-- El procedimiento (quién decide, en qué orden se avisa) vive en
-- docs/PROTECCION-DE-DATOS.md, no en una tabla.
--
-- Esta tabla se llena a mano: no hay detección automática de brechas y
-- fingir que la hay sería peor que no tenerla.
-- ============================================================

CREATE TABLE IF NOT EXISTS brechas_seguridad (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo              TEXT NOT NULL,
  descripcion         TEXT NOT NULL,
  -- Cuándo ocurrió y cuándo nos enteramos: casi nunca es lo mismo, y la
  -- diferencia es justamente lo que hay que poder explicar.
  ocurrida_at         TIMESTAMPTZ,
  detectada_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Qué se vio comprometido, en las palabras del inventario
  -- (services/inventarioDatos.js).
  datos_afectados     TEXT,
  titulares_afectados INT,
  riesgo              TEXT NOT NULL DEFAULT 'por_evaluar'
                        CHECK (riesgo IN ('por_evaluar','bajo','medio','alto')),
  estado              TEXT NOT NULL DEFAULT 'abierta'
                        CHECK (estado IN ('abierta','contenida','cerrada')),
  -- La cronología de avisos. NULL = todavía no se ha hecho.
  notificada_agencia_at   TIMESTAMPTZ,
  notificados_titulares_at TIMESTAMPTZ,
  -- Por qué NO se notificó, si se decidió no hacerlo. Una decisión así
  -- tiene que quedar fundada, no solo tomada.
  motivo_no_notificar TEXT,
  medidas             TEXT,
  registrada_por      UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brechas_abiertas
  ON brechas_seguridad(detectada_at DESC) WHERE estado <> 'cerrada';
