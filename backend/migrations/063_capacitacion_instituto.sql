-- ============================================================
-- 063: Instituto sicr3p — catálogo público de capacitación.
--
-- La migración 037 sembró capacitación 100% interna (personal que ya
-- opera la plataforma). Esta migración distingue qué cursos son
-- publicables hacia terceros (agencia, mandante) del entrenamiento
-- puramente operativo (uso del panel de mostrador), y agrega 2 cursos
-- nuevos pensados para ese público externo. El resto del modelo
-- (lecciones, quiz con ≥70% de aprobación, constancia con serial y hash,
-- verificación pública por serial) es exactamente el mismo — ver
-- services/capacitacion.js y routes/public.js.
-- ============================================================

ALTER TABLE cursos ADD COLUMN IF NOT EXISTS es_publico BOOLEAN NOT NULL DEFAULT false;

-- 'fundamentos-rep' ya servía tanto para operadores como para explicarle
-- la ley al cliente en el mesón: se marca publicable. 'panel-mostrador'
-- (cómo operar el POS) sigue exclusivamente interno.
UPDATE cursos SET es_publico = true WHERE slug = 'fundamentos-rep';

INSERT INTO cursos (slug, titulo, descripcion, orden, es_publico) VALUES
  ('contabilidad-carbono', 'Contabilidad de carbono con sicr3p',
   'Cómo sicr3p mide el CO2e desde documentos tributarios reales, arma el Alcance 3 de tu cadena y sella cada dato en una cadena de integridad verificable.', 3, true),
  ('captura-documental-agencias', 'Captura documental para agencias',
   'Cómo una agencia de aduana captura el expediente de una carga del Corredor Bioceánico, sigue el semáforo de completitud y entrega el expediente sellado.', 4, true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO lecciones (curso_id, titulo, contenido, orden) VALUES
  ((SELECT id FROM cursos WHERE slug = 'contabilidad-carbono'), 'Qué mide sicr3p',
   'sicr3p calcula el CO2e a partir de documentos tributarios reales (facturas, DTE) usando el motor propio: un cálculo determinista con factores de emisión versionados, no una estimación genérica. El motor externo (modo mock por defecto) solo se usa como respaldo cuando el motor propio no puede clasificar un ítem.', 1),
  ((SELECT id FROM cursos WHERE slug = 'contabilidad-carbono'), 'De la factura al informe',
   'El flujo es siempre el mismo: se carga el documento, el sistema lo lee y clasifica sin que nadie digite datos, calcula el CO2e y emite un informe con QR de verificación. Si un documento queda ilegible, se rechaza todo el envío para volver a escanear — nunca se corrige un dato a mano.', 2),
  ((SELECT id FROM cursos WHERE slug = 'contabilidad-carbono'), 'Alcance 3 (Scope 3) para tu cadena',
   'Para un mandante, sicr3p arma el Alcance 3 de sus proveedores según las 15 categorías del GHG Protocol y lo exporta en CSV, listo para un reporte ISSB/NCG 461. El dato sale de las facturas ya procesadas de la red de proveedores, no de encuestas.', 3),
  ((SELECT id FROM cursos WHERE slug = 'contabilidad-carbono'), 'Integridad: la cadena de hash',
   'Cada documento calculado queda sellado y encadenado por hash a los anteriores. Cualquiera puede verificar esa cadena en /cadena sin necesidad de una cuenta ni de confiar ciegamente en la plataforma: si algo se alterara después de sellado, la cadena se rompe de forma visible.', 4),
  ((SELECT id FROM cursos WHERE slug = 'contabilidad-carbono'), 'Qué NO es sicr3p',
   'sicr3p no es un organismo certificador ni un auditor: registra, calcula y sella. No reemplaza una declaración formal ante una autoridad ni acredita cumplimiento normativo por sí sola — es una herramienta de contabilidad y trazabilidad de carbono.', 5)
ON CONFLICT (curso_id, orden) DO NOTHING;

INSERT INTO lecciones (curso_id, titulo, contenido, orden) VALUES
  ((SELECT id FROM cursos WHERE slug = 'captura-documental-agencias'), 'El expediente del lote',
   'Cada lote del Corredor Bioceánico tiene un expediente documental: factura, packing list, MIC/DTA, certificados de origen y sanitarios. La agencia captura cada documento una vez y el sistema lo lee y lo clasifica solo.', 1),
  ((SELECT id FROM cursos WHERE slug = 'captura-documental-agencias'), 'El semáforo documental',
   'El expediente muestra un semáforo: verde (completo según el catálogo del tipo de carga), amarillo (parcial) o rojo (sin documentos aún). Lo ven la agencia, el exportador, el puerto y el mandante, cada uno desde su propio panel.', 2),
  ((SELECT id FROM cursos WHERE slug = 'captura-documental-agencias'), 'Cómo capturar un documento',
   'Desde el panel de agencia, en el expediente asignado: foto con el teléfono o subir un archivo. No se digita ningún dato del documento — el sistema lo extrae solo, igual que en el resto de la plataforma.', 3),
  ((SELECT id FROM cursos WHERE slug = 'captura-documental-agencias'), 'Qué queda al final',
   'Un expediente PDF sellado: la cadena de custodia completa del lote, cada documento y el semáforo, verificable públicamente con el QR del pasaporte del lote — sin necesidad de cuenta.', 4),
  ((SELECT id FROM cursos WHERE slug = 'captura-documental-agencias'), 'Los límites',
   'sicr3p no se integra a sistemas del Servicio Nacional de Aduanas ni de organismos estatales, no reemplaza al agente de aduana ni emite documentos aduaneros, y no certifica ni fiscaliza. Ordena y sella lo que el proceso ya produce; la declaración formal sigue su canal oficial de siempre.', 5)
ON CONFLICT (curso_id, orden) DO NOTHING;

INSERT INTO preguntas (curso_id, enunciado, orden) VALUES
  ((SELECT id FROM cursos WHERE slug = 'contabilidad-carbono'), '¿Desde dónde calcula sicr3p el CO2e principalmente?', 1),
  ((SELECT id FROM cursos WHERE slug = 'contabilidad-carbono'), '¿Qué pasa si un documento del lote no se puede leer automáticamente?', 2),
  ((SELECT id FROM cursos WHERE slug = 'contabilidad-carbono'), '¿De dónde sale el dato del Alcance 3 de un mandante?', 3),
  ((SELECT id FROM cursos WHERE slug = 'contabilidad-carbono'), '¿Dónde se puede verificar la cadena de integridad sin cuenta?', 4),
  ((SELECT id FROM cursos WHERE slug = 'contabilidad-carbono'), '¿Es sicr3p un organismo certificador?', 5)
ON CONFLICT (curso_id, orden) DO NOTHING;

INSERT INTO opciones (pregunta_id, texto, correcta, orden) VALUES
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'contabilidad-carbono') AND orden = 1), 'Documentos tributarios reales (facturas, DTE), con el motor propio', true, 1),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'contabilidad-carbono') AND orden = 1), 'Encuestas anuales al cliente', false, 2),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'contabilidad-carbono') AND orden = 1), 'Un promedio de la industria', false, 3),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'contabilidad-carbono') AND orden = 1), 'Datos declarados por el proveedor sin respaldo', false, 4),

  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'contabilidad-carbono') AND orden = 2), 'Se corrige el dato a mano', false, 1),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'contabilidad-carbono') AND orden = 2), 'Se rechaza todo el envío y se debe re-escanear', true, 2),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'contabilidad-carbono') AND orden = 2), 'Se ignora ese documento y se sigue con el resto', false, 3),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'contabilidad-carbono') AND orden = 2), 'Se aprueba con datos estimados', false, 4),

  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'contabilidad-carbono') AND orden = 3), 'De las facturas ya procesadas de su red de proveedores', true, 1),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'contabilidad-carbono') AND orden = 3), 'De una encuesta que llena el proveedor', false, 2),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'contabilidad-carbono') AND orden = 3), 'De un promedio sectorial genérico', false, 3),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'contabilidad-carbono') AND orden = 3), 'sicr3p no arma Alcance 3', false, 4),

  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'contabilidad-carbono') AND orden = 4), 'En /cadena, público y sin cuenta', true, 1),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'contabilidad-carbono') AND orden = 4), 'Solo el administrador la puede ver', false, 2),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'contabilidad-carbono') AND orden = 4), 'No es posible verificarla', false, 3),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'contabilidad-carbono') AND orden = 4), 'Solo con una API key paga', false, 4),

  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'contabilidad-carbono') AND orden = 5), 'Sí, certifica el cumplimiento normativo', false, 1),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'contabilidad-carbono') AND orden = 5), 'No, registra, calcula y sella — no certifica ni audita', true, 2),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'contabilidad-carbono') AND orden = 5), 'Sí, es una autoridad ambiental', false, 3),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'contabilidad-carbono') AND orden = 5), 'Solo para clientes con contrato Fase C', false, 4)
