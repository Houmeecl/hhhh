// ============================================================
// Expediente de evidencia — funciones PURAS.
//
// La idea entera en una frase: **transformar cada venta en un expediente
// respaldado por los DTE y documentos relacionados**, en vez de hacer la
// contabilidad de carbono del cliente.
//
// Lo que este archivo calcula NO es una emisión. Es el estado de la
// evidencia: qué documentos hay, con qué grado de asociación a la venta,
// cuánto del respaldo esperado está cubierto y —sobre todo— QUÉ FALTA.
// La brecha es el producto, no el subproducto.
//
// ------------------------------------------------------------
// DOS EJES, NO UNA ESCALA
// ------------------------------------------------------------
// Hay dos preguntas distintas y mezclarlas sería prometer de más:
//
//   Respaldo documental   1 Declarado · 2 Documentado · 3 Consistente ·
//                         4 Validado en fuente · 5 Revisado externamente
//   Constancia de entrega sin acuse · acuse firmado · acuse con cantidad ·
//                         acuse con evidencia
//
// Un documento puede estar validado contra el SII (nivel 4) y no haberse
// entregado nunca; y una entrega puede estar firmada respaldada por un
// documento apenas declarado (nivel 1). La recepción NO es un sexto nivel
// del respaldo documental: es otro eje. Acá vive el primero; el segundo
// vive en el acuse de recepción.
//
// ------------------------------------------------------------
// LO QUE UN EXPEDIENTE NO ACREDITA
// ------------------------------------------------------------
// Está en NO_ACREDITA y viaja con cada artefacto que sale a un tercero.
// No es letra chica defensiva: es la línea que separa "ordenamos y
// mostramos evidencia" de "certificamos". sicr3p es un custodio neutral
// de evidencia de proveedores, no un certificador.
// ============================================================

import { CATEGORIAS_ALCANCE3_GHG_PROTOCOL } from './alcanceGhg.js';

// ------------------------------------------------------------
// Vocabulario — debe coincidir 1:1 con los CHECK de la migración 105.
// ------------------------------------------------------------
export const ROLES_DOCUMENTO = [
  'venta_principal', 'compra_relacionada', 'guia',
  'certificado', 'ficha_tecnica', 'orden_compra', 'otro',
];

export const TIPOS_ASOCIACION = ['directa', 'confirmada', 'compartida'];

export const TIPOS_EXPEDIENTE = ['suministro', 'servicio', 'transporte', 'arriendo', 'otro'];

export const ESTADOS_EXPEDIENTE = ['borrador', 'abierto', 'cerrado'];

// Nombres legibles, para que el PDF y la UI no inventen cada uno el suyo.
export const NOMBRE_ROL = {
  venta_principal: 'Factura de venta',
  compra_relacionada: 'Compra relacionada',
  guia: 'Guía de despacho',
  certificado: 'Certificado',
  ficha_tecnica: 'Ficha técnica',
  orden_compra: 'Orden de compra',
  otro: 'Otro documento',
};

// ------------------------------------------------------------
// Qué documentos se ESPERAN según lo que se vendió.
//
// Es un mapa de DATOS, no de esquema —mismo criterio y mismo precedente
// que DOCUMENTOS_ESPERADOS_POR_TIPO_CARGA en pasaporteOrigen.js—: se
// ajusta sin tocar el CHECK de la tabla. No es exhaustivo ni normativo.
//
// 'otro' queda deliberadamente VACÍO: sin esperados no hay denominador, y
// sin denominador el semáforo es GRIS ("no se opina"), que no es lo mismo
// que rojo ("no cumple"). Un porcentaje inventado sobre un denominador
// que nadie definió sería peor que no dar porcentaje.
// ------------------------------------------------------------
export const ROLES_ESPERADOS_POR_TIPO = {
  suministro: ['venta_principal', 'orden_compra', 'guia', 'compra_relacionada', 'ficha_tecnica'],
  servicio: ['venta_principal', 'orden_compra', 'compra_relacionada', 'certificado'],
  transporte: ['venta_principal', 'orden_compra', 'guia', 'compra_relacionada'],
  arriendo: ['venta_principal', 'orden_compra', 'compra_relacionada'],
  otro: [],
};

