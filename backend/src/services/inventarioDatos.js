// ============================================================
// Registro de actividades de tratamiento — el inventario de qué dato
// personal vive en qué tabla, para qué, con qué base de licitud y por
// cuánto tiempo.
//
// La Ley 21.719 pide poder demostrar el tratamiento, no solo hacerlo bien.
// Este archivo ES esa demostración, y de acá salen además las otras dos
// piezas: la purga sabe qué anonimizar (services/retencion.js) y el
// derecho de acceso sabe dónde buscar (services/arcop.js).
//
// EL RIESGO REAL DE UN REGISTRO ASÍ ES QUE QUEDE VIEJO. Por eso
// `test/inventarioDatos.test.js` lee las migraciones y falla si aparece
// una tabla con columnas de persona que no esté clasificada acá. Agregar
// mañana una tabla con un `contacto_email` y olvidar clasificarla rompe
// la suite: la deriva se vuelve imposible de ignorar.
//
// Clasificar NO significa "tiene datos personales". Significa que alguien
// lo miró y decidió. `motor_categorias.nombre` es el nombre de una
// categoría de gasto, no de una persona: se clasifica como `no_personal`
// y queda constancia de por qué.
// ============================================================

export const PERSONAL = 'personal';
export const NO_PERSONAL = 'no_personal';

// Bases de licitud del art. 12 de la ley. Se nombran acá para que cada
// entrada tenga que elegir una y no inventar la suya.
export const BASE = {
  CONTRATO: 'ejecución del contrato con el cliente',
  CONSENTIMIENTO: 'consentimiento del titular',
  LEY: 'obligación legal (respaldo tributario y contable)',
  LEGITIMO: 'interés legítimo (seguridad y trazabilidad del servicio)',
};

// Cadenas de integridad vigentes. Una fila encadenada NO se borra ni se
// edita: hacerlo invalida todos los eslabones posteriores.
//
// `global` = las tres ramas que recorre verificarCadenaGlobal().
// `propia` = cadena por entidad (una cuenta natural, un contrato).
export const CADENA = { GLOBAL: 'global', PROPIA: 'propia', NINGUNA: null };

/**
 * Una entrada por tabla que el escáner marca, más las que contienen datos
 * personales donde el escáner no puede verlos (dentro de un JSONB).
 *
 * - `columnas`: las que son dato personal. Vacío si `no_personal`.
 * - `retencion`: qué hace la purga. `null` = no se purga, con motivo.
 */
