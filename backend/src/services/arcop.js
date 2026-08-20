// ============================================================
// Ejercicio de derechos del titular (Ley 21.719): acceso, rectificación,
// supresión, oposición y portabilidad.
//
// La validación es PURA y no lanza nunca — es un formulario público y una
// excepción sería un 500 en la cara de quien ejerce su derecho. Mismo
// molde que services/auspicio.js, que resuelve la misma forma: alguien de
// afuera pide algo, alguien adentro lo resuelve.
//
// LA PARTE QUE HAY QUE LEER CON CUIDADO es `limitesDeSupresion()`. El
// derecho de supresión NO alcanza a los registros contables encadenados
// por hash: se conservan por obligación legal (respaldo tributario) y
// para el ejercicio de reclamaciones. Eso no se resuelve borrando en
// silencio ni prometiendo lo que rompería la cadena — se responde. Esta
// función arma esa respuesta a partir del inventario, para que salga del
// sistema y no de la memoria de quien atiende.
// ============================================================

import { rutValido } from './dte.js';
import {
  INVENTARIO, INVENTARIO_CORREDOR, PERSONAL, CADENA, tablasConDatosDe, retenidoPorLey,
  BD_PRINCIPAL, BD_CORREDOR,
} from './inventarioDatos.js';

export const DERECHOS = ['acceso', 'rectificacion', 'supresion', 'oposicion', 'portabilidad'];

export const ETIQUETA_DERECHO = {
  acceso: 'Acceso — saber qué datos suyos hay',
  rectificacion: 'Rectificación — corregir un dato equivocado',
  supresion: 'Supresión — eliminar sus datos',
  oposicion: 'Oposición — que dejen de usarse',
  portabilidad: 'Portabilidad — llevarse sus datos',
};

export const MAX_DETALLE = 2000;

// Plazo de respuesta. PENDIENTE DE CONFIRMACIÓN LEGAL: es un valor por
// defecto razonable, no la cifra del texto de la ley. Se usa solo para
// ordenar y advertir en la bandeja, nunca para rechazar nada.
export const PLAZO_RESPUESTA_DIAS = Number(process.env.ARCOP_PLAZO_DIAS) || 30;

const texto = (v, max) => String(v ?? '').trim().slice(0, max);
const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Valida una solicitud pública. Devuelve { ok, error, datos }.
 *
 * Se acepta identificarse por RUT o por correo: quien ejerce puede no
 * tener cuenta —un conductor, un contacto antiguo— y exigirle un RUT
 * cuando lo único que dejó fue un correo lo dejaría fuera.
 */
export function validarSolicitud(entrada) {
  // `= {}` no basta: express.json() entrega `null` cuando el cuerpo es
  // literalmente `null`, y el default solo cubre `undefined`.
  const body = entrada && typeof entrada === 'object' ? entrada : {};
  const derecho = texto(body.derecho, 20);
  if (!DERECHOS.includes(derecho)) {
    return { ok: false, error: 'Indica cuál de tus derechos quieres ejercer' };
  }

  const rutCrudo = texto(body.rut, 20);
  const email = texto(body.email, 200).toLowerCase();

  if (!rutCrudo && !email) {
    return { ok: false, error: 'Identifícate con tu RUT o con tu correo' };
  }
  if (rutCrudo && !rutValido(rutCrudo)) {
    return { ok: false, error: 'El RUT no es válido' };
  }
  if (email && !CORREO.test(email)) {
    return { ok: false, error: 'El correo no es válido' };
  }

  // Rectificar sin decir qué está mal no es accionable.
  const detalle = texto(body.detalle, MAX_DETALLE);
  if (derecho === 'rectificacion' && !detalle) {
    return { ok: false, error: 'Cuéntanos qué dato está equivocado y cuál es el correcto' };
  }

  return {
    ok: true,
    error: null,
    datos: {
      derecho,
      rut: rutCrudo || null,
      email: email || null,
      nombre: texto(body.nombre, 150) || null,
      detalle: detalle || null,
    },
  };
}

/**
 * Dónde buscar los datos de este titular. Sale del inventario, así que
 * agregar mañana una tabla con datos personales la incorpora sola —
 * siempre que se clasifique, cosa que el test obliga.
 *
 * Cada destino trae la BASE en la que vive (`bd`). No es un detalle de
 * implementación que quien consulta pueda ignorar: las tablas del Corredor
 * están en otra base y Postgres no permite consultarlas con el pool
 * equivocado. Hasta el 20-08-2026 esto no se declaraba, la ruta las
 * buscaba todas en la base principal y las del Corredor se saltaban en
 * silencio; el titular recibía un paquete incompleto con cara de completo.
 */
