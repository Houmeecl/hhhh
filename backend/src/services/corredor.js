// ============================================================
// Corredor Bioceánico — funciones PURAS.
//
// Sin base de datos. El Corredor vive en `sicr3p_corredor`, que es otra
// base (ver lib/dbCorredor.js), pero lo que se decide acá no depende de
// ninguna de las dos: se decide con los datos que llegan.
//
// LO QUE ESTE ARCHIVO DEFIENDE, en orden de importancia:
//
//  1. EL NIVEL DE CONFIANZA DE UNA PARCELA SE CALCULA, NO SE RECIBE. Si
//     el nivel viajara en el body, cualquiera se declararía en el más alto
//     con un curl y la escalera entera dejaría de significar algo. Es la
//     misma regla que gobierna `nivelConfianza()` del expediente de
//     evidencia, y por el mismo motivo.
//
//  2. EL DESACUERDO SE REGISTRA, NO SE CORRIGE. Si el área que sale del
//     polígono no calza con la declarada, no se pisa ninguna de las dos:
//     se deja constancia. Igual que `verificarConsistencia()` entre una
//     factura y su guía, y que `balanceMasas` con la merma.
//
//  3. MEDIA COORDENADA NO UBICA NADA. Un par incompleto, fuera de rango o
//     con un `null` que se coerce a 0 no es una ubicación declarada.
// ============================================================

// El código de una carga del Corredor. NO 'LM' (Lote Mineral), que es
// como salía una carga de soya de Brasil cuando los tres tipos compartían
// tabla.
export function generarCodigoCarga(anio, correlativo) {
  return `CB-${anio}-${String(correlativo).padStart(6, '0')}`;
}

export const RE_CODIGO_CARGA = /^CB-\d{4}-\d{6}$/;

// Umbral del EUDR: sobre 4 ha ya no basta un punto, se exige el perímetro.
export const EXIGE_POLIGONO_HA = 4;

export const ORIGENES_COORDENADA = ['archivo', 'registro', 'mapa'];

// Cuánto puede diferir el área que sale del polígono de la que declaró el
// productor antes de considerarlo un desacuerdo. 5%, igual que
// TOLERANCIA_MERMA_PCT: los polígonos catastrales y las superficies
// declaradas casi nunca coinciden al decimal —distintos levantamientos,
// distintas épocas— y llamar "desacuerdo" a un 0,3% sería ruido que
// entrena a ignorar la alerta.
export const TOLERANCIA_AREA_PCT = 5;

const RADIO_TIERRA_M = 6378137;
const gr = (x) => (x * Math.PI) / 180;

// Una coordenada declarada, o nada.
//
// El `== null` de la primera línea no es defensivo de más: `Number(null)`
// devuelve 0 y `Number.isFinite(0)` es true, así que una parcela con la
// longitud en null pasaría como ubicada **en el meridiano de Greenwich** —
// una coordenada perfectamente válida, en medio del Atlántico, para un
// predio de soya en Mato Grosso. Lo mismo con `''` y con los booleanos.
export function coordenadaValida(v, max) {
  if (v == null || v === '' || typeof v === 'boolean') return false;
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= max;
}

export const latValida = (v) => coordenadaValida(v, 90);
export const lngValida = (v) => coordenadaValida(v, 180);

// ---------- Polígonos ----------

// Extrae el anillo exterior de un GeoJSON, venga como venga: los archivos
// de catastro llegan como Feature, FeatureCollection, Polygon o el anillo
// pelado, y rechazar los tres primeros obligaría al productor a editar a
// mano un archivo que ya tenía bien.
export function anilloDe(geo) {
  if (!geo) return null;
  if (Array.isArray(geo)) return geo;
  const g = geo.type === 'Feature' ? geo.geometry
    : geo.type === 'FeatureCollection' ? geo.features?.[0]?.geometry
      : geo;
  if (!g) return null;
  if (g.type === 'Polygon') return g.coordinates?.[0] ?? null;
  // De un MultiPolygon se toma el primer polígono: un predio con varios
  // retazos existe, pero tratarlos como uno solo mezclaría superficies que
  // el reglamento pide declarar por separado. Se toma el primero y el
  // resto se declara aparte.
  if (g.type === 'MultiPolygon') return g.coordinates?.[0]?.[0] ?? null;
  return null;
}