ON CONFLICT (pregunta_id, orden) DO NOTHING;

INSERT INTO preguntas (curso_id, enunciado, orden) VALUES
  ((SELECT id FROM cursos WHERE slug = 'captura-documental-agencias'), '¿Qué documentos típicamente forman el expediente de un lote?', 1),
  ((SELECT id FROM cursos WHERE slug = 'captura-documental-agencias'), '¿Qué significa el semáforo en rojo?', 2),
  ((SELECT id FROM cursos WHERE slug = 'captura-documental-agencias'), '¿Cómo se captura un documento desde el panel de agencia?', 3),
  ((SELECT id FROM cursos WHERE slug = 'captura-documental-agencias'), '¿Qué entrega sicr3p al final del expediente?', 4),
  ((SELECT id FROM cursos WHERE slug = 'captura-documental-agencias'), '¿sicr3p se integra a los sistemas del Servicio Nacional de Aduanas?', 5)
ON CONFLICT (curso_id, orden) DO NOTHING;

INSERT INTO opciones (pregunta_id, texto, correcta, orden) VALUES
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'captura-documental-agencias') AND orden = 1), 'Factura, packing list, MIC/DTA, certificados de origen y sanitarios', true, 1),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'captura-documental-agencias') AND orden = 1), 'Solo la factura comercial', false, 2),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'captura-documental-agencias') AND orden = 1), 'Solo el MIC/DTA', false, 3),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'captura-documental-agencias') AND orden = 1), 'Ninguno: el sistema no maneja documentos', false, 4),

  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'captura-documental-agencias') AND orden = 2), 'Expediente completo', false, 1),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'captura-documental-agencias') AND orden = 2), 'Sin documentos aún', true, 2),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'captura-documental-agencias') AND orden = 2), 'Documento rechazado por fraude', false, 3),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'captura-documental-agencias') AND orden = 2), 'Lote cancelado', false, 4),

  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'captura-documental-agencias') AND orden = 3), 'Con foto o archivo desde el teléfono, sin digitar datos', true, 1),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'captura-documental-agencias') AND orden = 3), 'Digitando manualmente cada campo del documento', false, 2),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'captura-documental-agencias') AND orden = 3), 'Enviando un correo a soporte', false, 3),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'captura-documental-agencias') AND orden = 3), 'No se puede capturar desde el panel de agencia', false, 4),

  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'captura-documental-agencias') AND orden = 4), 'Un expediente PDF sellado y verificable por QR', true, 1),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'captura-documental-agencias') AND orden = 4), 'Un certificado de aduana oficial', false, 2),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'captura-documental-agencias') AND orden = 4), 'Nada, el proceso termina en el panel', false, 3),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'captura-documental-agencias') AND orden = 4), 'Una clave de acceso nueva para el exportador', false, 4),

  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'captura-documental-agencias') AND orden = 5), 'Sí, reemplaza el trámite oficial', false, 1),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'captura-documental-agencias') AND orden = 5), 'No, no se integra ni reemplaza al agente de aduana', true, 2),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'captura-documental-agencias') AND orden = 5), 'Sí, pero solo para cargas mineras', false, 3),
  ((SELECT id FROM preguntas WHERE curso_id = (SELECT id FROM cursos WHERE slug = 'captura-documental-agencias') AND orden = 5), 'Sí, mediante una API estatal', false, 4)
ON CONFLICT (pregunta_id, orden) DO NOTHING;