export const INVENTARIO = {
  // ---------- Titulares y sus contactos ----------
  clientes: {
    clasificacion: PERSONAL,
    columnas: ['rut', 'contacto_email'],
    nota: 'La razón social es de la empresa y el correo de contacto es de una persona. El RUT se '
      + 'incluye a propósito aunque casi siempre sea de una empresa: un cliente puede ser persona '
      + 'natural (empresario individual) y, si se excluyera, esa persona no podría encontrar su '
      + 'propia ficha al ejercer su derecho de acceso. Incluirlo de más no filtra nada —el titular '
      + 'ya se identificó con ese RUT—; excluirlo sí deja a alguien sin su derecho.',
    finalidad: 'Identificar a la empresa contratante y tener a quién dirigirse.',
    base: BASE.CONTRATO,
    cadena: CADENA.NINGUNA,
    retencion: 'Mientras dure la relación contractual y su plazo de prescripción.',
  },
  usuarios: {
    clasificacion: PERSONAL,
    columnas: ['email', 'nombre'],
    nota: '`password_hash` es un hash bcrypt: no es recuperable y por eso no es un dato que se pueda entregar ni rectificar.',
    finalidad: 'Dar acceso a la plataforma y saber quién hizo cada cosa.',
    base: BASE.CONTRATO,
    cadena: CADENA.NINGUNA,
    retencion: 'Mientras la cuenta exista.',
  },
  mandantes: {
    clasificacion: PERSONAL,
    columnas: ['rut', 'email'],
    nota: 'La razón social es de la empresa mandante. El RUT se incluye por el mismo criterio '
      + 'que en `clientes`: puede ser el de una persona natural.',
    finalidad: 'Dar acceso a la API y al panel de mandante.',
    base: BASE.CONTRATO,
    cadena: CADENA.NINGUNA,
    retencion: 'Mientras dure el convenio.',
  },
  auspiciadores: {
    clasificacion: PERSONAL,
    columnas: ['rut', 'contacto_email'],
    nota: 'Mismo criterio que `clientes` con el RUT.',
    finalidad: 'Administrar el convenio de auspicio del programa de terreno.',
    base: BASE.CONTRATO,
    cadena: CADENA.NINGUNA,
    retencion: 'Mientras dure el convenio y su plazo de prescripción.',
  },
  prospectos: {
    clasificacion: PERSONAL,
    columnas: ['rut', 'contacto'],
    finalidad: 'Seguimiento comercial.',
    base: BASE.LEGITIMO,
    cadena: CADENA.NINGUNA,
    retencion: 'Se anonimiza el contacto de los prospectos perdidos pasado el plazo.',
  },
  codigos_acceso: {
    clasificacion: PERSONAL,
    columnas: ['email'],
    finalidad: 'Entregar créditos de prueba a una empresa interesada.',
    base: BASE.CONSENTIMIENTO,
    cadena: CADENA.NINGUNA,
    retencion: 'Mientras el código esté activo.',
  },
  campanas_cobro: {
    clasificacion: NO_PERSONAL,
    columnas: [],
    nota: 'Define QUÉ se vende y a cuánto (nombre, precio, créditos). `creado_por` es un FK a la '
      + 'cuenta admin que la creó, no un dato de esa persona: quién la creó ya está en `usuarios`, '
      + 'acá es solo la referencia. Los destinatarios viven en `cobros`.',
    finalidad: 'Definir el producto y el precio de una campaña de venta por correo.',
    cadena: CADENA.NINGUNA,
    retencion: 'Mientras la campaña sea consultable para conciliar sus cobros.',
  },
  cobros: {
    clasificacion: PERSONAL,
    columnas: ['rut', 'contacto', 'email'],
    nota: 'Una fila por empresa a la que se le envió un link de pago. El RUT se incluye por el '
      + 'mismo motivo que en `clientes`: la lista puede traer empresarios individuales, y excluirlo '
      + 'dejaría a esa persona sin poder encontrarse al ejercer su derecho de acceso. `token` no es '
      + 'un dato de la persona sino el identificador del link; `empresa` es razón social. '
      + 'IMPORTANTE: acá NO hay datos de pago — ni tarjeta, ni cuenta bancaria. Lo único que vuelve '
      + 'de la pasarela es su identificador de orden (`pasarela_ref`), que sirve para conciliar y no '
      + 'identifica ningún medio de pago.',
    finalidad: 'Cobrar el acceso a una empresa de la lista y entregarle su código cuando paga.',
    // El contacto entra a la lista porque la empresa es un prospecto
    // comercial, no porque haya consentido: la base honesta es el interés
    // legítimo, y por eso todo correo lleva salida (ver mailer.js).
    base: BASE.LEGITIMO,
    cadena: CADENA.NINGUNA,
    retencion: 'El cobro pagado se conserva como respaldo de la venta; el que nunca se pagó se borra completo pasado el plazo.',
  },
  correos_enviados: {
    clasificacion: PERSONAL,
    columnas: ['destinatario_email'],
    nota: 'Bitácora del HECHO de cada envío — nunca el cuerpo del correo, que incluiría el link de '
      + 'pago y, en el de credenciales, el código mismo. Existe porque hasta ahora un envío no dejaba '
      + 'rastro: ante un "nunca me llegó" no había forma de saber si salió, y en una campaña de cobro '
      + 'eso es la diferencia entre poder reclamar un pago y no poder.',
    finalidad: 'Poder demostrar qué se envió, a quién y cuándo, y diagnosticar entregas fallidas.',
    base: BASE.LEGITIMO,
    cadena: CADENA.NINGUNA,
    retencion: 'Se borra completa pasado el plazo: cumplido su uso de diagnóstico y prueba de envío, no hay finalidad que la sostenga.',
  },
  bajas_correo: {
    clasificacion: PERSONAL,
    columnas: ['email'],
    nota: 'Quién pidió no recibir más correos comerciales. Es el caso raro en que CONSERVAR el '
      + 'dato es lo que protege al titular: si se borrara el correo, la próxima campaña volvería a '
      + 'escribirle. Por eso no se purga — borrarla sería deshacer la oposición que la persona '
      + 'ejerció. Guarda solo la dirección y de dónde salió la baja, nada más.',
    finalidad: 'Respetar la oposición a recibir comunicaciones comerciales (art. 28 B Ley 19.628).',
    // La persona ejerció su oposición: la base es esa misma oposición,
    // y honrarla es una obligación legal, no un interés de la empresa.
    base: BASE.LEY,
    cadena: CADENA.NINGUNA,
    retencion: null,
    motivoSinPurga: 'Borrar una baja la anularía: el correo volvería a entrar en la próxima campaña. '
      + 'Se conserva mientras exista el sistema de envíos.',
  },
  jugadores: {
    clasificacion: PERSONAL,
    columnas: ['email', 'nombre'],
    nota: '"Sube y Suma": un empleado/proveedor de una empresa cliente que se unió con un '
      + 'código de invitación (`codigo_id`, mismo `codigos_acceso` de arriba con `modo_juego=true`). '
      + 'Se identifica por magic link (igual que un cliente sin cuenta), pero con fila persistente '
      + 'porque necesita acumular puntos entre sesiones — el JWT de cliente normal es efímero y no sirve.',
    finalidad: 'Llevar el puntaje/nivel de la campaña gamificada de escaneo de documentos.',
    base: BASE.CONSENTIMIENTO,
    cadena: CADENA.NINGUNA,
    retencion: 'Mientras el código de campaña esté activo.',
  },
  solicitudes_auspicio: {
    clasificacion: PERSONAL,
    columnas: ['rut', 'contacto_nombre', 'contacto_email', 'contacto_telefono', 'ip'],
    finalidad: 'Recibir y resolver una postulación al programa de auspicio.',
    base: BASE.CONSENTIMIENTO,
    cadena: CADENA.NINGUNA,
    retencion: 'Se anonimiza el contacto de las rechazadas pasado el plazo; se conserva el hecho y su resolución.',
  },
  solicitudes_inscripcion: {
    clasificacion: PERSONAL,
    columnas: ['rut', 'nombre_empresa', 'contacto_nombre', 'contacto_cargo', 'contacto_email', 'contacto_telefono', 'ip'],
    finalidad: 'Recibir y resolver la inscripción de una empresa interesada (formulario público /inscripcion).',
    base: BASE.CONSENTIMIENTO,
    cadena: CADENA.NINGUNA,
    retencion: 'Se anonimiza el contacto de las descartadas pasado el plazo; se conserva el hecho y su resolución.',
  },
  interesados: {
    clasificacion: PERSONAL,
    columnas: ['nombre', 'email', 'telefono', 'ip'],
    nota: 'Leads livianos del sitio público (calculadora de la portada, landings del Corredor '
      + 'e Instituto, página de códigos de prueba) — sin RUT: es un primer contacto, no una '
      + 'postulación. Si NOTION_TOKEN está configurado, una copia se replica a un workspace '
      + 'de Notion (encargado de tratamiento externo, fuera de Chile).',
    finalidad: 'Contactar a quien dejó su correo pidiendo información o su estimación de CO2e.',
    base: BASE.CONSENTIMIENTO,
    cadena: CADENA.NINGUNA,
    retencion: 'Los descartados se borran completos pasado el plazo; los contactados siguen el ciclo comercial.',
  },

  sii_consultas: {
    clasificacion: PERSONAL,
    columnas: ['rut_norm'],
    nota: 'Caché de la situación tributaria PÚBLICA del SII por RUT (vía BaseAPI), para el '
      + 'autocompletado de formularios. El RUT se incluye por el mismo criterio que en `clientes`: '
      + 'puede ser el de una persona natural. El JSONB `respuesta` solo guarda lo que el SII publica '
      + 'de cualquier contribuyente (razón social, actividades); jamás claves ni datos privados.',
    columnasRut: ['rut_norm'],
    finalidad: 'No pagar dos veces la misma consulta a BaseAPI y autocompletar formularios.',
    base: BASE.LEGITIMO,
    cadena: CADENA.NINGUNA,
    retencion: 'Es una caché: se puede vaciar entera en cualquier momento sin perder nada — la consulta se rehace.',
  },

  // ---------- Operación: lo que se calcula ----------
  sesiones: {
    clasificacion: PERSONAL,
    columnas: ['rut_cliente', 'nombre_cliente', 'email_cliente'],
    nota: 'CUIDADO: `facturas` y `declaraciones_embalaje` cuelgan de acá con ON DELETE CASCADE, '
      + 'y ambas están en la cadena global. Borrar una sesión rompe la cadena en silencio. '
      + 'La supresión nunca pasa por acá.',
    finalidad: 'Agrupar los documentos de un trámite y emitir su informe.',
    base: BASE.CONTRATO,
    cadena: CADENA.NINGUNA,
    retencion: null,
    motivoSinPurga: 'De ella cuelgan registros encadenados; borrarla los arrastraría.',
  },
  facturas: {
    clasificacion: PERSONAL,
    columnas: ['rut_emisor', 'rut_receptor'],
    nota: 'Casi siempre son empresas, pero un empresario individual o una boleta de honorarios es una persona natural.',
    finalidad: 'Calcular las emisiones a partir del documento tributario.',
    base: BASE.LEY,
    cadena: CADENA.GLOBAL,
    retencion: null,
    motivoSinPurga: 'Encadenada y con respaldo tributario obligatorio.',
  },
  declaraciones_embalaje: {
    clasificacion: NO_PERSONAL,
    columnas: [],
    nota: 'Solo materiales y pesos de embalaje. La persona está en su sesión, no acá.',
    finalidad: 'Declaración REP de la Ley 20.920.',
    base: BASE.LEY,
    cadena: CADENA.GLOBAL,
    retencion: null,
    motivoSinPurga: 'Encadenada.',
  },
  productos_proveedor: {
    clasificacion: NO_PERSONAL,
    columnas: [],
    nota: 'El escáner marca `nombre`, pero es el nombre del PRODUCTO ("Botella 1L"), no de una '
      + 'persona. La empresa dueña del catálogo está en `proveedores`, no acá. `foto_embalaje` '
      + '(migración 095, evidencia opcional del envase) es una foto de un producto/embalaje, no '
      + 'un retrato — mismo criterio que `ventas_rep.archivo`: puede contener a alguien de fondo '
      + 'sin ser su finalidad ni la de la captura.',
    finalidad: 'Catálogo de productos con la composición de su envase para la declaración REP.',
    base: BASE.LEY,
    cadena: CADENA.NINGUNA,
    retencion: null,
    motivoSinPurga: 'Las ventas REP lo referencian por snapshot; se desactiva, no se borra.',
  },
  ventas_rep: {
    clasificacion: NO_PERSONAL,
    columnas: [],
    nota: 'El escáner marca `archivo_nombre`, pero es el nombre del ARCHIVO subido. El archivo '
      + 'mismo (la factura como evidencia) puede contener RUT de empresas — mismo criterio que '
      + '`facturas`: documento tributario guardado por mandato del titular que lo subió.',
    finalidad: 'Evidencia de venta y kilos de envases puestos en el mercado (declaración REP, Ley 20.920).',
    base: BASE.LEY,
    cadena: CADENA.NINGUNA,
    retencion: null,
    motivoSinPurga: 'Es el respaldo de lo que la empresa declara en RETC/SGR.',
  },
  contratos: {
    clasificacion: PERSONAL,
    columnas: ['datos'],
    nota: 'El escáner no lo ve: el RUT y la razón social están congelados dentro del JSONB `datos`. '
      + 'Ese congelamiento es el punto del contrato — se emitió con esos datos y no se re-lee.',
    finalidad: 'Dejar constancia de las condiciones pactadas al momento de emitir.',
    base: BASE.CONTRATO,
    cadena: CADENA.PROPIA,
    retencion: null,
    motivoSinPurga: 'Sellado por hash; es la prueba de lo que se firmó.',
  },
  inventario_movimientos: {
    clasificacion: PERSONAL,
    columnas: ['rut_cliente_norm'],
    finalidad: 'Valorización de existencias asociada al cliente.',
    base: BASE.CONTRATO,
    cadena: CADENA.NINGUNA,
    retencion: null,
    motivoSinPurga: 'Deriva de documentos tributarios; sigue su misma obligación de conservación.',
  },
  transporte_viajes: {
    clasificacion: PERSONAL,
    columnas: ['rut_cliente'],
    finalidad: 'Calcular las emisiones de transporte de personal (Categoría 7).',
    base: BASE.CONTRATO,
    cadena: CADENA.NINGUNA,
    retencion: null,
    motivoSinPurga: 'Entra al informe de emisiones del cliente.',
  },
  mandante_proveedores: {
    clasificacion: PERSONAL,
    columnas: ['rut_proveedor'],
    nota: 'Lista blanca: qué proveedores puede consultar cada mandante. Acota el acceso, no lo amplía.',
    finalidad: 'Limitar qué puede ver un mandante a los proveedores que declaró.',
    base: BASE.CONTRATO,
    cadena: CADENA.NINGUNA,
    retencion: 'Mientras dure el convenio del mandante.',
  },
  documentos_rechazados: {
    clasificacion: PERSONAL,
    columnas: ['nombre_archivo', 'rut_cliente'],
    nota: 'Por diseño NUNCA guarda el binario del documento: solo su sha256 y por qué se rechazó.',
    finalidad: 'Medir la tasa de rechazo de lectura para poder mejorarla.',
    base: BASE.LEGITIMO,
    cadena: CADENA.NINGUNA,
    retencion: 'Se borra pasado el plazo.',
  },

  // ---------- Credenciales en tránsito ----------
  tokens_magic: {
    clasificacion: PERSONAL,
    columnas: ['email'],
    nota: 'El token va hasheado; el correo no, porque es la clave de búsqueda.',
    finalidad: 'Enlace de acceso de un solo uso.',
    base: BASE.CONTRATO,
    cadena: CADENA.NINGUNA,
    retencion: 'Se borran los usados o vencidos pasado el plazo.',
  },
  tokens_password: {
    clasificacion: NO_PERSONAL,
    columnas: [],
    nota: 'Solo `usuario_id` y el hash del token. La persona está en `usuarios`.',
    finalidad: 'Restablecer la contraseña.',
    base: BASE.CONTRATO,
    cadena: CADENA.NINGUNA,
    retencion: 'Se borran los usados o vencidos pasado el plazo.',
  },

  solicitudes_arcop: {
    clasificacion: PERSONAL,
    columnas: ['rut', 'email', 'nombre', 'ip'],
    nota: 'Paradoja aparente: el registro de quien ejerció su derecho es, él mismo, dato personal. '
      + 'Se conserva porque es la prueba de que el derecho se atendió —borrarlo eliminaría la '
      + 'evidencia del cumplimiento—, pero se le quita la IP pasado el plazo, igual que al log.',
    finalidad: 'Recibir, resolver y poder demostrar la atención de un derecho del titular.',
    base: BASE.LEY,
    cadena: CADENA.NINGUNA,
    retencion: 'Se anonimiza la IP de las resueltas pasado el plazo; la solicitud y su respuesta quedan.',
  },

  // ---------- Auditoría ----------
  actividad_log: {
    clasificacion: PERSONAL,
    columnas: ['ip'],
    nota: 'La IP es el dato personal. El resto de la fila —quién, qué, cuándo— es la prueba de '
      + 'accountability que la ley pide: se anonimiza la IP y se conserva el registro. '
      + 'Borrar la fila entera debilitaría el cumplimiento en vez de mejorarlo.',
    finalidad: 'Poder demostrar quién accedió a qué, incluidos los cruces por RUT.',
    base: BASE.LEGITIMO,
    cadena: CADENA.NINGUNA,
    retencion: 'Se anonimiza la IP pasado el plazo; el resto del registro queda.',
  },

  brechas_seguridad: {
    clasificacion: NO_PERSONAL,
    columnas: [],
    nota: 'Describe QUÉ datos se vieron comprometidos, sin copiarlos: se anota la categoría y el '
      + 'número de afectados, nunca sus nombres. El escáner no la marca —ninguna columna se llama '
      + 'como un dato de persona—, y se clasifica igual para que conste la decisión.',
    finalidad: 'Registrar vulneraciones y la cronología de su notificación.',
    base: BASE.LEY,
    cadena: CADENA.NINGUNA,
    retencion: null,
    motivoSinPurga: 'Es la prueba de cómo se manejó un incidente; se conserva.',
  },

  // ---------- Clasificadas como NO personales ----------
  // El escáner las marca por el nombre de una columna; se revisaron y no
  // son datos de persona. Quedan acá para que la decisión conste.
  activos_naturales: {
    clasificacion: NO_PERSONAL, columnas: [],
    nota: '`nombre` es el de un activo natural (un humedal, un bosque).',
    finalidad: 'Capital Natural.', base: null, cadena: CADENA.NINGUNA, retencion: null,
    motivoSinPurga: 'No contiene datos personales.',
  },
  apl_acuerdos: {
    clasificacion: NO_PERSONAL, columnas: [],
    nota: '`nombre` es el del Acuerdo de Producción Limpia sectorial (un convenio, no una persona); el cliente se referencia por FK.',
    finalidad: 'Seguimiento del APL suscrito por cada cliente.', base: null, cadena: CADENA.NINGUNA, retencion: null,
    motivoSinPurga: 'No contiene datos personales.',
  },
  apl_metas: {
    clasificacion: NO_PERSONAL, columnas: [],
    nota: 'Metas y acciones de un APL: descripciones de compromisos sectoriales, sin datos de personas.',
    finalidad: 'Seguimiento del avance de metas del APL.', base: null, cadena: CADENA.NINGUNA, retencion: null,
    motivoSinPurga: 'No contiene datos personales.',
  },
  cuentas_naturales: {
    clasificacion: NO_PERSONAL, columnas: [],
    nota: '`nombre` es el de una cuenta contable (Agua, Energía).',
    finalidad: 'Capital Natural.', base: null, cadena: CADENA.PROPIA, retencion: null,
    motivoSinPurga: 'No contiene datos personales, y además está encadenada.',
  },
  motor_categorias: {
    clasificacion: NO_PERSONAL, columnas: [],
    nota: '`nombre` es el de una categoría de gasto (Combustible, Electricidad).',
    finalidad: 'Factores de emisión del motor.', base: null, cadena: CADENA.NINGUNA, retencion: null,
    motivoSinPurga: 'No contiene datos personales.',
  },
  misiones: {
    clasificacion: NO_PERSONAL, columnas: [],
    nota: '"Sube y Suma": `nombre` es el de una misión de la campaña ("Primeros pasos"), no de una persona.',
    finalidad: 'Catálogo de misiones de la campaña gamificada.', base: null, cadena: CADENA.NINGUNA, retencion: null,
    motivoSinPurga: 'No contiene datos personales.',
  },
  recompensas: {
    clasificacion: NO_PERSONAL, columnas: [],
    nota: '"Sube y Suma": `nombre` es el de una recompensa simbólica ("Insignia Nivel 2"), no de una persona. '
      + 'Nunca incluye dinero ni descuento real — no hay pasarela de pago conectada.',
    finalidad: 'Catálogo de recompensas de la campaña gamificada.', base: null, cadena: CADENA.NINGUNA, retencion: null,
    motivoSinPurga: 'No contiene datos personales.',
  },
  puntos_limpios: {
    clasificacion: NO_PERSONAL, columnas: [],
    nota: '"Sube y Suma": `nombre`, `direccion` y `lat`/`lng` describen un lugar de entrega de '
      + 'envases de la empresa (ej. "Punto limpio casino central"), no a una persona.',
    finalidad: 'Catálogo de puntos limpios de la campaña de reciclaje, con su cartel QR.',
    base: null, cadena: CADENA.NINGUNA, retencion: null,
    motivoSinPurga: 'No contiene datos personales.',
  },
  puntos_corredor: {
    clasificacion: NO_PERSONAL, columnas: [],
    nota: 'Corredor Bioceánico: `nombre` y `lat`/`lng` describen un punto de control geográfico fijo '
      + 'del corredor (báscula, frontera, puerto), no a una persona ni su ubicación.',
    finalidad: 'Catálogo de puntos de control del corredor, editable desde el panel admin sin deploy.',
    base: null, cadena: CADENA.NINGUNA, retencion: null,
    motivoSinPurga: 'Los eslabones históricos referencian el id (slug) del punto; se desactiva, no se borra.',
  },
  reciclajes: {
    clasificacion: PERSONAL,
    columnas: ['lat', 'lng'],
    nota: '"Sube y Suma": `lat`/`lng` es la ubicación puntual del jugador al registrar su entrega '
      + 'de envases — una lectura por registro, tomada con su permiso de ubicación, nunca rastreo '
      + 'continuo. La foto de los envases NO se guarda: solo el conteo validado.',
    finalidad: 'Confirmar que la entrega ocurrió en el punto limpio (cercanía) y llevar el puntaje.',
    base: BASE.CONSENTIMIENTO,
    cadena: CADENA.NINGUNA,
    retencion: 'Mientras el código de campaña esté activo.',
  },
  trayectos: {
    clasificacion: PERSONAL,
    columnas: ['salida_lat', 'salida_lng', 'llegada_lat', 'llegada_lng'],
    nota: '"Sube y Suma": coordenadas de salida y llegada del trayecto del jugador — dos lecturas '
      + 'puntuales con su permiso de ubicación, nunca rastreo continuo. Solo se usa para calcular '
      + 'la distancia del traslado; los puntos no dependen de la coordenada.',
    finalidad: 'Calcular la distancia del traslado del jugador a la campaña.',
    base: BASE.CONSENTIMIENTO,
    cadena: CADENA.NINGUNA,
    retencion: 'Mientras el código de campaña esté activo.',
  },
  propuestas_factores: {
    clasificacion: NO_PERSONAL, columnas: [],
    nota: 'Factores propuestos por la IA y su fuente. `resuelta_por` es una FK '
      + 'a `usuarios`, mismo criterio que `motor_versiones`.',
    finalidad: 'Dejar por escrito qué cambio de factor se propuso, con qué fuente, '
      + 'y quién lo aprobó o lo rechazó.',
    base: null, cadena: CADENA.NINGUNA, retencion: null,
    motivoSinPurga: 'Una propuesta descartada se conserva a propósito: saber qué se '
      + 'rechazó y por qué es parte del respaldo metodológico, igual que saber qué '
      + 'se aprobó.',
  },
  actualizaciones_factores: {
    clasificacion: NO_PERSONAL, columnas: [],
    nota: 'Bitácora técnica de cada corrida del buscador (tokens, latencia, error). '
      + '`disparada_por` es una FK a `usuarios`.',
    finalidad: 'Transparencia del uso de la IA y diagnóstico de fallas.',
    base: null, cadena: CADENA.NINGUNA, retencion: null,
    motivoSinPurga: 'No contiene datos personales y su volumen es mínimo — el botón '
      + 'es manual, no automático.',
  },
  motor_categorias_version: {
    clasificacion: NO_PERSONAL, columnas: [],
    nota: 'Copia congelada de `motor_categorias` por versión; mismo criterio: '
      + '`nombre` es el de una categoría de gasto, y `fuente_organismo` el de '
      + 'un organismo (IPCC, DEFRA), no el de una persona.',
    finalidad: 'Metodología con la que se calculó cada informe.',
    base: null, cadena: CADENA.NINGUNA, retencion: null,
    motivoSinPurga: 'No contiene datos personales. Además es el respaldo de qué '
      + 'factores produjeron cada número ya emitido: borrarla dejaría informes '
      + 'sin metodología verificable.',
  },
  motor_versiones: {
    clasificacion: NO_PERSONAL, columnas: [],
    nota: 'Solo `creada_por` (FK) y la nota del cambio. La persona está en '
      + '`usuarios` — mismo criterio que `tokens_password` y que `usuario_id` '
      + 'en `actividad_log`, donde el dato personal declarado es la IP y no la FK.',
    finalidad: 'Trazabilidad de qué factores estuvieron vigentes y cuándo.',
    base: null, cadena: CADENA.NINGUNA, retencion: null,
    motivoSinPurga: 'Es la prueba de bajo qué metodología se emitió cada informe. '
      + 'Borrarla dejaría informes ya entregados sin metodología verificable. '
      + 'La FK es ON DELETE SET NULL: si alguien deja el equipo, se corta el '
      + 'vínculo con la persona y la versión sobrevive.',
  },
  transporte_modos: {
    clasificacion: NO_PERSONAL, columnas: [],
    nota: '`nombre` es el de un modo de transporte (Bus, Camioneta).',
    finalidad: 'Factores de la Categoría 7.', base: null, cadena: CADENA.NINGUNA, retencion: null,
    motivoSinPurga: 'No contiene datos personales.',
  },
  pos_terminales: {
    clasificacion: NO_PERSONAL, columnas: [],
    nota: '`nombre` identifica un dispositivo, no a quien lo opera.',
    finalidad: 'Credencial de dispositivo.', base: null, cadena: CADENA.NINGUNA, retencion: null,
    motivoSinPurga: 'No contiene datos personales.',
  },

  // ---------- Corredor Bioceánico y Pasaporte de Origen ----------
  // Estas tablas solo existen en este repositorio (el nuevo dejó fuera el
  // Corredor a propósito). Están acá porque el registro de tratamientos
  // tiene que reflejar la base REAL de producción, no un subconjunto.

  metodologias_pais: {
    clasificacion: NO_PERSONAL, columnas: [],
    nota: '`nombre` es el de la metodología de un país ("Chile — HuellaChile"), no el de una persona.',
    finalidad: 'Factores de emisión por país para el cálculo del Corredor.',
    base: null, cadena: CADENA.NINGUNA, retencion: null,
    motivoSinPurga: 'No contiene datos personales.',
  },
  documentos_corredor: {
    clasificacion: PERSONAL, columnas: ['rut_emisor', 'rut_receptor'],
    nota: 'Mismo criterio que `facturas`: la contraparte casi siempre es una empresa, '
      + 'pero un empresario individual o una boleta de honorarios es una persona natural.',
    finalidad: 'Contabilidad de carbono de un tránsito del Corredor.',
    base: BASE.CONTRATO, cadena: CADENA.NINGUNA,
    retencion: 'Sigue el plazo de respaldo tributario, igual que las facturas.',
  },
  lotes_minerales: {
    clasificacion: PERSONAL, columnas: ['rut_titular'],
    nota: 'El titular de un lote suele ser una empresa, pero puede ser una persona natural '
      + '(pequeña minería). Se trata como personal en esa parte.',
    finalidad: 'Pasaporte de Origen del lote: trazabilidad hasta la faena.',
    base: BASE.CONTRATO, cadena: CADENA.NINGUNA, retencion: null,
    motivoSinPurga: 'De él cuelgan los eslabones encadenados y las tarjetas de viaje; '
      + 'borrarlo dejaría huérfana una cadena que sí está sellada.',
  },
  lote_eslabones: {
    clasificacion: PERSONAL, columnas: ['rut_empresa', 'nombre_empresa'],
    nota: 'Cada eslabón identifica al actor que recibió o entregó el lote. Extranjeros van '
      + 'en `datos.tax_id_extranjero`, que por eso NO se busca por RUT.',
    finalidad: 'Cadena de custodia del lote (balance de masas por actor).',
    base: BASE.CONTRATO, cadena: CADENA.PROPIA, retencion: null,
    motivoSinPurga: 'Encadenada por hash: alterar o borrar un eslabón invalida la verificación '
      + 'de todos los posteriores y del anclaje del lote cerrado.',
  },
  tarjetas_viaje: {
    clasificacion: PERSONAL,
    columnas: ['portador', 'conductor_nombre', 'conductor_documento'],
    // `conductor_documento` guarda el RUT del conductor pero no lo dice en su
    // nombre: sin declararlo, quien conduce jamás encontraría su propio
    // registro al ejercer el derecho de acceso.
    columnasRut: ['conductor_documento'],
    nota: 'Es la tabla con el dato personal más nítido de todo el sistema: una persona '
      + 'identificada por nombre y documento, no una empresa. La clave de la tarjeta va '
      + 'hasheada con bcrypt, como todas.',
    finalidad: 'Acreditar quién transporta un lote y registrar el paso por cada punto.',
    base: BASE.LEGITIMO, cadena: CADENA.PROPIA, retencion: null,
    motivoSinPurga: 'Encadenada por hash. El derecho de supresión sobre el conductor se '
      + 'RESPONDE, no se ejecuta: el registro acredita quién movió una carga y borrarlo '
      + 'rompería la cadena del lote. Si se decide anonimizar, tiene que ser antes de '
      + 'sellar el eslabón, no después.',
  },
  credenciales_proveedor: {
    clasificacion: PERSONAL, columnas: ['rut_empresa', 'nombre_empresa'],
    nota: 'La identidad la fija el emisor, no quien firma. Puede ser un proveedor persona natural. '
      + 'La clave va hasheada y es de un solo uso.',
    finalidad: 'Que un proveedor atestigüe su eslabón sin tener cuenta en la plataforma.',
    base: BASE.CONTRATO, cadena: CADENA.NINGUNA,
    retencion: 'Se puede borrar la credencial agotada; el eslabón que firmó queda, porque está encadenado.',
  },
  puertos: {
    clasificacion: NO_PERSONAL, columnas: [],
    nota: '`nombre` es el de una instalación portuaria ("Puerto de Antofagasta"). El token de '
      + 'acceso va hasheado, igual que el de los mandantes.',
    finalidad: 'Acceso de solo lectura de un puerto a los tránsitos de su punto.',
    base: null, cadena: CADENA.NINGUNA, retencion: null,
    motivoSinPurga: 'No contiene datos personales.',
  },
  agencias_aduana: {
    clasificacion: PERSONAL, columnas: ['rut', 'nombre'],
    nota: 'Una agencia de aduanas es normalmente una empresa, pero el agente de aduanas puede '
      + 'ejercer como persona natural. Mismo criterio que las contrapartes de una factura.',
    finalidad: 'Acceso de la agencia al expediente de los lotes que tramita.',
    base: BASE.CONTRATO, cadena: CADENA.NINGUNA,
    retencion: 'Se puede dar de baja cuando termina el convenio; los expedientes quedan.',
  },
  trazadores: {
    clasificacion: PERSONAL, columnas: ['nombre'],
    nota: 'Un trazador es un tercero externo (auditora, cliente final, organismo): puede ser una '
      + 'empresa o una persona natural que audita por cuenta propia. Mismo criterio que agencias_aduana.',
    finalidad: 'Acceso web de un tercero externo para consultar la trazabilidad de RUT autorizados.',
    base: BASE.CONTRATO, cadena: CADENA.NINGUNA,
    retencion: 'Se puede dar de baja cuando termina el convenio del trazador.',
  },
  trazador_ruts: {
    clasificacion: PERSONAL, columnas: ['rut'],
    nota: 'Lista blanca: qué RUT de terceros puede consultar cada trazador. Mismo criterio que '
      + 'mandante_proveedores — acota el acceso, nunca lo amplía; una whitelist vacía no ve nada.',
    finalidad: 'Limitar qué RUT puede ver un trazador a los que un admin autorizó explícitamente.',
    base: BASE.CONTRATO, cadena: CADENA.NINGUNA,
    retencion: 'Mientras dure el convenio del trazador.',
  },
  proveedores: {
    clasificacion: PERSONAL, columnas: ['nombre_empresa', 'rut'],
    nota: 'Un proveedor suele ser una empresa, pero puede ser una persona natural (un pequeño '
      + 'proveedor sin razón social) — mismo criterio que agencias_aduana/trazadores. Entidad '
      + 'persistente para el login FIDO2 del panel /panel-proveedor (migración 062): NO reemplaza '
      + 'a `credenciales_proveedor` (de un solo uso, migración 038), que sigue viva sin cambios.',
    finalidad: 'Acceso web del proveedor para firmar los lotes tipo `producto` que un admin le asignó.',
    base: BASE.CONTRATO, cadena: CADENA.NINGUNA,
    retencion: 'Se puede dar de baja cuando termina la relación con el proveedor.',
  },
  dte_proveedor: {
    clasificacion: PERSONAL, columnas: ['rut_contraparte'],
    nota: 'Detalle del Registro de Compras y Ventas (RCV) que el proveedor descarga del SII con su '
      + 'clave tributaria (migración 071). La clave NUNCA se guarda acá ni en ninguna parte: viaja por '
      + 'request a BaseAPI y se descarta (ver services/baseapiSii.js). El dato personal identificador es '
      + 'el RUT de las contrapartes (proveedores y clientes del proveedor), que pueden ser personas '
      + 'naturales — mismo criterio que `clientes`, donde la razón social se toma como dato de la empresa. '
      + '`razon_social` viaja junto al RUT solo como etiqueta legible. Se guarda para el análisis de '
      + 'compras/ventas del propio proveedor.',
    finalidad: 'Analizar las compras y ventas del proveedor (resumen, cruce de contrapartes y estimación referencial de emisiones).',
    base: BASE.CONSENTIMIENTO, cadena: CADENA.NINGUNA,
    retencion: 'El proveedor puede re-descargar un período en cualquier momento (UPSERT); se borra al dar de baja la cuenta (ON DELETE CASCADE).',
  },
  credenciales_sii_proveedor: {
    clasificacion: PERSONAL, columnas: ['rut_sii'],
    nota: 'La clave tributaria del SII que el proveedor autoriza guardar (migración 072). Se guarda '
      + 'CIFRADA con AES-256-GCM (services/cripto.js); la llave vive solo en env (SII_CRED_KEY), nunca '
      + 'en la BD, así que un vaciado de la base no la expone en claro. `rut_sii` es el RUT con que se '
      + 'autentica en el SII. El proveedor puede borrarla desde su panel cuando quiera.',
    finalidad: 'Permitir que el proveedor descargue su RCV del SII sin reescribir su clave cada vez.',
    base: BASE.CONSENTIMIENTO, cadena: CADENA.NINGUNA,
    retencion: 'El proveedor la borra desde su panel; se elimina sola al dar de baja la cuenta (ON DELETE CASCADE).',
  },
  credenciales_webauthn: {
    clasificacion: PERSONAL, columnas: ['nombre_dispositivo'],
    nota: '`public_key`/`credential_id`/`counter` son material criptográfico de la llave FIDO2, no '
      + 'un dato de la persona (el dato biométrico jamás llega a este servidor — se valida dentro '
      + 'del hardware). `nombre_dispositivo` sí es personal: lo escribe un admin y en la práctica suele '
      + 'llevar el nombre de su dueño (ej. "YubiKey de Juan Pérez").',
    finalidad: 'Permitir el login sin contraseña de esa cuenta con su llave USB física.',
    base: BASE.LEGITIMO, cadena: CADENA.NINGUNA,
    retencion: 'Un admin la elimina cuando la llave se pierde o el usuario deja de usarla; se borra sola si se borra la cuenta (ON DELETE CASCADE).',
  },
  credenciales_archivo: {
    clasificacion: PERSONAL, columnas: ['nombre'],
    nota: '`token_hash`/`pin_hash` son material de autenticación hasheado (sha256/bcrypt), no un dato '
      + 'de la persona. `nombre` sí es personal: es una etiqueta libre que en la práctica suele llevar '
      + 'el nombre de su dueño — mismo criterio que `nombre_dispositivo` en `credenciales_webauthn`.',
    finalidad: 'Permitir el login de esa cuenta con un archivo credencial guardado en un pendrive, más un PIN verificado en el servidor.',
    base: BASE.LEGITIMO, cadena: CADENA.NINGUNA,
    retencion: 'Un admin la revoca cuando el pendrive se pierde; se borra sola si se borra la cuenta (ON DELETE CASCADE).',
  },
};