// ------------------------------------------------------------
// Peso de cada tipo de asociación en la cobertura.
//
// 'directa' vale entero. 'confirmada' y 'compartida' valen su proporción:
// una compra prorrateada al 15% respalda 0,15 de ese eje, no 1. Contarla
// entera sería exactamente la exageración que estamos evitando.
// ------------------------------------------------------------
export function pesoAsociacion(doc) {
  if (!doc) return 0;
  const pct = Number(doc.porcentaje);
  if (doc.asociacion === 'directa') return 1;
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  return Math.min(pct, 100) / 100;
}

// Un documento está RESPALDADO si sicr3p tiene el DTE detrás (cargado y
// encadenado, o bajado del RCV del propio proveedor). Sin ninguno de los
// dos vínculos es un documento DECLARADO: existe según el proveedor, y
// eso es todo lo que se puede decir de él.
export function estaRespaldado(doc) {
  return Boolean(doc?.factura_id || doc?.dte_proveedor_id);
}

// Nivel de respaldo de UN documento suelto: 1 (declarado) o 2 (documentado).
// La escala completa de cinco niveles la resuelve nivelConfianza(), sobre
// el DATO, y es la que sale por la API en resumenDato().
//
// NO SUBE MÁS ALTO, Y ESA ES LA CORRECCIÓN. Antes esta función devolvía 3
// con solo tener `factura_id`. Pero el nivel 3 es «Consistente: los
// documentos relacionados coinciden» — una propiedad ENTRE documentos, no
// de uno solo mirándose a sí mismo. Un documento aislado no puede coincidir
// con nadie, así que repartir el 3 desde acá era regalar un nivel que nadie
// se ganó. Del 3 para arriba responde nivelConfianza(), que mira el dato
// completo con todos sus respaldos.
export function nivelRespaldo(doc) {
  if (!doc) return 0;
  return estaRespaldado(doc) ? 2 : 1;
}

// ------------------------------------------------------------
// Cobertura documental — el único número del expediente.
//
// Por cada rol ESPERADO se toma el mejor documento presente de ese rol y
// se suma su peso de asociación; el resultado se divide por la cantidad de
// roles esperados. Un rol sin ningún documento aporta 0.
//
// Devuelve `null` cuando no hay esperados definidos. Null NO es cero: es
// "no se opina". Todo el resto del servicio respeta esa distinción.
// ------------------------------------------------------------
export function coberturaDocumental(tipo, documentos = []) {
  const esperados = ROLES_ESPERADOS_POR_TIPO[tipo] || [];
  if (!esperados.length) return null;

  const mejorPorRol = new Map();
  for (const d of documentos || []) {
    const peso = pesoAsociacion(d);
    if (peso > (mejorPorRol.get(d?.rol) || 0)) mejorPorRol.set(d.rol, peso);
  }

  const suma = esperados.reduce((acc, rol) => acc + (mejorPorRol.get(rol) || 0), 0);
  return Math.round((suma / esperados.length) * 100);
}

// Semáforo, con el mismo vocabulario de colores que semaforoDocumental()
// en pasaporteOrigen.js — un solo lenguaje de colores en todo el producto.
//
// gris: no hay esperados definidos → no se opina.
// verde: cobertura completa.
// amarillo: hay respaldo, falta algo.
// rojo: no hay nada todavía.
export function semaforoExpediente(cobertura) {
  if (cobertura === null || cobertura === undefined) return 'gris';
  if (cobertura >= 100) return 'verde';
  if (cobertura > 0) return 'amarillo';
  return 'rojo';
}

// Etiqueta del estado del expediente, en las palabras del informe.
export function estadoCobertura(cobertura) {
  if (cobertura === null || cobertura === undefined) return 'Sin evaluar';
  if (cobertura >= 100) return 'Completo';
  if (cobertura > 0) return 'Parcial';
  return 'Sin respaldo';
}

