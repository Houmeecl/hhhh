import crypto from 'crypto';
import { formatearRut } from './mandante.js';

// ============================================================
// Contrato de servicio por cliente — helpers PUROS (sin BD, sin red).
//
// FUENTE DEL TEXTO: el Paquete Contractual SICR3P (docs/legal/contratos/,
// código SICR3P-LEGAL-00, Borrador 1.0). Las cláusulas de aquí abajo son
// una transcripción operativa de esos documentos, no una redacción propia:
//
//   tipo 'mandante' → SICR3P-LEGAL-02, Contrato de Prestación de Servicios,
//                     Programa Scope 3 para Mandantes (minera, puerto,
//                     energía, industrial, gremio o empresa ancla).
//   tipo 'asesoria' → SICR3P-LEGAL-05, Contrato de Asesoría Scope 3 y
//                     Carpeta Verde Financiable (proveedor que paga
//                     directamente el servicio).
//   tipo 'auspicio' → SICR3P-LEGAL-01, Convenio Marco de Auspicio,
//                     Movilidad y Colaboración Ruta SICR3P.
//   tipo 'comodato' → SICR3P-LEGAL-06, Comodato de Vehículo (solo cuando
//                     el auspicio incluye un vehículo).
//
// Los dos primeros se firman con un CLIENTE; los dos últimos con un
// AUSPICIADOR, que es otra contraparte y tiene su propia tabla.
//
// Si el .docx cambia, se actualiza este archivo Y se sube
// PLANTILLA_VERSION. Los contratos ya emitidos guardan su versión y
// siguen regenerándose con el texto que se les mostró — que es el punto
// de versionar.
//
// EL PAQUETE SIGUE SIENDO BORRADOR. Sus propios documentos lo dicen en la
// cabecera: "no publicar ni firmar sin completar campos [●] y revisión
// profesional". Lo que falta está en PUNTOS_PENDIENTES y se imprime
// visible. Está prohibido rellenar un [●] con un valor inventado.
//
// No se une a la cadena de hash global (services/cadenaGlobal.js): esa
// cadena es de documentos de contabilidad de carbono y trazabilidad, no
// de documentos comerciales. Misma decisión que las constancias de
// capacitación. `hashContrato` es un sello propio y desacoplado.
// ============================================================

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Se sube cuando cambia el TEXTO de cualquier plantilla.
export const PLANTILLA_VERSION = '2026-07-paquete-1.0';

// Los contratos del paquete que la plataforma emite. `sujeto` dice contra
// qué entidad se firma, y por lo tanto de dónde sale el snapshot.
export const TIPOS = {
  mandante: { codigo: 'SICR3P-LEGAL-02', sujeto: 'cliente', titulo: 'Contrato de Prestación de Servicios · Programa SICR3P Scope 3 para Mandantes', contraparte: 'Mandante' },
  asesoria: { codigo: 'SICR3P-LEGAL-05', sujeto: 'cliente', titulo: 'Contrato de Asesoría Scope 3 y Carpeta Verde Financiable', contraparte: 'Cliente' },
  auspicio: { codigo: 'SICR3P-LEGAL-01', sujeto: 'auspiciador', titulo: 'Convenio Marco de Auspicio, Movilidad y Colaboración · Ruta SICR3P', contraparte: 'Auspiciador' },
  comodato: { codigo: 'SICR3P-LEGAL-06', sujeto: 'auspiciador', titulo: 'Contrato de Comodato de Vehículo · Ruta SICR3P', contraparte: 'Comodante' },
};
export const TIPO_POR_DEFECTO = 'asesoria';

// 'proveedor' (empresa enrolada vía la sección SII) reusa los tipos de
// contrato de 'cliente': para el paquete es el mismo tipo de relación
// (servicio pagado por la contraparte), solo cambia la tabla de origen.
export const TIPOS_DE = (sujeto) =>
  Object.entries(TIPOS).filter(([, t]) => t.sujeto === (sujeto === 'proveedor' ? 'cliente' : sujeto)).map(([k]) => k);

// Datos del prestador, tomados del certificado de Inscripción al Rol Único
// Tributario del SII (folio 16548963, 06-07-2026).
//
// OJO — DISCREPANCIA SIN RESOLVER: todo el paquete contractual está
// redactado a nombre de "SICR3P SpA", pero la entidad inscrita en el SII
// es una FUNDACIÓN con otra razón social. No es lo mismo: cambia la
// naturaleza jurídica, la gobernanza y el tratamiento tributario, y una
// fundación sin fines de lucro prestando servicios B2B pagados merece
// revisión propia. Aquí se usan los datos REALES del certificado; alinear
// el paquete es una decisión del titular con su abogado, no un
// find-replace.
export const PRESTADOR = {
  razon_social: 'FUNDACIÓN ENTRETODOS',
  rut: '65.279.032-1',
  tipo_entidad: 'Fundación',
  domicilio: 'Los Conquistadores 13704, Antofagasta',
  representante: 'Edward Gonzalo Venegas Bugueño',
  representante_rut: '17.434.487-6',
  forma_actuacion: 'Cualquiera de los representantes actuando individualmente',
  constitucion: 'Escritura pública N° 2232 de 27-03-2018, Notaría N° 4 de La Serena',
};

