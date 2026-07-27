-- ============================================================
-- 037: Capacitación interna (cursos + evaluación + constancia).
--
-- Contexto: capacitación para el PERSONAL que ya opera la plataforma
-- (cuentas admin/operador de /admin o /panel-verde) — no es un servicio
-- que se ofrezca a clientes ni se anuncia en la landing pública. Un
-- curso tiene lecciones ordenadas y un banco de preguntas de opción
-- múltiple; al completar todas las lecciones y aprobar el quiz
-- (≥70%, ver NOTA_APROBACION en services/capacitacion.js) se emite una
-- constancia con serial propio, verificable públicamente por ese
-- serial (mismo patrón que tarjetas_viaje/credencial — el serial ES la
-- credencial, sin requerir login para verificarla). No se integra a la
-- cadena de hash global (cadenaGlobal.js): esa cadena es para
-- documentos de contabilidad de carbono/trazabilidad de origen: mezclar
-- constancias de capacitación interna ahí diluiría su significado.
-- ============================================================

CREATE TABLE IF NOT EXISTS cursos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL UNIQUE,
  titulo      TEXT NOT NULL,
  descripcion TEXT,
  orden       INT NOT NULL DEFAULT 0,
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lecciones (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  curso_id   UUID NOT NULL REFERENCES cursos(id) ON DELETE CASCADE,
  titulo     TEXT NOT NULL,
  tipo       TEXT NOT NULL DEFAULT 'texto' CHECK (tipo IN ('texto', 'video')),
  contenido  TEXT NOT NULL,
  url_video  TEXT,
  orden      INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (curso_id, orden)
);

CREATE TABLE IF NOT EXISTS preguntas (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  curso_id   UUID NOT NULL REFERENCES cursos(id) ON DELETE CASCADE,
  enunciado  TEXT NOT NULL,
  orden      INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (curso_id, orden)
);

CREATE TABLE IF NOT EXISTS opciones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pregunta_id UUID NOT NULL REFERENCES preguntas(id) ON DELETE CASCADE,
  texto       TEXT NOT NULL,
  correcta    BOOLEAN NOT NULL DEFAULT false,
  orden       INT NOT NULL DEFAULT 0,
  UNIQUE (pregunta_id, orden)
);

CREATE TABLE IF NOT EXISTS inscripciones (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id    UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  curso_id      UUID NOT NULL REFERENCES cursos(id) ON DELETE CASCADE,
  estado        TEXT NOT NULL DEFAULT 'en_curso' CHECK (estado IN ('en_curso', 'aprobado')),
  iniciado_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completado_at TIMESTAMPTZ,
  UNIQUE (usuario_id, curso_id)
);

CREATE TABLE IF NOT EXISTS progreso_lecciones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inscripcion_id UUID NOT NULL REFERENCES inscripciones(id) ON DELETE CASCADE,
  leccion_id     UUID NOT NULL REFERENCES lecciones(id) ON DELETE CASCADE,
  completada_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (inscripcion_id, leccion_id)
);