// Las tablas donde hay que buscar cuando alguien ejerce su derecho de
// acceso o portabilidad: las personales que además se pueden consultar
// por RUT o por correo.
//
// Deducir el tipo de identificador del NOMBRE de la columna alcanza para
// `rut_emisor` o `contacto_email`, pero deja fuera columnas que guardan un
// RUT sin decirlo: `tarjetas_viaje.conductor_documento` es el RUT del
// conductor y jamás habría sido encontrado. Por eso una entrada puede
// declarar explícitamente qué columnas suyas son de cada tipo, y esa
// declaración se suma a la deducción por nombre.
export const tablasConDatosDe = (identificador) => {
  const porCorreo = String(identificador || '').includes('@');
  const campo = porCorreo ? /email|correo/i : /rut/i;
  const declaradas = (e) => (porCorreo ? e.columnasEmail : e.columnasRut) || [];
  const buscables = (e) => [...new Set([...e.columnas.filter((c) => campo.test(c)), ...declaradas(e)])];
  return Object.entries(INVENTARIO)
    .filter(([, e]) => e.clasificacion === PERSONAL && buscables(e).length > 0)
    .map(([tabla, e]) => ({ tabla, columnas: buscables(e) }));
};

// Lo que NO se puede borrar aunque el titular lo pida, con su fundamento.
// Alimenta la pantalla de resolución de una supresión: la respuesta al
// titular sale de acá, no de la memoria de quien atienda.
export const retenidoPorLey = () =>
  Object.entries(INVENTARIO)
    .filter(([, e]) => e.clasificacion === PERSONAL && e.retencion === null)
    .map(([tabla, e]) => ({
      tabla,
      cadena: e.cadena,
      motivo: e.motivoSinPurga || 'Conservación obligatoria.',
    }));