export function dondeBuscar({ rut, email }) {
  const destinos = new Map();
  for (const id of [rut, email].filter(Boolean)) {
    for (const d of tablasConDatosDe(id)) {
      // La llave lleva la base: `puntos_corredor` existe en las dos y
      // agrupar solo por nombre volvería a fundir dos tablas distintas.
      const llave = `${d.bd}:${d.tabla}`;
      const previo = destinos.get(llave) || { tabla: d.tabla, bd: d.bd, columnas: new Set() };
      d.columnas.forEach((c) => previo.columnas.add(c));
      destinos.set(llave, previo);
    }
  }
  return [...destinos.values()].map((d) => ({ tabla: d.tabla, bd: d.bd, columnas: [...d.columnas] }));
}

/**
 * Qué se puede borrar y qué no, con el fundamento de cada cosa.
 *
 * Esto es la respuesta a una supresión, no su ejecución. La lista de
 * retenidos sale del inventario: si mañana una tabla deja de estar
 * encadenada, deja de aparecer acá sola.
 */
export function limitesDeSupresion() {
  const retenido = retenidoPorLey();
  const borrable = Object.entries(INVENTARIO)
    .filter(([, e]) => e.clasificacion === PERSONAL && e.retencion !== null)
    .map(([tabla]) => tabla);

  return {
    borrable,
    retenido,
    // El texto que se le responde al titular. Explícito sobre por qué no
    // es un "no" arbitrario.
    explicacion:
      'Los registros contables ya emitidos y sellados en la cadena de integridad no se pueden '
      + 'eliminar: se conservan por obligación legal de respaldo tributario y para el ejercicio '
      + 'de reclamaciones, y alterarlos invalidaría la verificación de todos los documentos '
      + 'posteriores. El resto de los datos personales sí se elimina o se anonimiza.',
  };
}

/** Días transcurridos desde que entró, para ordenar y advertir la bandeja. */
export function diasEsperando(creada, ahora = new Date()) {
  if (!creada) return 0;
  const t = creada instanceof Date ? creada.getTime() : Date.parse(creada);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((ahora.getTime() - t) / (24 * 60 * 60 * 1000)));
}

/** ¿Se pasó del plazo de respuesta? Informativo, no bloquea nada. */
export const fueraDePlazo = (creada, ahora = new Date()) =>
  diasEsperando(creada, ahora) > PLAZO_RESPUESTA_DIAS;

/**
 * Arma el paquete de datos del titular a partir de lo que las consultas
 * ya trajeron. Función pura: quien consulta es la ruta.
 *
 * Sirve igual para acceso (mostrarlo) y para portabilidad (descargarlo):
 * es el mismo contenido, cambia el envase.
 */
export function armarPaquete({ titular, hallazgos = [], sinRevisar = [], generadoAt = null }) {
  // La ficha de la tabla sale del inventario de SU base. Buscarla siempre
  // en INVENTARIO dejaba a las del Corredor sin finalidad ni base de
  // licitud: aparecían los datos, pero sin decir para qué se tratan, que
  // es justamente lo que el derecho de acceso obliga a informar.
  const ficha = (h) => (h.bd === BD_CORREDOR ? INVENTARIO_CORREDOR : INVENTARIO)[h.tabla] || {};

  const secciones = hallazgos
    .filter((h) => h.filas?.length)
    .map((h) => ({
      tabla: h.tabla,
      base_datos: h.bd || BD_PRINCIPAL,
      finalidad: ficha(h).finalidad || null,
      base_licitud: ficha(h).base || null,
      encadenada: (ficha(h).cadena ?? CADENA.NINGUNA) !== CADENA.NINGUNA,
      registros: h.filas,
    }));

  const notas = [];
  if (!secciones.length) {
    notas.push('No se encontraron registros asociados a ese identificador en las tablas consultadas.');
  }
  // Lo no revisado se declara SIEMPRE, haya o no hallazgos. Un paquete al
  // que le falta una base entera y no lo dice es peor que uno incompleto
  // que se reconoce como tal: el titular no tiene cómo enterarse.
  if (sinRevisar.length) {
    const cuales = sinRevisar.map((t) => t.tabla).join(', ');
    notas.push(
      `ATENCIÓN — esta respuesta está INCOMPLETA: no se pudieron revisar ${sinRevisar.length} `
      + `tabla(s) (${cuales}). Antes de entregarla al titular hay que resolver el motivo y volver `
      + 'a generarla.'
    );
  }

  return {
    titular,
    generado_at: generadoAt,
    responsable: 'sicr3p',
    total_registros: secciones.reduce((n, s) => n + s.registros.length, 0),
    secciones,
    completa: sinRevisar.length === 0,
    sin_revisar: sinRevisar,
    // Sin datos no se afirma que no existan en ninguna parte: se dice
    // exactamente lo que se buscó.
    nota: notas.length ? notas.join(' ') : null,
  };
}
