// ============================================================
// El tramo como primera clase — funciones PURAS.
//
// Una carga que sale de Campo Grande y termina en Antofagasta cruza tres
// fronteras, y cada cruce pide su propia evidencia. Antes de esto el
// semáforo documental usaba UNA lista para toda carga: le decía a todos
// que les faltaba lo mismo, y por lo tanto no le decía nada a nadie.
//
// QUÉ ES Y QUÉ NO ES ESTA LISTA. Es la evidencia que sicr3p le va a pedir
// al exportador para armar el expediente de exportación —lo que exigen
// CBAM, el EUDR o el comprador—. NO es el trámite aduanero: el despacho,
// el tránsito y la documentación que revisa la aduana los ve el agente de
// aduana, y sicr3p no opina de eso. Ver docs/CORREDOR-ALCANCE.md.
//
// SIN POSICIÓN DE VEHÍCULOS, otra vez. El tramo se arma con los puntos de
// control del catálogo, que son lugares fijos y públicos. Saber que una
// carga va de Campo Grande a Antofagasta no es saber dónde está.
// ============================================================

// Comodín para "cualquier país": una factura comercial se pide en todo
// tramo, y repetirla país por país sería una tabla que hay que editar en
// doce lugares cada vez que cambia una regla.
export const CUALQUIER_PAIS = '*';

const texto = (v) => (v == null ? '' : String(v).trim());

// Cómo se llama en pantalla cada tipo de documento. El slug es lo que se
// guarda —para que la regla sobreviva a un cambio de nombre—, pero el
// nombre legible vive ACÁ y no en el frontend: el PDF y la pantalla tienen
// que decirle lo mismo al exportador, y dos mapas se separan solos.
export const ETIQUETA_DOCUMENTO = {
  factura_comercial: 'Factura comercial',
  certificado_origen: 'Certificado de origen',
  carta_porte_internacional: 'Carta de porte internacional (CRT)',
  packing_list: 'Lista de empaque',
  certificado_fitosanitario: 'Certificado fitosanitario',
  documento_origen_forestal: 'Documento de origen forestal (DOF)',
  guia_forestal: 'Guía forestal',
  declaracion_jurada_origen: 'Declaración jurada de origen',
};

// Un tipo que no esté en el mapa se muestra legible en vez de desaparecer:
// la tabla `documentos_por_tramo` se puede editar, y un documento nuevo no
// puede quedar sin nombre en la pantalla hasta que alguien toque el código.
export function etiquetaDocumento(slug) {
  const s = texto(slug);
  return ETIQUETA_DOCUMENTO[s] || (s ? s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '—');
}