// ------------------------------------------------------------
// Brechas — qué falta, dicho de forma accionable.
//
// Dos familias:
//   · Roles esperados sin ningún documento ("falta la guía de despacho").
//   · Datos que un documento presente no trae y que hacen falta para que
//     el dato sea calculable aguas abajo: la distancia del transporte, el
//     destino del combustible, la base del prorrateo.
//
// La segunda familia es la que importa: son las brechas que el proveedor
// puede cerrar hoy y que su cliente le va a pedir igual. Que las vea antes
// que su cliente es la mitad del valor del expediente.
// ------------------------------------------------------------
export function brechasDe(expediente, documentos = []) {
  const brechas = [];
  const docs = documentos || [];
  const esperados = ROLES_ESPERADOS_POR_TIPO[expediente?.tipo] || [];
  const presentes = new Set(docs.map((d) => d?.rol));

  for (const rol of esperados) {
    if (!presentes.has(rol)) {
      brechas.push({
        codigo: `falta_${rol}`,
        rol,
        severidad: rol === 'venta_principal' ? 'alta' : 'media',
        detalle: `Falta ${NOMBRE_ROL[rol].toLowerCase()} en el expediente.`,
      });
    }
  }

  // Documentos declarados: existen según el proveedor y nada más.
  for (const d of docs) {
    if (!estaRespaldado(d)) {
      brechas.push({
        codigo: 'documento_declarado',
        rol: d.rol,
        severidad: 'media',
        detalle: `«${d.descripcion}» está declarado pero sicr3p no tiene el documento: `
          + 'queda en nivel 1 (declarado), sin respaldo verificable.',
      });
    }
  }

  // Prorrateos sin base explicada. Un 15% sin decir 15% DE QUÉ no se puede
  // reproducir, y un dato que no se puede reproducir no es evidencia.
  for (const d of docs) {
    if (d.asociacion !== 'directa' && !String(d.base_prorrateo || '').trim()) {
      brechas.push({
        codigo: 'prorrateo_sin_base',
        rol: d.rol,
        severidad: 'media',
        detalle: `«${d.descripcion}» se asocia al ${Number(d.porcentaje)}% sin declarar `
          + 'la base del prorrateo (por consumo, por horas, por superficie…).',
      });
    }
  }

  if (!String(expediente?.faena || '').trim()) {
    brechas.push({
      codigo: 'sin_faena',
      rol: null,
      severidad: 'baja',
      detalle: 'El expediente no indica faena ni destino: sin él no se puede atribuir '
        + 'el consumo a una operación del cliente.',
    });
  }

  if (!String(expediente?.orden_compra || '').trim()) {
    brechas.push({
      codigo: 'sin_orden_compra',
      rol: null,
      severidad: 'baja',
      detalle: 'El expediente no indica orden de compra: no consolidará con las otras '
        + 'facturas del mismo encargo.',
    });
  }

  return brechas;
}

// ------------------------------------------------------------
// Clasificación de alcance POTENCIAL — la palabra está en el dato.
//
// Dos perspectivas, porque el mismo hecho se clasifica distinto según
// quién lo mire:
//
//   · Para el PROVEEDOR, sus compras relacionadas son su propio inventario
//     (Alcance 1 si quemó el combustible, 2 si es electricidad comprada,
//     3 si es un bien o servicio adquirido).
//   · Para el CLIENTE, lo que compró es Alcance 3 — Categoría 1 (bienes y
//     servicios adquiridos), o Categoría 4 cuando lo contratado es
//     transporte aguas arriba.
//
// Se llama POTENCIAL porque sicr3p no conoce el límite organizacional del
// cliente, ni su año base, ni si ya contabilizó esto por otra vía. Es la
// clasificación que le CORRESPONDERÍA; confirmarla es del cliente.
// ------------------------------------------------------------
// Aguas ARRIBA del cliente: lo que él compra. Categorías 1, 4 y 8.
export const CATEGORIA_CLIENTE_POR_TIPO = {
  transporte: 4,
  suministro: 1,
  servicio: 1,
  arriendo: 8,
  otro: 1,
};