// Los campos [●] que el paquete exige completar antes de firmar. El propio
// índice del paquete (SICR3P-LEGAL-00 §2) los lista como "decisiones que
// deben completarse". Los datos del prestador salieron de esta lista al
// llegar el certificado del SII; entró en su lugar la discrepancia de
// razón social.
export const PUNTOS_PENDIENTES = [
  'Precio en UF más IVA y calendario de pagos',
  'Razón social del prestador: el paquete dice "SICR3P SpA" y el SII inscribe una fundación',
  'Representante de la contraparte y sus facultades',
  'Fecha del documento',
  'Plazo de aviso de incidentes de seguridad (solo contrato de mandante)',
  'Auspicio: aporte monetario en UF, duración, jornadas comprometidas y reglas de uso de marca',
  'Comodato: patente, VIN, kilometraje, póliza, deducible, conductores autorizados y reparto de gastos',
];

export const ESTADOS = ['borrador', 'emitido', 'aceptado', 'anulado'];

// Número legible del contrato. Aleatorio, no correlativo: un correlativo
// filtra cuántos clientes hay y obliga a un lock para no repetirlo.
export function generarNumeroContrato() {
  return `CT-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

// Marca de los campos sin completar. Los .docx usan "●" (U+25CF), pero las
// fuentes estándar del PDF (Helvetica, WinAnsi) no tienen ese glifo y lo
// imprimen como basura. Se usa el bullet "•" (U+2022), que sí está en
// WinAnsi y se ve igual de evidente.
export const PENDIENTE = '[•]';

const fecha = (d) => {
  if (!d) return null;
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toISOString().slice(0, 10);
};

export function tipoValido(tipo) {
  return Object.prototype.hasOwnProperty.call(TIPOS, tipo);
}

// Foto de las condiciones al momento de emitir. Se guarda en
// contratos.datos y es lo que el PDF imprime — nunca se relee el cliente
// en vivo, porque el contrato debe seguir diciendo lo que decía.
export function snapshotCliente(cliente = {}) {
  return {
    razon_social: cliente.nombre_empresa || '',
    rut: cliente.rut || '',
    contacto_email: cliente.contacto_email || '',
    plan: cliente.plan || 'piloto',
    estado_contrato: cliente.estado_contrato || 'piloto',
    fecha_inicio: fecha(cliente.fecha_inicio),
    fecha_fin: fecha(cliente.fecha_fin),
  };
}

// Foto del auspiciador al emitir, con la misma lógica que la del cliente.
export function snapshotAuspiciador(a = {}) {
  const v = a.vehiculo || {};
  return {
    razon_social: a.nombre_empresa || '',
    rut: a.rut || '',
    contacto_email: a.contacto_email || '',
    aporta_vehiculo: Boolean(a.aporta_vehiculo),
    vehiculo: {
      marca: v.marca || '', modelo: v.modelo || '', patente: v.patente || '', anio: v.anio || '',
    },
    fecha_inicio: fecha(a.fecha_inicio),
    fecha_fin: fecha(a.fecha_fin),
  };
}

// Foto de la empresa (proveedor) al emitir. Misma forma que snapshotCliente
// para que clausulas()/hashContrato() no distingan el origen: `proveedores`
// no tiene plan/estado_contrato/fecha_inicio/fecha_fin (no es un contrato
// comercial con esos términos hoy), así que quedan con un valor neutro.
export function snapshotProveedor(p = {}) {
  return {
    razon_social: p.nombre_empresa || '',
    // `proveedores.rut` se guarda normalizado (76222089K) porque así se cruza
    // con el RCV; en el contrato tiene que leerse como se escribe en Chile.
    rut: formatearRut(p.rut),
    contacto_email: p.contacto_email || '',
    plan: 'estandar',
    estado_contrato: p.activo === false ? 'vencido' : 'activo',
    fecha_inicio: fecha(p.created_at),
    fecha_fin: null,
  };
}

// Snapshot correcto según la contraparte. `sujeto` explícito (recomendado)
// distingue proveedor de cliente aunque compartan tipo de contrato; sin él
// se infiere del tipo (comportamiento previo, sigue sirviendo para
// cliente/auspiciador).
export function snapshotDe(entidad, tipo, sujeto) {
  const s = sujeto || TIPOS[tipo]?.sujeto;
  if (s === 'auspiciador') return snapshotAuspiciador(entidad);
  if (s === 'proveedor') return snapshotProveedor(entidad);
  return snapshotCliente(entidad);
}

// ---------- cláusulas comunes ----------

function partes(d, tipo) {
  const t = TIPOS[tipo];
  const p = PRESTADOR;
  // En el comodato los roles se invierten: quien entrega el vehículo es el
  // Comodante (el auspiciador) y SICR3P recibe como Comodatario. Escribirlo
  // al revés cambiaría quién responde por el vehículo.
  const rolSicr3p = tipo === 'comodato' ? 'Comodatario' : 'SICR3P';
  return {
    titulo: 'Partes',
    parrafos: [
      `${p.razon_social}, ${p.tipo_entidad.toLowerCase()}, RUT ${p.rut}, domiciliada en ${p.domicilio}, `
        + `constituida por ${p.constitucion}, representada por ${p.representante}, RUT ${p.representante_rut} `
        + `(${p.forma_actuacion.toLowerCase()}), operadora de la plataforma sicr3p, en adelante "${rolSicr3p}".`,
      `${d.razon_social || PENDIENTE}, RUT ${d.rut || PENDIENTE}, representada por ${PENDIENTE}, `
        + `en adelante el "${t.contraparte}".`
        + (d.contacto_email ? ` Correo de contacto: ${d.contacto_email}.` : ''),
      `Nota pendiente de revisión legal: el paquete contractual está redactado a nombre de "SICR3P SpA", `
        + `mientras que la entidad inscrita ante el SII es ${p.razon_social} (${p.tipo_entidad}). `
        + `Debe resolverse cuál es la parte contratante antes de firmar.`,
    ],
    pendiente: true,
  };
}

const CONFIDENCIALIDAD = {
  titulo: 'Confidencialidad y datos',
  parrafos: [
    'Cada Parte protegerá la información confidencial con un estándar no inferior al utilizado para su propia información de similar naturaleza.',
    'El tratamiento de datos personales y corporativos se regirá por el Anexo de Encargo y Tratamiento de Datos (SICR3P-LEGAL-09), la Política de Privacidad y las instrucciones documentadas de la contraparte.',
    'Los antecedentes no se remitirán a un banco, leasing u otro financiador sin la Autorización Específica de Derivación Financiera y Datos (SICR3P-LEGAL-04). Ningún otro documento la reemplaza.',
  ],
};

const LEY_APLICABLE = {
  titulo: 'Firma electrónica, ley y jurisdicción',
  parrafos: [
    'El contrato podrá suscribirse electrónicamente de conformidad con la Ley N° 19.799 sobre documentos electrónicos y firma electrónica.',
    'Se regirá por la ley chilena. Las Partes fijan domicilio en Antofagasta y se someten a sus tribunales ordinarios.',
  ],
};

const REFERENCIAS = {
  titulo: 'Referencias normativas',
  parrafos: [
    'Se incorporan como marco de redacción, y deben verificarse nuevamente al momento de la firma:',
    'Código Civil, especialmente artículos 1545 (fuerza obligatoria del contrato) y 1546 (ejecución de buena fe).',
    'Ley N° 19.799 sobre documentos electrónicos, firma electrónica y servicios de certificación.',
    'Ley N° 19.628 sobre protección de la vida privada, mientras se encuentre vigente.',
    'Ley N° 21.719 sobre protección y tratamiento de datos personales, vigente desde el 1 de diciembre de 2026.',
    'Ley N° 21.521 (Fintec) y normativa CMF aplicable, especialmente en materia de asesoría crediticia.',
  ],
};

// ---------- SICR3P-LEGAL-02 · Mandante ----------

function clausulasMandante(d) {
  const vigencia = d.fecha_inicio
    ? (d.fecha_fin ? `desde el ${d.fecha_inicio} hasta el ${d.fecha_fin}` : `desde el ${d.fecha_inicio}, sin fecha de término pactada`)
    : `desde ${PENDIENTE} hasta ${PENDIENTE}`;
  return [
    partes(d, 'mandante'),
    {
      titulo: 'Objeto',
      parrafos: [
        'SICR3P prestará servicios de diagnóstico, captura, ordenamiento, clasificación, estimación y trazabilidad de información ambiental y operacional de los proveedores seleccionados por el Mandante, con énfasis en emisiones indirectas de Alcance 3.',
        `El servicio se desarrollará como ${PENDIENTE} (piloto de 90 días o programa anual), para ${PENDIENTE} proveedores, en las categorías, ciudades, unidades y períodos indicados en los anexos.`,
      ],
      pendiente: true,
    },
    {
      titulo: 'Alcance incluido',
      parrafos: [
        'Diseño de alcance, selección de categorías y criterios de materialidad.',
        'Invitación e incorporación de proveedores; soporte web, remoto y presencial.',
        'Recepción de XML, PDF, imágenes, planillas y datos operacionales autorizados.',
        'Extracción, normalización, clasificación, aplicación de factores y Data Quality Score.',
        'Gestión de excepciones, documentos observados y trazabilidad de correcciones.',
        'Tablero, reportes, exportaciones y carpeta de evidencia conforme a los anexos.',
        'Informe final de brechas y recomendación de escalamiento.',
      ],
    },
    {
      titulo: 'Servicios excluidos',
      parrafos: [
        'Verificación acreditada, certificación oficial o assurance independiente.',
        'Presentación de declaraciones REP u otros trámites oficiales en representación del Mandante.',
        'Asesoría jurídica, tributaria, crediticia o de inversión.',
        'Medición instrumental, análisis de ciclo de vida completo o inventario organizacional no incluido.',
        'Garantía de reducción de emisiones o cumplimiento de metas de terceros.',
      ],
    },
    {
      titulo: 'Obligaciones del Mandante',
      parrafos: [
        'Definir el perímetro, proveedores, responsables internos y categorías prioritarias.',
        'Realizar la convocatoria institucional y obtener las autorizaciones necesarias.',
        'Entregar información verdadera, completa y oportuna; responder observaciones y validar asignaciones.',
        'No presentar los resultados como certificación acreditada ni modificar informes o códigos de verificación.',
        'Pagar el precio y facilitar accesos, reuniones y espacios acordados.',
      ],
    },
    {
      titulo: 'Obligaciones de SICR3P',
      parrafos: [
        'Aplicar la metodología declarada y mantener trazabilidad de factores, versiones y decisiones.',
        'Implementar controles razonables de seguridad, confidencialidad y acceso por roles.',
        'Informar limitaciones, estimaciones, cobertura y calidad de los datos.',
        'Entregar los productos dentro de los plazos, sujeto a recepción oportuna de antecedentes.',
        'Mantener independencia técnica y registrar correcciones mediante nuevas versiones.',
      ],
    },
    {
      titulo: 'Proveedores y autorizaciones',
      parrafos: [
        'Cada proveedor deberá suscribir o aceptar el Acuerdo de Participación (SICR3P-LEGAL-03). El acceso del Mandante a datos individualizados se limitará a los proveedores autorizados y a la finalidad del programa.',
      ],
    },
    {
      titulo: 'Metodología y calidad',
      parrafos: [
        'La metodología aplicable será la versión indicada en el Anexo Metodológico (SICR3P-LEGAL-07). Los resultados se expresarán con alcance, categoría, dato de actividad, factor, fuente, cobertura, versión y Data Quality Score.',
        'Los métodos basados en gasto serán identificados como estimaciones de menor precisión. Un registro insuficiente podrá quedar pendiente, observado o excluido del consolidado.',
      ],
    },
    {
      titulo: 'Entregables y aceptación',
      parrafos: [
        'Los entregables serán los establecidos en el anexo respectivo. El Mandante dispondrá de 10 días hábiles para formular observaciones específicas. En ausencia de observaciones dentro del plazo, el entregable se tendrá por aceptado para efectos de facturación.',
        'Las observaciones no podrán exigir prestaciones no contratadas. Las correcciones de errores imputables a SICR3P se efectuarán sin costo; los cambios de alcance serán cotizados.',
      ],
    },
    {
      titulo: 'Precio y pagos',
      parrafos: [
        `El precio total será de ${PENDIENTE} UF más IVA, pagadero: ${PENDIENTE}% al inicio, ${PENDIENTE}% al hito intermedio y ${PENDIENTE}% contra entrega final. Los servicios recurrentes serán de ${PENDIENTE} UF más IVA mensuales.`,
        'Los viajes, viáticos, integraciones especiales, reprocesamientos históricos y servicios de terceros se incluyen solo si están expresamente cotizados.',
      ],
      pendiente: true,
    },
    {
      titulo: 'Propiedad y licencias',
      parrafos: [
        'Los documentos originales y datos del Mandante o sus proveedores continuarán perteneciendo a sus respectivos titulares. SICR3P conservará la propiedad de su plataforma, motor, metodología, plantillas, taxonomías y diseño de informes.',
        'SICR3P otorga al Mandante una licencia no exclusiva para usar los entregables internamente y en reportes, sin alterar sus advertencias, metodología ni códigos de verificación.',
      ],
    },
    CONFIDENCIALIDAD,
    {
      titulo: 'Seguridad e incidentes',
      parrafos: [
        'SICR3P mantendrá medidas razonables, incluyendo cifrado en tránsito, control de acceso, registro de actividad y encadenamiento de integridad.',
        `Informará incidentes relevantes al Mandante dentro de ${PENDIENTE} horas desde su confirmación, sin perjuicio del plazo legal aplicable.`,
      ],
      pendiente: true,
    },
    {
      titulo: 'Responsabilidad',
      parrafos: [
        'Cada Parte será responsable por los daños directos y previsibles causados por incumplimiento culpable.',
        'Salvo dolo, culpa grave, infracción de confidencialidad, datos o propiedad intelectual, la responsabilidad total de SICR3P no excederá lo pagado por el Mandante durante los doce meses anteriores al hecho.',
        'SICR3P no responderá por información falsa o incompleta, decisiones de proveedores, mandantes, bancos, reguladores o verificadores, ni por el uso de resultados fuera del alcance declarado.',
      ],
    },
    {
      titulo: 'Vigencia y terminación',
      parrafos: [
        `El contrato regirá ${vigencia}. Podrá terminarse por incumplimiento no subsanado dentro de 10 días hábiles, insolvencia, infracción de confidencialidad o imposibilidad regulatoria.`,
        'En caso de término anticipado, el Mandante pagará los servicios efectivamente ejecutados y gastos comprometidos no cancelables. SICR3P entregará una exportación razonable de los datos conforme al contrato.',
      ],
    },
    LEY_APLICABLE,
    REFERENCIAS,
  ];
}

// ---------- SICR3P-LEGAL-05 · Asesoría ----------

function clausulasAsesoria(d) {
  return [
    partes(d, 'asesoria'),
    {
      titulo: 'Objeto',
      parrafos: [
        `SICR3P realizará un diagnóstico Scope 3 y preparará una Carpeta Verde asociada al proyecto de inversión ${PENDIENTE}, a partir de información comercial, operacional y ambiental entregada por el Cliente.`,
      ],
      pendiente: true,
    },
    {
      titulo: 'Etapas',
      parrafos: [
        'Reunión inicial y delimitación del servicio.',
        'Inventario de antecedentes y evaluación de calidad.',
        'Estimación preliminar de emisiones y categorías relevantes.',
        'Descripción del proyecto, línea base, ahorros y reducción esperada.',
        'Informe final y carpeta documental organizada.',
        'Una reunión de presentación con el Cliente y, si existe autorización, con un tercero.',
      ],
    },
    {
      titulo: 'Entregables',
      parrafos: [
        'Informe de Diagnóstico Scope 3.',
        'Matriz de documentos y brechas.',
        'Data Quality Score y plan de mejora.',
        'Ficha técnica y económica del proyecto con supuestos declarados.',
        'Carpeta Verde en formato digital.',
      ],
    },
    {
      titulo: 'No asesoría crediticia ni garantía',
      parrafos: [
        'SICR3P no presta mediante este contrato evaluaciones o recomendaciones respecto de la capacidad o probabilidad de pago del Cliente, no selecciona el crédito más conveniente, no representa a una entidad financiera y no garantiza aprobación.',
        'Toda decisión, análisis crediticio, tasa, garantía, seguro, plazo o condición corresponde exclusivamente a la institución financiera y al Cliente.',
      ],
    },
    {
      titulo: 'Metodología y limitaciones',
      parrafos: [
        'Las emisiones serán estimadas conforme al Anexo Metodológico vigente (SICR3P-LEGAL-07). Los resultados dependen de la calidad, cobertura y representatividad de los datos y no equivalen a mediciones instrumentales, certificación acreditada ni taxonomía financiera oficial.',
        'Las proyecciones de ahorro o reducción son escenarios y no promesas de desempeño.',
      ],
    },
    {
      titulo: 'Obligaciones del Cliente',
      parrafos: [
        'Entregar antecedentes verdaderos, completos y oportunos.',
        'Validar supuestos, límites y asignaciones.',
        'Informar cambios del proyecto o cotizaciones.',
        'No alterar el informe ni omitir sus limitaciones.',
        'Pagar el precio y gastos contratados.',
      ],
    },
    {
      titulo: 'Precio y pagos',
      parrafos: [
        `El precio será de ${PENDIENTE} UF más IVA: 50% al contratar y 50% contra entrega. El seguimiento será de ${PENDIENTE} UF más IVA mensuales. Los viajes fuera de ${PENDIENTE} se cotizarán por separado.`,
      ],
      pendiente: true,
    },
    CONFIDENCIALIDAD,
    {
      titulo: 'Propiedad y uso',
      parrafos: [
        'El Cliente conserva sus datos. SICR3P conserva la metodología, plataforma y formato.',
        'El Cliente podrá usar la carpeta para sus gestiones, manteniendo sus advertencias y sin presentarla como aprobación o certificado oficial.',
      ],
    },
    {
      titulo: 'Plazos y aceptación',
      parrafos: [
        `El plazo estimado será de ${PENDIENTE} días hábiles desde la recepción completa de antecedentes. El Cliente tendrá 5 días hábiles para observaciones específicas. Se incluye una ronda de ajustes dentro del alcance.`,
      ],
      pendiente: true,
    },
    {
      titulo: 'Responsabilidad',
      parrafos: [
        'La responsabilidad de SICR3P se limitará a corregir errores metodológicos imputables y, salvo dolo o culpa grave, no excederá el precio pagado.',
        'No responderá por decisiones de terceros, rechazo financiero ni resultados operacionales del activo.',
      ],
    },
    {
      titulo: 'Vigencia',
      parrafos: [
        'El contrato terminará con la aceptación de entregables, sin perjuicio de confidencialidad, pagos y conservación.',
      ],
    },
    LEY_APLICABLE,
    REFERENCIAS,
  ];
}

// ---------- SICR3P-LEGAL-01 · Auspicio ----------

function clausulasAuspicio(d) {
  const veh = d.vehiculo || {};
  const vehiculoTexto = d.aporta_vehiculo
    ? `Vehículo ${[veh.marca, veh.modelo, veh.patente && `patente ${veh.patente}`, veh.anio].filter(Boolean).join(', ') || PENDIENTE}, bajo la modalidad jurídica del contrato de comodato específico (SICR3P-LEGAL-06).`
    : `Aporte de vehículo: no comprendido en este convenio.`;
  return [
    partes(d, 'auspicio'),
    {
      titulo: 'Antecedentes y propósito',
      parrafos: [
        'SICR3P desarrolla servicios de contabilidad de carbono trazable, levantamiento documental, acompañamiento a proveedores y generación de información para gestión ambiental. El programa "Ruta SICR3P" realiza jornadas en ciudades y centros industriales para diagnosticar brechas de información Alcance 3 y preparar proyectos de inversión sostenible.',
        'El Auspiciador desea apoyar la ejecución territorial del programa mediante los aportes de este convenio, sin adquirir control sobre la metodología, los resultados, la evaluación de proveedores ni las decisiones de instituciones financieras.',
      ],
    },
    {
      titulo: 'Objeto del convenio',
      parrafos: [
        'El Auspiciador aportará los bienes, servicios, recursos o facilidades individualizados en el anexo, y SICR3P ejecutará las actividades, acciones de visibilidad y reportes de gestión allí descritos.',
        'Este convenio no constituye sociedad, mandato general, agencia, representación, franquicia, relación laboral ni intermediación financiera entre las Partes.',
      ],
    },
    {
      titulo: 'Aportes del Auspiciador',
      parrafos: [
        vehiculoTexto,
        'Seguro, mantenciones, permiso de circulación, TAG, asistencia y vehículo de reemplazo, según el anexo.',
        `Aporte monetario de ${PENDIENTE} UF más IVA, pagadero conforme al calendario acordado.`,
        'Difusión, participación de ejecutivos, espacios para jornadas u otros aportes expresamente aceptados por escrito.',
      ],
      pendiente: true,
    },
    {
      titulo: 'Obligaciones de SICR3P',
      parrafos: [
        'Ejecutar las jornadas y actividades con diligencia profesional y conforme al plan aprobado.',
        'Usar los aportes exclusivamente para los fines convenidos y mantener respaldo razonable de su ejecución.',
        'Mantener independencia metodológica y abstenerse de alterar resultados para favorecer aprobaciones, colocaciones o productos del Auspiciador.',
        'Entregar reportes agregados de gestión, sin revelar información individual de proveedores salvo autorización específica.',
        'Cumplir las reglas de uso de marca, seguridad vial, protección de datos, anticorrupción y conflictos de interés.',
      ],
    },
    {
      titulo: 'Visibilidad y uso de marcas',
      parrafos: [
        'Cada Parte conserva la titularidad de sus marcas, nombres, diseños y contenidos. Su uso será limitado, revocable, no exclusivo y únicamente para las piezas previamente aprobadas.',
        'La condición de auspiciador no autoriza a afirmar que SICR3P, sus informes o los proveedores han sido certificados, aprobados o financiados por el Auspiciador. Toda comunicación deberá usar expresiones descriptivas y verificables.',
      ],
    },
    {
      titulo: 'Independencia financiera y regulatoria',
      parrafos: [
        'SICR3P preparará información ambiental, operacional y documental. No evaluará la capacidad o probabilidad de pago, no recomendará un crédito determinado, no negociará tasas en nombre del proveedor y no garantizará financiamiento.',
        'El Auspiciador efectuará de manera autónoma cualquier evaluación comercial, crediticia, de cumplimiento o de riesgo. La eventual remisión de antecedentes de un proveedor requerirá autorización específica y separada (SICR3P-LEGAL-04).',
      ],
    },
    {
      titulo: 'Datos, confidencialidad y reportes',
      parrafos: [
        'La información individual identificable de proveedores será confidencial. Los reportes de auspicio deberán ser agregados o anonimizados, salvo autorización escrita del titular y fundamento contractual suficiente.',
        'Las Partes observarán la Ley N° 19.628 y, desde su entrada en vigencia, la Ley N° 21.719.',
      ],
    },
    {
      titulo: 'Indicadores y entregables',
      parrafos: [
        'Los indicadores de actividad son metas de gestión y no garantías de resultado. Podrán comprender ciudades visitadas, jornadas, proveedores atendidos, documentos revisados, diagnósticos emitidos y carpetas preparadas.',
        'No constituirán resultados garantizados la aprobación de financiamientos, la reducción de emisiones, la obtención de sellos, la adjudicación de fondos públicos ni la contratación por un mandante.',
      ],
    },
    {
      titulo: 'Vigencia y terminación',
      parrafos: [
        `El convenio regirá por ${PENDIENTE} meses desde su firma y podrá renovarse por acuerdo escrito. Cualquiera de las Partes podrá terminarlo con aviso de 30 días corridos.`,
        'Procederá término inmediato por incumplimiento grave, uso no autorizado de marca, infracción de confidencialidad, actos de corrupción, riesgo reputacional objetivamente fundado, conducción no autorizada o incumplimiento regulatorio.',
      ],
      pendiente: true,
    },
    {
      titulo: 'Responsabilidad e indemnidad',
      parrafos: [
        'Cada Parte responderá por sus actos, personal y contratistas. Ninguna responderá por lucro cesante, pérdida de oportunidad o decisiones de terceros, salvo dolo o culpa grave.',
        'La Parte que infrinja derechos de propiedad intelectual, privacidad, deberes de confidencialidad o normas de tránsito mantendrá indemne a la otra respecto de reclamaciones directamente imputables a dicha infracción.',
      ],
    },
    {
      titulo: 'Cumplimiento y ética',
      parrafos: [
        'Las Partes declaran que no ofrecerán pagos indebidos, ventajas impropias ni beneficios destinados a influir en decisiones públicas o privadas. SICR3P podrá suspender una actividad ante señales razonables de incumplimiento.',
      ],
    },
    LEY_APLICABLE,
    REFERENCIAS,
  ];
}

// ---------- SICR3P-LEGAL-06 · Comodato de vehículo ----------

function clausulasComodato(d) {
  const v = d.vehiculo || {};
  const idVehiculo = [v.marca, v.modelo, v.anio].filter(Boolean).join(' ') || PENDIENTE;
  const plazo = d.fecha_inicio
    ? (d.fecha_fin ? `desde el ${d.fecha_inicio} hasta el ${d.fecha_fin}` : `desde el ${d.fecha_inicio} hasta ${PENDIENTE}`)
    : `desde ${PENDIENTE} hasta ${PENDIENTE}`;
  return [
    partes(d, 'comodato'),
    {
      titulo: 'Vehículo',
      parrafos: [
        `El Comodante entrega gratuitamente en comodato el vehículo ${idVehiculo}, patente ${v.patente || PENDIENTE}, VIN ${PENDIENTE}, con kilometraje inicial ${PENDIENTE} km, junto con sus accesorios y documentos, para uso temporal en la Ruta SICR3P.`,
        'El detalle completo se individualiza en el Acta de Entrega y Recepción (SICR3P-LEGAL-08), que forma parte de este contrato.',
      ],
      pendiente: true,
    },
    {
      titulo: 'Destino autorizado',
      parrafos: [
        'El vehículo se utilizará exclusivamente en actividades de SICR3P: visitas a proveedores, jornadas, reuniones, traslado de equipos y acciones de difusión.',
        'Queda prohibido su uso personal habitual, subarriendo, transporte remunerado, competencia, faena no autorizada o salida de Chile sin permiso escrito.',
      ],
    },
    {
      titulo: 'Conductores',
      parrafos: [
        `Solo podrán conducir las personas autorizadas por escrito (${PENDIENTE}), con licencia vigente y aptitud legal. SICR3P verificará los documentos y comunicará restricciones, sin perjuicio de la cobertura efectiva de la póliza.`,
      ],
      pendiente: true,
    },
    {
      titulo: 'Plazo y restitución',
      parrafos: [
        `El comodato durará ${plazo}. El Comodante podrá solicitar restitución anticipada por necesidad urgente e imprevista, uso indebido, falta de seguro o incumplimiento grave, concediendo un plazo razonable salvo riesgo inmediato.`,
        'La restitución se documentará mediante Acta, con kilometraje, combustible o carga, daños, accesorios, llaves y documentos.',
      ],
    },
    {
      titulo: 'Seguro y siniestros',
      parrafos: [
        `El vehículo mantendrá SOAP, seguro obligatorio aplicable y póliza de daños, robo, responsabilidad civil y asistencia (${PENDIENTE}). El deducible será de cargo de ${PENDIENTE}, salvo siniestro imputable a la otra Parte.`,
        'Todo accidente, robo o daño se informará inmediatamente al Comodante, a la aseguradora y a la autoridad cuando corresponda. SICR3P no reconocerá responsabilidad ni celebrará acuerdos con terceros sin coordinación, salvo urgencia.',
      ],
      pendiente: true,
    },
    {
      titulo: 'Gastos, multas e infracciones',
      parrafos: [
        `Combustible o energía: ${PENDIENTE}. TAG y peajes: ${PENDIENTE}. Permiso, revisión técnica y seguros: ${PENDIENTE}. Mantenciones programadas: ${PENDIENTE}.`,
        'Las reparaciones por uso indebido o negligencia del conductor serán de cargo de SICR3P.',
        'SICR3P asumirá multas, partes, estacionamientos y cargos derivados de hechos ocurridos durante su custodia, salvo defectos u obligaciones anteriores, e identificará al conductor cuando sea legalmente requerido.',
      ],
      pendiente: true,
    },
    {
      titulo: 'Custodia, rotulación y telemetría',
      parrafos: [
        'SICR3P conservará el vehículo con diligencia, realizará controles básicos, respetará mantenciones y no modificará partes ni sistemas. No instalará accesorios permanentes sin autorización.',
        'La instalación de gráficas será removible y aprobada por ambas Partes, y no podrá afectar pintura, seguridad, visibilidad ni garantía. Al término, SICR3P retirará la rotulación y reparará daños atribuibles a ella.',
        'Si el vehículo posee GPS o telemetría, el Comodante informará qué datos recolecta, con qué finalidad, quién accede y por cuánto tiempo. SICR3P informará a los conductores y limitará el uso a seguridad, operación, seguro y control contractual.',
      ],
    },
    {
      titulo: 'Inspección y bitácora',
      parrafos: [
        'El Comodante podrá inspeccionar el vehículo con aviso razonable, sin interferir injustificadamente en la operación. SICR3P mantendrá bitácora de kilometraje, mantenciones, incidentes y conductores.',
      ],
    },
    {
      titulo: 'Responsabilidad',
      parrafos: [
        'Cada Parte responderá por daños directos imputables a su incumplimiento.',
        'SICR3P no responderá por vicios ocultos, fallas mecánicas previas ni interrupciones no imputables; el Comodante no responderá por pérdida de oportunidades derivada de indisponibilidad.',
      ],
    },
    {
      titulo: 'Prohibición de disposición',
      parrafos: [
        'El comodato no transfiere dominio ni faculta a vender, gravar, ceder, subarrendar o entregar el vehículo a terceros. El Comodante mantiene la propiedad y el derecho a recuperarlo conforme al contrato.',
      ],
    },
    {
      titulo: 'Firma electrónica, ley y jurisdicción',
      parrafos: [
        'El contrato podrá firmarse electrónicamente conforme a la Ley N° 19.799.',
        'Se regirá por la ley chilena, incluidas las normas del comodato del Código Civil, y las Partes fijan domicilio en Antofagasta.',
      ],
    },
    REFERENCIAS,
  ];
}

// Cuerpo del contrato. Puro: mismas condiciones y tipo → mismas cláusulas.
export function clausulas(datos = {}, tipo = TIPO_POR_DEFECTO) {
  if (!tipoValido(tipo)) throw new Error(`Tipo de contrato desconocido: ${tipo}`);
  const base = TIPOS[tipo].sujeto === 'auspiciador' ? snapshotAuspiciador({}) : snapshotCliente({});
  const d = { ...base, ...datos };
  const cuerpo = {
    mandante: clausulasMandante, asesoria: clausulasAsesoria,
    auspicio: clausulasAuspicio, comodato: clausulasComodato,
  }[tipo];
  return cuerpo(d).map((c, i) => ({ n: i + 1, pendiente: false, ...c }));
}

export function clausulasPendientes(datos, tipo) {
  return clausulas(datos, tipo).filter((c) => c.pendiente);
}

// Un contrato solo puede salir de 'borrador' cuando la plantilla ya no
// tiene campos [●]. El paquete es explícito: "no publicar ni firmar sin
// completar campos [●] y revisión profesional".
export function puedeEmitirse() {
  return PUNTOS_PENDIENTES.length === 0;
}

// Sello propio del documento: prueba que el PDF entregado corresponde a
// estas condiciones, a este tipo de contrato y a esta versión de plantilla.
//
// Incluye el TEXTO renderizado de las cláusulas, no solo el snapshot: sin
// eso, editar una cláusula sin subir PLANTILLA_VERSION cambiaría el
// contrato entregado dejando el sello intacto.
//
// `datos` ya viene en forma de snapshot (razon_social, no nombre_empresa),
// así que se leen sus campos tal cual. Pasarlo otra vez por
// snapshotCliente() dejaría la razón social fuera del hash.
export function hashContrato({ numero, plantilla_version, tipo = TIPO_POR_DEFECTO, datos, created_at }) {
  const d = datos || {};
  const texto = clausulas(d, tipoValido(tipo) ? tipo : TIPO_POR_DEFECTO)
    .map((c) => `${c.n}|${c.titulo}|${c.parrafos.join('¶')}`)
    .join('\n');
  const canonico = [
    numero || '', plantilla_version || '', tipo || '',
    d.razon_social || '', d.rut || '', d.contacto_email || '', d.plan || '', d.estado_contrato || '',
    d.fecha_inicio || '', d.fecha_fin || '',
    // Campos propios del auspiciador; vacíos en un contrato de cliente.
    d.aporta_vehiculo ? '1' : '', JSON.stringify(d.vehiculo || {}),
    created_at ? new Date(created_at).toISOString() : '',
    sha256(texto),
  ].join('|');
  return sha256(canonico);
}