// La posición de un punto en el corredor, o nada.
//
// `Number(null)` es 0 y `Number.isFinite(0)` es true, así que un punto sin
// orden se colaba al COMIENZO del corredor: entraba en cualquier tramo que
// empezara en 0 y, si estaba en otro país, inventaba un cruce de frontera
// —y con él documentos que esa carga no tiene por qué conseguir—. Es el
// mismo `null ≠ 0` que defiende `coordenadaValida` con la longitud.
function ordenDe(p) {
  const v = p?.orden;
  if (v == null || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Los puntos del tramo, en orden, entre origen y destino inclusive.
// Devuelve [] si falta alguno de los dos, si no están en el catálogo o si
// alguno no tiene posición en el corredor: inventar un tramo parcial sería
// peor que no mostrar ninguno.
export function puntosDelTramo(puntos, origenId, destinoId) {
  // Se recorta POR POSICIÓN EN LA LISTA ORDENADA y no por rango de
  // `orden`, porque `orden` no es único en la tabla. Con dos puntos
  // empatados, comparar los números dejaba el tramo a merced del orden en
  // que la base devolvió las filas: podía devolver el destino primero, los
  // cruces salían invertidos y el semáforo pedía los documentos del
  // sentido contrario. Con índices, el tramo siempre empieza en el origen
  // y termina en el destino.
  const ordenados = (puntos || [])
    .filter((p) => p && p.id != null && ordenDe(p) !== null)
    // El id desempata para que dos puntos del mismo orden queden siempre
    // en la misma secuencia, corrida tras corrida.
    .sort((a, b) => (ordenDe(a) - ordenDe(b)) || String(a.id).localeCompare(String(b.id)));

  const i = ordenados.findIndex((p) => p.id === origenId);
  const j = ordenados.findIndex((p) => p.id === destinoId);
  if (i < 0 || j < 0) return [];

  const tramo = ordenados.slice(Math.min(i, j), Math.max(i, j) + 1);
  // Si el destino va antes que el origen, la carga va al revés: el orden
  // del catálogo es el del corredor, no el de esta carga.
  return i <= j ? tramo : tramo.reverse();
}

// Los cruces de frontera del tramo: pares (desde, hasta) donde cambia el
// país entre dos puntos consecutivos. Un tramo dentro de un mismo país no
// tiene cruces, y eso es un resultado, no un error.
export function crucesDelTramo(puntosOrdenados) {
  const cruces = [];
  const puntos = puntosOrdenados || [];
  for (let i = 1; i < puntos.length; i += 1) {
    const desde = texto(puntos[i - 1].pais).toUpperCase();
    const hasta = texto(puntos[i].pais).toUpperCase();
    if (!desde || !hasta || desde === hasta) continue;
    if (cruces.some((c) => c.pais_desde === desde && c.pais_hasta === hasta)) continue;
    cruces.push({ pais_desde: desde, pais_hasta: hasta, en: puntos[i].id });
  }
  return cruces;
}

const aplicaA = (regla, cruce) => {
  const rd = texto(regla.pais_desde).toUpperCase();
  const rh = texto(regla.pais_hasta).toUpperCase();
  return (rd === CUALQUIER_PAIS || rd === cruce.pais_desde)
    && (rh === CUALQUIER_PAIS || rh === cruce.pais_hasta);
};

// Los tipos de documento que exige este tramo, sin repetir.
//
// Un mismo tipo puede venir de dos cruces distintos (y de la regla
// comodín): se pide UNA vez, se deja dicho por cuáles cruces se pide, y
// basta que una sola regla lo marque obligatorio para que lo sea —
// rebajarlo porque otro cruce lo pide opcional sería quedarse con la
// exigencia más floja de las dos.
// Separa los cruces del tramo entre los que sicr3p ya definió y los que
// todavía está armando. El corredor se incorpora UNA FRONTERA A LA VEZ y
// hoy Chile no está: exigirle a una carga los documentos de un cruce sin
// revisar es presentar como obligación algo que nadie contrastó contra
// fuente. Ver migrations-corredor/004.
export function separarCruces(cruces, definiciones) {
  const estadoDe = new Map(
    (definiciones || []).map((d) => [`${texto(d.pais_desde)}→${texto(d.pais_hasta)}`, d])
  );
  const definidos = [];
  const pendientes = [];
  for (const c of cruces || []) {
    const d = estadoDe.get(`${c.pais_desde}→${c.pais_hasta}`);
    // Sin fila en `cruces_corredor` el cruce NO está definido. El default
    // es el gris: que falte la definición no puede leerse como que está
    // lista, o alcanzaría con olvidarse de cargarla para que un cruce
    // pase por revisado.
    if (d?.estado === 'definido') definidos.push(c);
    else pendientes.push({ ...c, nota: d?.nota || null });
  }
  return { definidos, pendientes };
}

export function exigenciasDelTramo(cruces, catalogo) {
  const porTipo = new Map();
  const listaCruces = cruces?.length ? cruces : [];
  // El comodín aplica aunque el tramo no cruce ninguna frontera: hay
  // documentos que se piden por exportar, no por cruzar.
  const contextos = listaCruces.length
    ? listaCruces
    : [{ pais_desde: CUALQUIER_PAIS, pais_hasta: CUALQUIER_PAIS, en: null }];

  for (const cruce of contextos) {
    for (const regla of catalogo || []) {
      if (!aplicaA(regla, cruce)) continue;
      const tipo = texto(regla.tipo_documento);
      if (!tipo) continue;
      // Por qué se pide. Una regla comodín se pide POR EXPORTAR, no por
      // cruzar una frontera en particular: atribuirle los tres cruces
      // diría que la factura comercial la exige el paso BR→PY, que es
      // falso y confunde a quien la vaya a conseguir.
      const esComodin = texto(regla.pais_desde) === CUALQUIER_PAIS && texto(regla.pais_hasta) === CUALQUIER_PAIS;
      const motivo = esComodin || !cruce.en ? 'exportación' : `${cruce.pais_desde}→${cruce.pais_hasta}`;
      const previo = porTipo.get(tipo);
      porTipo.set(tipo, {
        tipo_documento: tipo,
        etiqueta: etiquetaDocumento(tipo),
        obligatorio: Boolean(previo?.obligatorio) || regla.obligatorio !== false,
        nota: previo?.nota || regla.nota || null,
        por: [...(previo?.por || []), motivo].filter((v, i, a) => a.indexOf(v) === i),
      });
    }
  }
  // Obligatorios primero, y dentro de cada grupo, alfabético: la pantalla
  // muestra esta lista tal cual y el orden no puede depender del orden en
  // que la base devolvió las filas.
  return [...porTipo.values()].sort(
    (a, b) => (Number(b.obligatorio) - Number(a.obligatorio)) || a.tipo_documento.localeCompare(b.tipo_documento)
  );
}

// Estado documental del tramo: qué exige, qué llegó, qué falta.
//
// `listo` es null —no false— cuando el tramo no está definido: sin origen
// ni destino no hay contra qué comparar, y decir "no está listo" sería
// opinar sin base. Misma doctrina del gris que semaforoExportacion().
export function estadoDocumentalTramo({ tramoDefinido, exigencias, documentos, crucesPendientes = [] }) {
  const subidos = new Set(
    (documentos || [])
      .filter((d) => d && d.estado !== 'rechazado')
      .map((d) => texto(d.tipo_documento))
      .filter(Boolean)
  );
  const items = (exigencias || []).map((e) => ({ ...e, cumplido: subidos.has(e.tipo_documento) }));
  const faltantes = items.filter((i) => !i.cumplido && i.obligatorio);
  const opcionalesFaltantes = items.filter((i) => !i.cumplido && !i.obligatorio);
  const pendientes = crucesPendientes || [];

  // Tres respuestas distintas, y el orden importa:
  //
  //  false → faltan documentos de los cruces YA definidos. Eso es
  //          accionable y no puede quedar en gris: el gris se comería
  //          al rojo y el exportador no sabría que le falta algo suyo.
  //  null  → está todo lo juzgable, pero queda un cruce sin definir.
  //          No se puede decir "listo" de un tramo cuyo último cruce
  //          nadie revisó; un verde que no se sostiene cuesta más caro
  //          que un gris incómodo.
  //  true  → todo lo obligatorio y ningún cruce pendiente.
  let listo = null;
  if (tramoDefinido) {
    if (faltantes.length) listo = false;
    else if (pendientes.length) listo = null;
    else listo = true;
  }

  return {
    definido: Boolean(tramoDefinido),
    items,
    faltantes: faltantes.map((i) => i.tipo_documento),
    opcionales_faltantes: opcionalesFaltantes.map((i) => i.tipo_documento),
    obligatorios: items.filter((i) => i.obligatorio).length,
    cumplidos: items.filter((i) => i.cumplido && i.obligatorio).length,
    // Los cruces que el tramo atraviesa y sicr3p todavía no definió, con
    // su motivo. Se muestran: "todavía no está" sin decir qué falta es
    // una excusa, no una razón.
    cruces_pendientes: pendientes.map((c) => ({
      cruce: `${c.pais_desde}→${c.pais_hasta}`,
      nota: c.nota || null,
    })),
    listo,
  };
}

// Gris = no se opina; verde = está todo; rojo = no llegó ninguno de los
// obligatorios; amarillo = va a medias. Mismo vocabulario que el resto.
export function semaforoTramo(estado) {
  if (!estado || estado.listo === null) return 'gris';
  if (estado.listo) return 'verde';
  return estado.cumplidos === 0 ? 'rojo' : 'amarillo';
}

export function glosaTramo(estado) {
  // Dos grises distintos, y decir cuál es importa: "no definiste el
  // tramo" lo resuelve el exportador en diez segundos; "sicr3p todavía no
  // incorporó ese cruce" no lo resuelve él, y merece que se lo digamos
  // sin disfrazarlo de tarea suya.
  if (estado?.definido && estado.cruces_pendientes?.length) {
    const cuales = estado.cruces_pendientes.map((c) => c.cruce).join(' y ');
    const faltan = estado.faltantes?.length || 0;
    const suyo = faltan
      ? `Faltan ${faltan} ${faltan === 1 ? 'documento obligatorio' : 'documentos obligatorios'} de los cruces ya definidos. `
      : 'Está todo lo de los cruces ya definidos. ';
    return `${suyo}El cruce ${cuales} todavía no está incorporado en sicr3p: no se te exige nada por ahí, y tampoco se puede dar por completo el tramo.`;
  }
  if (!estado || estado.listo === null) {
    return 'Falta definir el tramo (origen y destino) para saber qué documentos se piden.';
  }
  if (estado.listo) {
    const n = estado.opcionales_faltantes.length;
    return n ? `Con todos los documentos obligatorios del tramo. Quedan ${n} opcionales.` : 'Con todos los documentos del tramo.';
  }
  const n = estado.faltantes.length;
  return `Faltan ${n} ${n === 1 ? 'documento obligatorio' : 'documentos obligatorios'} del tramo.`;
}