// Aguas ABAJO: lo que pasa DESPUÉS de que la empresa vendió — el cátodo
// que sigue viaje, se procesa, se usa y termina su vida. Son las
// categorías 9 a 12 del GHG Protocol, que services/alcanceGhg.js ya
// nombraba desde siempre pero que hasta acá no tenían dónde vivir: todo el
// modelo miraba solo hacia arriba.
//
// La clave es el ESLABÓN aguas abajo, no el tipo de venta: el mismo cátodo
// cae en la 9 mientras lo transportan y en la 10 cuando lo funden.
export const CATEGORIA_AGUAS_ABAJO = {
  transporte_posterior: 9,   // Transporte y distribución — aguas abajo
  procesamiento: 10,         // Procesamiento de productos vendidos
  uso: 11,                   // Uso de productos vendidos
  fin_de_vida: 12,           // Fin de vida de productos vendidos
};

export const ETAPAS_AGUAS_ABAJO = Object.keys(CATEGORIA_AGUAS_ABAJO);

// Categoría potencial de un dato, mirando su dirección. Devuelve null
// cuando no se puede decidir —una etapa aguas abajo que no se declaró— en
// vez de caer al 1 por defecto: la categoría 1 es «bienes y servicios
// adquiridos», que aguas abajo sería sencillamente falsa.
export function categoriaPotencialDeDato(dato, expediente) {
  if (dato?.direccion === 'abajo') {
    return CATEGORIA_AGUAS_ABAJO[dato?.etapa] ?? null;
  }
  // Misma regla que scopePotencial: 'otro' (o un tipo desconocido) no cae
  // a la 1 por comodidad. null es "no se opina", no "categoría 1".
  const tipo = expediente?.tipo;
  return tipo && tipo !== 'otro' ? (CATEGORIA_CLIENTE_POR_TIPO[tipo] ?? null) : null;
}

export function scopePotencial(expediente) {
  const tipo = expediente?.tipo || 'otro';
  // 'otro' NO cae a la categoría 1 por defecto, y esto importa más de lo
  // que parece: es el mismo tipo para el que la cobertura documental
  // devuelve null porque no hay esperados definidos («no se opina»).
  // Emitir ahí «Alcance 3 · Categoría 1 — Bienes y servicios adquiridos»
  // sería afirmar algo sobre la contabilidad del cliente justo en el caso
  // donde declaramos no tener base para opinar — y es la ÚNICA pantalla
  // donde sicr3p dice algo sobre el inventario ajeno. El gris manda igual
  // acá que en la cobertura.
  const categoria = Object.prototype.hasOwnProperty.call(CATEGORIA_CLIENTE_POR_TIPO, tipo)
    && tipo !== 'otro'
    ? CATEGORIA_CLIENTE_POR_TIPO[tipo]
    : null;
  return {
    // Cara del cliente: siempre Alcance 3 — le compró a un tercero. Eso sí
    // se puede afirmar sin conocer su tipo de venta; la CATEGORÍA, no.
    cliente: {
      alcance_potencial: 3,
      categoria_potencial: categoria,
      nombre_categoria: categoria ? (CATEGORIAS_ALCANCE3_GHG_PROTOCOL[categoria] || null) : null,
      nota: categoria
        ? 'Clasificación potencial. sicr3p no conoce el límite organizacional ni el año '
          + 'base del cliente: confirmarla es del cliente.'
        : 'Sin categoría: este tipo de expediente no permite proponer una categoría de '
          + 'Alcance 3. Clasificarlo es del cliente.',
    },
    // Cara del proveedor: depende de CADA compra relacionada, no del
    // expediente. Se resuelve documento a documento aguas arriba, con la
    // categoría del motor; acá se dice explícitamente que no se resuelve
    // en bloque, en vez de devolver un número cómodo y falso.
    proveedor: {
      nota: 'El alcance de cada compra relacionada depende de esa compra (1 si el proveedor '
        + 'quemó el combustible, 2 si es electricidad comprada, 3 si es un bien o servicio '
        + 'adquirido). No se resuelve a nivel de expediente.',
    },
  };
}

// ------------------------------------------------------------
// Lo que NO se acredita. Viaja con cada artefacto que sale a un tercero
// y hay un test que lo exige (test/expediente.test.js).
// ------------------------------------------------------------
export const NO_ACREDITA = [
  'No acredita que el producto se haya utilizado en la faena.',
  'No acredita que toda declaración del proveedor sea verdadera.',
  'No acredita que el servicio se haya ejecutado correctamente.',
  'No acredita cumplimiento ambiental.',
  'No es una certificación.',
  'Una factura acredita una operación documental; no demuestra por sí sola entrega, uso ni desempeño.',
];