CREATE TABLE IF NOT EXISTS intentos_quiz (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inscripcion_id UUID NOT NULL REFERENCES inscripciones(id) ON DELETE CASCADE,
  respuestas     JSONB NOT NULL,
  puntaje_pct    NUMERIC(5, 1) NOT NULL,
  aprobado       BOOLEAN NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_intentos_quiz_inscripcion ON intentos_quiz (inscripcion_id, created_at DESC);

CREATE TABLE IF NOT EXISTS constancias (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inscripcion_id UUID NOT NULL UNIQUE REFERENCES inscripciones(id) ON DELETE CASCADE,
  serial         TEXT NOT NULL UNIQUE,
  puntaje_pct    NUMERIC(5, 1) NOT NULL DEFAULT 0,
  hash_documento TEXT NOT NULL,
  emitida_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Guardia por si la tabla ya existía sin esta columna (misma migración,
-- corrida antes de agregarla en una versión previa de este archivo).
ALTER TABLE constancias ADD COLUMN IF NOT EXISTS puntaje_pct NUMERIC(5, 1) NOT NULL DEFAULT 0;

-- ============================================================
-- Semilla: 2 cursos reales (no texto de relleno). El contenido está
-- tomado directamente de comportamiento ya construido en la
-- plataforma (CargarAv.jsx, DeclaracionEmbalaje.jsx) y de las reglas
-- REP ya usadas en frontend/src/lib/rep.js — sin inventar cifras
-- nuevas. Agregar más cursos después es solo más filas de seed.
-- ============================================================

INSERT INTO cursos (slug, titulo, descripcion, orden) VALUES
  ('panel-mostrador', 'Uso del panel de mostrador',
   'Cómo un operador procesa un trámite completo en /panel-verde: cargar, declarar REP, cobrar y entregar el comprobante.', 1),
  ('fundamentos-rep', 'Fundamentos REP · Ley 20.920',
   'Qué declara sicr3p sobre reciclabilidad de embalajes y cómo se calcula, para poder explicárselo al cliente en el mostrador.', 2)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO lecciones (curso_id, titulo, contenido, orden) VALUES
  ((SELECT id FROM cursos WHERE slug = 'panel-mostrador'), 'Cómo entrar al panel',
   'Ingresa a /panel-verde/login con tu correo y contraseña de operador. Si aún no tienes cuenta, pídele a un administrador que te la cree desde Usuarios y te envíe el correo de activación.', 1),
  ((SELECT id FROM cursos WHERE slug = 'panel-mostrador'), 'Cargar un documento',
   'En "Cargar documento" completa RUT, empresa y correo del cliente, y agrega hasta 5 archivos (PDF, XML, JPG, PNG o HEIC) con el botón "Tomar foto" o "Elegir archivos". El sistema lee y calcula el CO2e solo — no se digita ningún dato del documento.', 2),
  ((SELECT id FROM cursos WHERE slug = 'panel-mostrador'), 'Si un documento no se puede leer',
   'Si algún archivo queda ilegible, el sistema rechaza TODO el envío y marca cuáles hay que re-escanear (nunca se corrige un dato a mano). Vuelve a escanear solo esos archivos y reintenta el envío completo.', 3),
  ((SELECT id FROM cursos WHERE slug = 'panel-mostrador'), 'Declarar REP y cobrar la compensación',
   'Tras procesar el trámite puedes declarar la composición del embalaje (Ley 20.920) y registrar una compensación voluntaria de CO2e. Ambos pasos son OPCIONALES y quedan marcados en la barra de pasos del trámite (Trámite → REP → Compensación).', 4),
  ((SELECT id FROM cursos WHERE slug = 'panel-mostrador'), 'Entregar el comprobante',
   'Cada documento procesado genera un QR de verificación: imprime el sticker y entrega el informe o la carpeta de evidencia al cliente, o envíaselos por correo desde el mismo trámite.', 5)
ON CONFLICT (curso_id, orden) DO NOTHING;

INSERT INTO lecciones (curso_id, titulo, contenido, orden) VALUES
  ((SELECT id FROM cursos WHERE slug = 'fundamentos-rep'), '¿Qué es la Ley REP?',
   'La Ley 20.920 (Responsabilidad Extendida del Productor) obliga a quienes ponen en el mercado ciertos productos prioritarios — entre ellos envases y embalajes — a cumplir metas de recolección y valorización.', 1),
  ((SELECT id FROM cursos WHERE slug = 'fundamentos-rep'), 'Materiales que se declaran',
   'La declaración de embalaje en sicr3p distingue 7 categorías de material: papel y cartón, plásticos, vidrio, metales, madera, compuestos y otros.', 2),
  ((SELECT id FROM cursos WHERE slug = 'fundamentos-rep'), 'Cómo se calcula la reciclabilidad',
   'El % de reciclabilidad es el peso reciclable dividido por el peso total del embalaje declarado, multiplicado por 100. Con ese porcentaje, la declaración queda en un nivel: Alto (≥70%), Medio (≥50%) o Bajo (menor a 50%).', 3),
  ((SELECT id FROM cursos WHERE slug = 'fundamentos-rep'), 'El umbral de exención',
   'El Art. 25 de la Ley 20.920 permite que quienes pongan en el mercado menos de 300 kg de envases al año puedan quedar exentos de las metas — es un dato referencial, se valida con el Ministerio del Medio Ambiente (MMA).', 4),
  ((SELECT id FROM cursos WHERE slug = 'fundamentos-rep'), 'Qué NO reemplaza esta declaración',
   'La pre-declaración que se hace en sicr3p es un apoyo operativo en el punto de captura; no reemplaza la declaración formal ante el MMA (RETC/SGR).', 5)
ON CONFLICT (curso_id, orden) DO NOTHING;

INSERT INTO preguntas (curso_id, enunciado, orden) VALUES
  ((SELECT id FROM cursos WHERE slug = 'panel-mostrador'), '¿Dónde inicias sesión como operador del mostrador?', 1),
  ((SELECT id FROM cursos WHERE slug = 'panel-mostrador'), '¿Cuántos documentos como máximo se pueden cargar en un mismo trámite?', 2),
  ((SELECT id FROM cursos WHERE slug = 'panel-mostrador'), '¿Qué pasa si un documento del lote no se puede leer automáticamente?', 3),
  ((SELECT id FROM cursos WHERE slug = 'panel-mostrador'), '¿La declaración REP y la compensación voluntaria son obligatorias para cerrar un trámite?', 4),
  ((SELECT id FROM cursos WHERE slug = 'panel-mostrador'), '¿Qué recibe el cliente al final del trámite?', 5)
ON CONFLICT (curso_id, orden) DO NOTHING;

INSERT INTO opciones (pregunta_id, texto, correcta, orden) VALUES
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'panel-mostrador') AND orden = 1), '/panel-verde/login', true, 1),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'panel-mostrador') AND orden = 1), '/pos', false, 2),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'panel-mostrador') AND orden = 1), '/admin/cursos', false, 3),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'panel-mostrador') AND orden = 1), '/verificar', false, 4),

  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'panel-mostrador') AND orden = 2), '5', true, 1),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'panel-mostrador') AND orden = 2), '1', false, 2),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'panel-mostrador') AND orden = 2), '10', false, 3),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'panel-mostrador') AND orden = 2), 'Sin límite', false, 4),

  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'panel-mostrador') AND orden = 3), 'Se corrige el dato a mano', false, 1),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'panel-mostrador') AND orden = 3), 'Se rechaza todo el envío y se debe re-escanear', true, 2),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'panel-mostrador') AND orden = 3), 'Se ignora ese documento y se sigue con el resto', false, 3),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'panel-mostrador') AND orden = 3), 'Se aprueba con datos estimados', false, 4),

  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'panel-mostrador') AND orden = 4), 'Sí, ambas son obligatorias', false, 1),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'panel-mostrador') AND orden = 4), 'No, ambas son opcionales', true, 2),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'panel-mostrador') AND orden = 4), 'Solo REP es obligatoria', false, 3),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'panel-mostrador') AND orden = 4), 'Solo la compensación es obligatoria', false, 4),

  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'panel-mostrador') AND orden = 5), 'Solo un correo', false, 1),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'panel-mostrador') AND orden = 5), 'Un sticker con QR de verificación y su informe o carpeta', true, 2),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'panel-mostrador') AND orden = 5), 'Nada, se genera después', false, 3),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'panel-mostrador') AND orden = 5), 'Una clave de acceso al panel', false, 4)
