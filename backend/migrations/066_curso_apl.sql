-- ============================================================
-- 066: Instituto sicr3p — curso público "APL en simple".
--
-- Acompaña al módulo APL (migración 065): un curso corto para que el
-- equipo de un cliente entienda qué es un Acuerdo de Producción
-- Limpia antes de llevar su seguimiento en la plataforma. Mismo
-- modelo que 037/063 (lecciones + quiz ≥70% + constancia verificable).
--
-- Fuentes del contenido (verificadas contra fuentes públicas antes de
-- redactar; lo no confirmable se dejó fuera): Ley 20.416 Art. Noveno,
-- ASCC (ascc.cl), normas NCh2796/2797/2807/2825, registro NAMA 2012.
-- ============================================================

INSERT INTO cursos (slug, titulo, descripcion, orden, es_publico) VALUES
  ('apl-en-simple', 'APL en simple',
   'Qué es un Acuerdo de Producción Limpia, qué ciclo vive una empresa adherida, qué exige el certificado de cumplimiento y cómo la plataforma respalda tus metas con evidencia trazable.', 5, true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO lecciones (curso_id, titulo, contenido, orden) VALUES
  ((SELECT id FROM cursos WHERE slug = 'apl-en-simple'), 'Qué es un APL',
   'Un Acuerdo de Producción Limpia (APL) es un convenio voluntario entre un sector empresarial (o empresas) y órganos del Estado, con metas y acciones de producción sustentable que van más allá de lo que exige la ley. Está definido en el Artículo Noveno de la Ley N° 20.416 y lo coordina la Agencia de Sustentabilidad y Cambio Climático (ASCC), comité de CORFO. La lista de acuerdos se consulta en ascc.cl.', 1),
  ((SELECT id FROM cursos WHERE slug = 'apl-en-simple'), 'El marco técnico',
   'El sistema APL se rige por normas chilenas: NCh2796 (vocabulario), NCh2797 (qué debe contener un APL), NCh2807 (seguimiento, evaluación de la conformidad y certificación) y NCh2825 (requisitos de los auditores). En 2012 el APL chileno fue además el primer instrumento de su tipo registrado como NAMA ante la CMNUCC.', 2),
  ((SELECT id FROM cursos WHERE slug = 'apl-en-simple'), 'El ciclo de una empresa adherida',
   'Primero el sector negocia y firma el acuerdo, y cada empresa adhiere y levanta su diagnóstico inicial. Luego viene la implementación: cumplir metas y acciones dentro del plazo que fija cada acuerdo. Al final, un auditor registrado ante la ASCC evalúa la conformidad; el certificado de cumplimiento exige el 100% de las metas y acciones de la instalación.', 3),
  ((SELECT id FROM cursos WHERE slug = 'apl-en-simple'), 'Qué gana la empresa',
   'La empresa certificada recibe el certificado de cumplimiento y puede optar al Sello APL. Ese sello es visible en su ficha de proveedor del Estado y puede ser considerado como criterio de evaluación adicional en licitaciones — depende de cada base de licitación, no es un puntaje automático. Varias metas de APL (por ejemplo, cuantificación de gases de efecto invernadero) se alinean con programas públicos como HuellaChile.', 4),
  ((SELECT id FROM cursos WHERE slug = 'apl-en-simple'), 'El APL en sicr3p — y los límites',
   'En la plataforma se registra el APL de cada cliente con sus metas y avance, y cada meta se asocia a evidencia que ya existe: CO2e calculado desde documentos reales con factor citado, declaraciones REP, constancias de cursos e informes sellados por hash. Importante: sicr3p NO certifica el cumplimiento del APL — la evaluación de conformidad y el certificado los otorga el sistema APL a través de sus auditores registrados. La plataforma solo deja tu evidencia ordenada y verificable.', 5)
ON CONFLICT (curso_id, orden) DO NOTHING;

INSERT INTO preguntas (curso_id, enunciado, orden) VALUES
  ((SELECT id FROM cursos WHERE slug = 'apl-en-simple'), '¿Qué es un Acuerdo de Producción Limpia?', 1),
  ((SELECT id FROM cursos WHERE slug = 'apl-en-simple'), '¿Quién coordina los APL en Chile?', 2),
  ((SELECT id FROM cursos WHERE slug = 'apl-en-simple'), '¿Qué exige el certificado de cumplimiento de un APL?', 3),
  ((SELECT id FROM cursos WHERE slug = 'apl-en-simple'), '¿El Sello APL da puntaje automático en toda licitación pública?', 4),
  ((SELECT id FROM cursos WHERE slug = 'apl-en-simple'), '¿Quién certifica el cumplimiento del APL de tu empresa?', 5)
ON CONFLICT (curso_id, orden) DO NOTHING;

INSERT INTO opciones (pregunta_id, texto, correcta, orden) VALUES
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'apl-en-simple') AND orden = 1), 'Un convenio voluntario público-privado con metas más allá de lo que exige la ley', true, 1),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'apl-en-simple') AND orden = 1), 'Una multa ambiental convertida en plan de pago', false, 2),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'apl-en-simple') AND orden = 1), 'Un permiso de emisión transable', false, 3),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'apl-en-simple') AND orden = 1), 'Una certificación ISO obligatoria', false, 4),

  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'apl-en-simple') AND orden = 2), 'La Agencia de Sustentabilidad y Cambio Climático (ASCC), comité de CORFO', true, 1),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'apl-en-simple') AND orden = 2), 'El Servicio de Impuestos Internos', false, 2),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'apl-en-simple') AND orden = 2), 'Cada municipalidad', false, 3),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'apl-en-simple') AND orden = 2), 'La Superintendencia de Electricidad y Combustibles', false, 4),

  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'apl-en-simple') AND orden = 3), 'El 100% de las metas y acciones de la instalación, verificado por un auditor registrado', true, 1),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'apl-en-simple') AND orden = 3), 'Al menos la mitad de las metas', false, 2),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'apl-en-simple') AND orden = 3), 'Solo pagar la cuota anual del acuerdo', false, 3),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'apl-en-simple') AND orden = 3), 'Una autoevaluación firmada por el gerente', false, 4),

  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'apl-en-simple') AND orden = 4), 'No: puede considerarse como criterio adicional, según cada base de licitación', true, 1),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'apl-en-simple') AND orden = 4), 'Sí, siempre suma el mismo puntaje', false, 2),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'apl-en-simple') AND orden = 4), 'Sí, y además exime de impuestos', false, 3),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'apl-en-simple') AND orden = 4), 'El sello no tiene ninguna relación con compras públicas', false, 4),

  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'apl-en-simple') AND orden = 5), 'La auditoría del sistema APL (auditores registrados ante la ASCC) — nunca sicr3p', true, 1),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'apl-en-simple') AND orden = 5), 'sicr3p, al marcar todas las metas como cumplidas', false, 2),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'apl-en-simple') AND orden = 5), 'La propia empresa, por declaración jurada', false, 3),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'apl-en-simple') AND orden = 5), 'El banco que financia el proyecto', false, 4)
ON CONFLICT (pregunta_id, orden) DO NOTHING;