export const NOTA_SCOPE = 'sicr3p prepara la evidencia; no calcula las tCO₂e del cliente.';

// ------------------------------------------------------------
// El resumen que consumen la ruta, la UI y el informe. Una sola fuente.
// ------------------------------------------------------------
export function resumenExpediente(expediente, documentos = []) {
  const docs = documentos || [];
  const cobertura = coberturaDocumental(expediente?.tipo, docs);
  const respaldados = docs.filter(estaRespaldado).length;

  return {
    id: expediente?.id || null,
    cliente_nombre: expediente?.cliente_nombre || null,
    orden_compra: expediente?.orden_compra || null,
    contrato: expediente?.contrato || null,
    faena: expediente?.faena || null,
    periodo: expediente?.periodo || null,
    tipo: expediente?.tipo || 'otro',
    estado: expediente?.estado || 'borrador',

    documentos_total: docs.length,
    documentos_respaldados: respaldados,
    documentos_declarados: docs.length - respaldados,

    cobertura_documental: cobertura,     // null = no se opina
    estado_cobertura: estadoCobertura(cobertura),
    semaforo: semaforoExpediente(cobertura),
    roles_esperados: ROLES_ESPERADOS_POR_TIPO[expediente?.tipo] || [],

    pendientes: brechasDe(expediente, docs),
    scope: scopePotencial(expediente),

    no_acredita: NO_ACREDITA,
    nota_scope: NOTA_SCOPE,
  };
}

// ------------------------------------------------------------
// Validación de un documento antes de guardarlo. Espeja los CHECK de la
// migración para dar un mensaje en español en vez de un 500 de Postgres.
// ------------------------------------------------------------
export function validarDocumento(d) {
  if (!d || typeof d !== 'object') return { ok: false, error: 'Falta el documento.' };
  if (!ROLES_DOCUMENTO.includes(d.rol)) {
    return { ok: false, error: `Rol no válido. Usa uno de: ${ROLES_DOCUMENTO.join(', ')}.` };
  }
  const asociacion = d.asociacion || 'directa';
  if (!TIPOS_ASOCIACION.includes(asociacion)) {
    return { ok: false, error: `Asociación no válida. Usa: ${TIPOS_ASOCIACION.join(', ')}.` };
  }
  if (!String(d.descripcion || '').trim()) {
    return { ok: false, error: 'El documento necesita una descripción legible.' };
  }
  const pct = asociacion === 'directa' ? 100 : Number(d.porcentaje);
  // Mayor que 0, no "entre 0 y 100": un documento asociado al 0% no
  // respalda nada, así que registrarlo como respaldo sería una fila que
  // dice lo contrario de lo que significa. Mismo límite que el CHECK de la
  // migración 105 (porcentaje > 0) y que el min del formulario.
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
    return { ok: false, error: 'El porcentaje de asociación debe ser mayor que 0 y hasta 100.' };
  }
  if (asociacion === 'directa' && d.porcentaje !== undefined
      && Number(d.porcentaje) !== 100) {
    return {
      ok: false,
      error: 'Una asociación directa es 100% por definición. Usa «confirmada» o «compartida» '
        + 'para una proporción.',
    };
  }
  if (d.factura_id && d.dte_proveedor_id) {
    return { ok: false, error: 'Un documento viene de una factura cargada o del RCV, no de ambas.' };
  }

  // tipo_dte es SMALLINT y monto es NUMERIC(14,2) en la migración 105.
  // Sin este chequeo, un "abc" o un 99999 no daban un 400 con explicación
  // sino un 500 crudo de Postgres (22P02 / 22003) — el error se escapaba
  // del código que lo entiende hacia una capa que solo sabe decir "algo
  // falló". Los códigos de DTE del SII son de dos dígitos (33, 34, 52,
  // 56, 61...), así que 1..999 sobra y cabe holgado en SMALLINT.
  let tipoDte = null;
  if (d.tipo_dte !== undefined && d.tipo_dte !== null && d.tipo_dte !== '') {
    tipoDte = Number(d.tipo_dte);
    if (!Number.isInteger(tipoDte) || tipoDte < 1 || tipoDte > 999) {
      return { ok: false, error: 'El tipo de documento (DTE) debe ser un código del SII, como 33 o 61.' };
    }
  }

  let monto = null;
  if (d.monto !== undefined && d.monto !== null && d.monto !== '') {
    monto = Number(d.monto);
    // 10^12 con dos decimales es el techo de NUMERIC(14,2). El límite se
    // dice en pesos porque es lo que el proveedor está escribiendo.
    if (!Number.isFinite(monto) || monto < 0 || monto >= 1e12) {
      return { ok: false, error: 'El monto debe ser un número entre 0 y 999.999.999.999.' };
    }
  }

  // La cantidad que declara ESTE documento (migración 106): el insumo de
  // verificarConsistencia(). Misma validación que el monto, por el mismo
  // motivo — NUMERIC(18,4).
  let cantidad = null;
  if (d.cantidad !== undefined && d.cantidad !== null && d.cantidad !== '') {
    cantidad = Number(d.cantidad);
    if (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad >= 1e14) {
      return { ok: false, error: 'La cantidad del documento debe ser un número mayor que 0.' };
    }
  }

  return {
    ok: true,
    valor: { ...d, asociacion, porcentaje: pct, tipo_dte: tipoDte, monto, cantidad },
  };
}