ON CONFLICT (pregunta_id, orden) DO NOTHING;

INSERT INTO preguntas (curso_id, enunciado, orden) VALUES
  ((SELECT id FROM cursos WHERE slug = 'fundamentos-rep'), '¿Qué obliga la Ley 20.920?', 1),
  ((SELECT id FROM cursos WHERE slug = 'fundamentos-rep'), '¿Cuántas categorías de material se usan para declarar un embalaje en sicr3p?', 2),
  ((SELECT id FROM cursos WHERE slug = 'fundamentos-rep'), '¿Cómo se calcula el % de reciclabilidad?', 3),
  ((SELECT id FROM cursos WHERE slug = 'fundamentos-rep'), '¿Desde qué nivel de reciclabilidad se considera "Alto"?', 4),
  ((SELECT id FROM cursos WHERE slug = 'fundamentos-rep'), '¿La pre-declaración en sicr3p reemplaza la declaración formal ante el MMA?', 5)
ON CONFLICT (curso_id, orden) DO NOTHING;

INSERT INTO opciones (pregunta_id, texto, correcta, orden) VALUES
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'fundamentos-rep') AND orden = 1), 'Cumplir metas de recolección y valorización de productos prioritarios', true, 1),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'fundamentos-rep') AND orden = 1), 'Pagar un impuesto verde', false, 2),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'fundamentos-rep') AND orden = 1), 'Reemplazar todos los envases por vidrio', false, 3),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'fundamentos-rep') AND orden = 1), 'Prohibir el uso de plástico', false, 4),

  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'fundamentos-rep') AND orden = 2), '7', true, 1),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'fundamentos-rep') AND orden = 2), '3', false, 2),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'fundamentos-rep') AND orden = 2), '12', false, 3),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'fundamentos-rep') AND orden = 2), '5', false, 4),

  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'fundamentos-rep') AND orden = 3), 'Peso reciclable / peso total × 100', true, 1),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'fundamentos-rep') AND orden = 3), 'Cantidad de componentes reciclables / total de componentes', false, 2),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'fundamentos-rep') AND orden = 3), 'Precio del embalaje / precio total', false, 3),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'fundamentos-rep') AND orden = 3), 'Volumen reciclable / volumen total', false, 4),

  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'fundamentos-rep') AND orden = 4), '≥70%', true, 1),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'fundamentos-rep') AND orden = 4), '≥50%', false, 2),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'fundamentos-rep') AND orden = 4), '≥90%', false, 3),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'fundamentos-rep') AND orden = 4), '≥30%', false, 4),

  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'fundamentos-rep') AND orden = 5), 'Sí, siempre', false, 1),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'fundamentos-rep') AND orden = 5), 'No, es un apoyo operativo — no reemplaza la declaración formal', true, 2),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'fundamentos-rep') AND orden = 5), 'Solo si el cliente lo pide', false, 3),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'fundamentos-rep') AND orden = 5), 'Solo para embalajes de plástico', false, 4)
ON CONFLICT (pregunta_id, orden) DO NOTHING;