// ¿Es un anillo utilizable? Al menos tres vértices distintos, todos con
// coordenadas válidas. GeoJSON usa [lng, lat] — al revés de como se
// escriben normalmente, y confundirlo pone un predio brasileño en Asia.
export function validarPoligono(geo) {
  const anillo = anilloDe(geo);
  if (!Array.isArray(anillo) || anillo.length < 4) {
    return { ok: false, error: 'El polígono necesita al menos tres vértices y cerrar sobre el primero.' };
  }
  for (const punto of anillo) {
    if (!Array.isArray(punto) || punto.length < 2) {
      return { ok: false, error: 'Hay un vértice sin par de coordenadas.' };
    }
    if (!lngValida(punto[0]) || !latValida(punto[1])) {
      return { ok: false, error: 'Hay un vértice con coordenadas fuera de rango. GeoJSON usa [longitud, latitud].' };
    }
  }
  const [pl, pa] = anillo[0];
  const [ul, ua] = anillo[anillo.length - 1];
  if (Number(pl) !== Number(ul) || Number(pa) !== Number(ua)) {
    return { ok: false, error: 'El polígono no cierra: el último vértice tiene que ser igual al primero.' };
  }
  return { ok: true, anillo };
}

// Superficie en hectáreas, por exceso esférico. No se proyecta a un plano:
// un predio de varios kilómetros en latitudes altas acumula error
// suficiente como para que el contraste contra el área declarada deje de
// significar algo, que es justo para lo que sirve este número.
export function areaHa(geo) {
  const v = validarPoligono(geo);
  if (!v.ok) return null;
  const anillo = v.anillo;
  let suma = 0;
  for (let i = 0; i < anillo.length - 1; i++) {
    const [lng1, lat1] = anillo[i].map(Number);
    const [lng2, lat2] = anillo[i + 1].map(Number);
    suma += gr(lng2 - lng1) * (2 + Math.sin(gr(lat1)) + Math.sin(gr(lat2)));
  }
  const m2 = Math.abs((suma * RADIO_TIERRA_M * RADIO_TIERRA_M) / 2);
  return Math.round((m2 / 10000) * 10000) / 10000;
}

// El área del polígono contra la que declaró el productor.
//
// Devuelve `calza: null` —no false— cuando falta alguna de las dos. No
// tener con qué comparar no es un desacuerdo: es el gris de
// `semaforoDocumental` y la cobertura null del expediente. Decir que no
// calza exige tener las dos cifras.
export function contrastarArea(areaDeclaradaHa, geo) {
  const calculada = areaHa(geo);
  const declarada = areaDeclaradaHa == null ? null : Number(areaDeclaradaHa);
  if (calculada == null || declarada == null || !Number.isFinite(declarada) || declarada <= 0) {
    return { calza: null, calculada_ha: calculada, declarada_ha: declarada, diferencia_pct: null };
  }
  const dif = Math.abs(calculada - declarada) / declarada * 100;
  const diferencia_pct = Math.round(dif * 100) / 100;
  return {
    calza: diferencia_pct <= TOLERANCIA_AREA_PCT,
    calculada_ha: calculada,
    declarada_ha: declarada,
    diferencia_pct,
  };
}

// Un punto representativo de la parcela: el que tiene declarado, o el
// centroide de su polígono.
//
// Existe porque una parcela sobre 4 ha se declara SOLO con polígono —es lo
// que exige el EUDR— y sin esto quedaba reportada como "sin
// geolocalización", que es exactamente al revés: el polígono es la forma
// más exigente de geolocalizar, no la ausencia de una.
//
// Centroide del anillo por promedio de vértices. No es el centroide de
// área (que para un polígono muy irregular cae en otro lugar), y no hace
// falta que lo sea: esto no reemplaza al polígono en ninguna declaración,
// solo responde "¿esta parcela está ubicada?" y sirve para centrar un mapa.
export function puntoDe(p) {
  if (latValida(p?.lat) && lngValida(p?.lng)) {
    return { lat: Number(p.lat), lng: Number(p.lng) };
  }
  const v = validarPoligono(p?.poligono);
  if (!v.ok) return null;
  // El último vértice repite el primero: se excluye para no pesarlo doble.
  const vertices = v.anillo.slice(0, -1);
  if (!vertices.length) return null;
  const suma = vertices.reduce((a, [lng, lat]) => ({ lng: a.lng + Number(lng), lat: a.lat + Number(lat) }), { lng: 0, lat: 0 });
  return {
    lat: Math.round((suma.lat / vertices.length) * 1e6) / 1e6,
    lng: Math.round((suma.lng / vertices.length) * 1e6) / 1e6,
  };
}

// ---------- Validación de una parcela ----------