// ============================================================
// EL DATO TRAZABLE — consistencia y nivel de confianza (migración 106)
//
// Todo lo de arriba mira DOCUMENTOS. Lo de acá mira el DATO: la cantidad
// que la venta afirma, con los documentos que la respaldan colgando de
// ella. «50 filtros» es el dato; la factura 1234 es uno de sus respaldos.
//
// Las cuatro dimensiones que sicr3p puede demostrar:
//   · Procedencia   — de qué documento y de qué empresa salió (factura_id /
//                     dte_proveedor_id / declarado).
//   · Integridad    — que el archivo no cambió (facturas.sha256 y la cadena
//                     de hash, migraciones 013 y 104).
//   · Consistencia  — que los documentos relacionados COINCIDEN. Es lo que
//                     calcula verificarConsistencia(), y era la única de
//                     las cuatro que no existía.
//   · Validación    — que se contrastó con una fuente autorizada.
//
// Y la frase que ordena todo esto: **un dato respaldado y trazable no es
// un dato garantizado como verdadero.** La veracidad de lo declarado
// responde a quien lo declaró.
// ============================================================

export const DIRECCIONES = ['arriba', 'abajo'];
export const ESLABONES = ['subproveedor', 'proveedor', 'cliente', 'cliente_final'];
export const FUENTES_VALIDACION = ['sii', 'erp', 'mandante', 'certificador'];

// Tolerancia al comparar cantidades entre documentos. Existe por el
// redondeo de las unidades de medida, no para tapar diferencias: media
// unidad de 50 es 1%, y una guía que dice 48 contra una factura que dice
// 50 sigue siendo un desacuerdo. Mismo espíritu que TOLERANCIA_MERMA_PCT
// en pasaporteOrigen.js, pero mucho más estrecho: allá se tolera merma
// física real, acá solo error de redondeo.
export const TOLERANCIA_CANTIDAD = 0.5;

const norm = (v) => String(v ?? '').trim().toLowerCase();

// ------------------------------------------------------------
// Consistencia entre los documentos que respaldan un mismo dato.
//
// Devuelve { consistente, desacuerdos, comparados }.
//
// `consistente` es TRES estados, no dos:
//   null  → no había con qué comparar (menos de dos valores). NO es
//           "coinciden": es "no se opina", el mismo criterio con que la
//           cobertura documental distingue el gris del verde.
//   true  → se comparó y coinciden.
//   false → se comparó y NO coinciden.
//
// UN DESACUERDO NO SE CORRIGE, SE REGISTRA. Si la factura dice 50 y la
// guía dice 48, elegir uno de los dos sería inventar evidencia; el
// hallazgo ES el dato valioso. Mismo criterio con que balanceMasas()
// trata la merma: advierte y nunca bloquea.
// ------------------------------------------------------------
export function verificarConsistencia(dato, documentos = []) {
  const desacuerdos = [];
  const docs = (documentos || []).filter(Boolean);

  // --- Cantidad ---
  // Se compara contra lo que el dato afirma, más lo que declara cada
  // documento que trae cantidad. Un certificado o una ficha técnica no
  // declaran cantidad y simplemente no participan.
  const conCantidad = docs.filter((d) => Number.isFinite(Number(d.cantidad)));
  const valoresCantidad = conCantidad.map((d) => ({
    documento: d.descripcion, rol: d.rol, valor: Number(d.cantidad), unidad: d.unidad || null,
  }));
  if (Number.isFinite(Number(dato?.cantidad))) {
    valoresCantidad.unshift({
      documento: 'Cantidad declarada del dato', rol: null,
      valor: Number(dato.cantidad), unidad: dato.unidad || null,
    });
  }

  if (valoresCantidad.length >= 2) {
    // Unidades distintas primero: comparar 50 unidades con 48 kilos no es
    // un desacuerdo de cantidad, es una comparación que no se puede hacer.
    // Convertir por nuestra cuenta sería inventar un factor que nadie dio.
    const unidades = [...new Set(valoresCantidad.map((v) => norm(v.unidad)).filter(Boolean))];
    if (unidades.length > 1) {
      desacuerdos.push({
        campo: 'unidad',
        detalle: 'Los documentos declaran la cantidad en unidades distintas: no se pueden '
          + 'comparar sin un factor de conversión declarado.',
        valores: valoresCantidad.map((v) => ({ documento: v.documento, valor: v.unidad })),
      });
    } else {
      const min = Math.min(...valoresCantidad.map((v) => v.valor));
      const max = Math.max(...valoresCantidad.map((v) => v.valor));
      const difPct = max > 0 ? ((max - min) / max) * 100 : 0;
      if (difPct > TOLERANCIA_CANTIDAD) {
        desacuerdos.push({
          campo: 'cantidad',
          detalle: `La cantidad no coincide entre los documentos: va de ${min} a ${max}.`,
          diferencia_pct: Math.round(difPct * 100) / 100,
          valores: valoresCantidad.map((v) => ({ documento: v.documento, valor: v.valor })),
        });
      }
    }
  }

  // --- Fecha contra el período del expediente ---
  // Una guía de enero respaldando una venta de julio puede tener
  // explicación, pero merece verse. Es advertencia, no bloqueo.
  const periodo = String(dato?.periodo || '').trim();
  if (/^\d{4}-\d{2}$/.test(periodo)) {
    const fuera = docs
      .filter((d) => /^\d{4}-\d{2}/.test(String(d.fecha || '')))
      .filter((d) => String(d.fecha).slice(0, 7) !== periodo);
    if (fuera.length) {
      desacuerdos.push({
        campo: 'fecha',
        detalle: `Hay documentos fuera del período ${periodo} del expediente.`,
        valores: fuera.map((d) => ({ documento: d.descripcion, valor: String(d.fecha).slice(0, 10) })),
      });
    }
  }

  // --- Folio repetido con emisores distintos ---
  // Dos documentos con el mismo folio y distinto emisor no son el mismo
  // documento; que aparezcan como respaldo del mismo dato es señal de que
  // uno de los dos está mal identificado.
  const porFolio = new Map();
  for (const d of docs) {
    const folio = norm(d.folio);
    if (!folio) continue;
    if (!porFolio.has(folio)) porFolio.set(folio, []);
    porFolio.get(folio).push(d);
  }
  for (const [folio, lista] of porFolio) {
    const emisores = [...new Set(lista.map((d) => norm(d.emisor_rut)).filter(Boolean))];
    if (emisores.length > 1) {
      desacuerdos.push({
        campo: 'folio',
        detalle: `El folio ${folio} aparece con más de un emisor: uno de los documentos está mal identificado.`,
        valores: lista.map((d) => ({ documento: d.descripcion, valor: d.emisor_rut })),
      });
    }
  }

  // ¿Hubo algo que comparar? Sin dos valores de nada, no se opina.
  const comparados = valoresCantidad.length >= 2
    || (/^\d{4}-\d{2}$/.test(periodo) && docs.some((d) => d.fecha))
    || [...porFolio.values()].some((l) => l.length > 1);

  return {
    consistente: comparados ? desacuerdos.length === 0 : null,
    desacuerdos,
    comparados,
  };
}