export function validarParcela(p) {
  if (!p || typeof p !== 'object') return { ok: false, error: 'Falta la parcela.' };
  if (!String(p.nombre || '').trim()) return { ok: false, error: 'La parcela necesita un nombre para poder reconocerla.' };
  if (!/^[A-Z]{2}$/.test(String(p.pais || '').toUpperCase())) {
    return { ok: false, error: 'El país de la parcela va en ISO-2 (BR, PY, AR, CL).' };
  }
  if (p.origen_coordenada && !ORIGENES_COORDENADA.includes(p.origen_coordenada)) {
    // 'gps' y 'perimetro' no están en la lista a propósito: mandar a
    // alguien a recorrer un predio en zona de frontera es el riesgo que
    // este producto no corre.
    return { ok: false, error: `Origen de la coordenada no válido. Usa: ${ORIGENES_COORDENADA.join(', ')}.` };
  }

  const area = p.area_ha == null ? null : Number(p.area_ha);
  if (area != null && (!Number.isFinite(area) || area <= 0)) {
    return { ok: false, error: 'La superficie declarada tiene que ser un número mayor que 0.' };
  }

  const tienePunto = latValida(p.lat) && lngValida(p.lng);
  const poli = p.poligono ? validarPoligono(p.poligono) : null;
  if (p.poligono && !poli.ok) return { ok: false, error: poli.error };

  if (!tienePunto && !poli?.ok) {
    return { ok: false, error: 'La parcela necesita coordenadas: un punto, o un polígono.' };
  }

  // Sobre 4 ha el EUDR exige el perímetro. Aceptar un punto acá sería
  // dejar pasar una parcela que la autoridad va a rechazar, y descubrirlo
  // en la declaración es demasiado tarde.
  if (area != null && area > EXIGE_POLIGONO_HA && !poli?.ok) {
    return {
      ok: false,
      error: `Sobre ${EXIGE_POLIGONO_HA} ha el EUDR exige el polígono del predio, no basta un punto.`,
    };
  }
  return { ok: true };
}

// ---------- El nivel de confianza ----------

// LO CALCULA EL SERVIDOR. Nunca se recibe del cliente: si viajara en el
// body, cualquiera se pondría en 4 y la escalera dejaría de significar
// algo. El 5 (revisión externa) no existe acá — necesitaría un rol de
// auditor que no hay, y emitirlo sería declarar una revisión que nadie
// hizo. Misma regla que en el expediente de evidencia.
export const NOMBRE_NIVEL_PARCELA = {
  1: 'Declarado',
  2: 'Documentado',
  3: 'Consistente',
  4: 'Validado en fuente',
};

export function nivelConfianzaParcela(p) {
  const origen = p?.origen_coordenada || 'mapa';

  // Dibujado a mano en un mapa: lo declara quien dibuja y nadie lo mide.
  if (origen === 'mapa') return 1;

  const validado = Boolean(p?.validado_por && p?.validado_fuente && p?.validado_at);

  // Contrastado contra el registro público, con quién, contra qué y
  // cuándo. Los tres, o no es nivel 4 — el CHECK de la migración dice lo
  // mismo a nivel de esquema.
  if (origen === 'registro' && validado) return 4;

  // Archivo del catastro o del SIG del productor: hay un instrumento
  // detrás. Sube a 3 solo si el área calculada calza con la declarada —
  // ahí hay dos fuentes diciendo lo mismo, que es lo que significa
  // "consistente". Sin área declarada no se puede contrastar, y no
  // contrastar no es contradecirse: se queda en 2.
  const { calza } = contrastarArea(p?.area_ha, p?.poligono);
  return calza === true ? 3 : 2;
}

// Todo junto, para la ruta y la pantalla.
export function resumenParcela(p) {
  const contraste = contrastarArea(p?.area_ha, p?.poligono);
  const nivel = nivelConfianzaParcela(p);
  return {
    nivel_confianza: nivel,
    nombre_nivel: NOMBRE_NIVEL_PARCELA[nivel],
    exige_poligono: p?.area_ha != null && Number(p.area_ha) > EXIGE_POLIGONO_HA,
    area: contraste,
    // El desacuerdo se registra, no se corrige: ninguna de las dos cifras
    // se pisa, y la diferencia queda a la vista.
    desacuerdo_area: contraste.calza === false
      ? `El polígono da ${contraste.calculada_ha} ha y se declararon ${contraste.declarada_ha} ha (${contraste.diferencia_pct}% de diferencia).`
      : null,
  };
}