// ------------------------------------------------------------
// Nivel de confianza de un dato: 1..4. El 5 NUNCA sale de acá.
//
// Quién otorga cada nivel, que es la parte que importa:
//   1 Declarado          — el proveedor lo escribió. Lo otorga él.
//   2 Documentado        — hay un DTE detrás. Lo otorga el sistema al
//                          engancharse el documento.
//   3 Consistente        — los documentos coinciden. Lo otorga
//                          verificarConsistencia(), NUNCA una persona.
//   4 Validado en fuente — contrastado contra SII, ERP, mandante o
//                          certificador, con quién y cuándo registrados.
//   5 Revisado externamente — NO SE EMITE. Necesita un rol de auditor que
//                          hoy no existe; devolverlo sería declarar una
//                          revisión que nadie hizo. Hay un test que exige
//                          que ningún camino de esta función llegue a 5.
// ------------------------------------------------------------
export function nivelConfianza(dato, documentos = []) {
  const docs = (documentos || []).filter(Boolean);
  const hayRespaldo = docs.some(estaRespaldado);
  if (!hayRespaldo) return 1;

  const { consistente } = verificarConsistencia(dato, docs);

  // El 4 exige los tres campos de la validación. El CHECK de la migración
  // 106 dice lo mismo a nivel de esquema: sin quién, contra qué y cuándo,
  // "validado en fuente" es una etiqueta que no se puede verificar.
  const validado = Boolean(dato?.validado_por && dato?.validado_fuente && dato?.validado_at)
    && FUENTES_VALIDACION.includes(String(dato.validado_fuente));

  // Contradicción declarada: si los documentos NO coinciden, la validación
  // en fuente no puede tapar eso. Un dato con desacuerdos abiertos se queda
  // en 2 aunque alguien lo haya contrastado — primero se resuelve el
  // desacuerdo, o se explica. Que `consistente` sea null (no había con qué
  // comparar) SÍ deja llegar al 4: no comparar no es contradecirse.
  if (consistente === false) return 2;
  if (validado) return 4;
  return consistente === true ? 3 : 2;
}

export const NOMBRE_NIVEL_CONFIANZA = {
  1: 'Declarado',
  2: 'Documentado',
  3: 'Consistente',
  4: 'Validado en fuente',
  5: 'Revisado externamente',
};

// Resumen de un dato, con las cuatro dimensiones a la vista.
export function resumenDato(dato, documentos = [], expediente = null) {
  const docs = (documentos || []).filter(Boolean);
  // El período vive en el expediente, no en el dato: se inyecta acá para
  // que verificarConsistencia() pueda revisar las fechas sin que cada
  // llamador tenga que acordarse de componer el objeto a mano.
  const conPeriodo = { ...dato, periodo: dato?.periodo ?? expediente?.periodo ?? null };
  const consistencia = verificarConsistencia(conPeriodo, docs);
  const nivel = nivelConfianza(conPeriodo, docs);
  return {
    id: dato?.id || null,
    direccion: dato?.direccion || 'arriba',
    eslabon: dato?.eslabon || 'proveedor',
    etapa: dato?.etapa || null,
    producto: dato?.producto || null,
    cantidad: dato?.cantidad ?? null,
    unidad: dato?.unidad || null,

    nivel_confianza: nivel,
    nombre_nivel: NOMBRE_NIVEL_CONFIANZA[nivel],
    // Las cuatro dimensiones, cada una respondida por separado. Juntarlas
    // en un solo número las volvería incomparables entre sí.
    procedencia: docs.some(estaRespaldado) ? 'documento_en_sicr3p' : 'declarada_por_el_proveedor',
    integridad: docs.filter((d) => d.factura_id).length,
    consistente: consistencia.consistente,
    desacuerdos: consistencia.desacuerdos,
    validado_fuente: dato?.validado_fuente || null,
    validado_por: dato?.validado_por || null,
    validado_at: dato?.validado_at || null,

    categoria_scope_potencial: categoriaPotencialDeDato(dato, expediente),
    documentos_respaldo: docs.length,

    no_acredita: NO_ACREDITA,
  };
}
