// ============================================================
// Catálogo de puntos de control del Corredor Bioceánico de Capricornio
// (Campo Grande → puertos de la Región de Antofagasta).
//
// Coordenadas REFERENCIALES (aprox. al centro de la localidad): sirven
// para ubicar el paso en el mapa de la torre de control, no son
// posiciones GPS — la plataforma no rastrea: el camión "está" en el
// último punto de control cuyo paso quedó sellado en la cadena.
//
// El id (slug) se guarda en datos.punto_id del eslabón; el backend solo
// lo sanea. Si un paso llega con texto libre, puntoDe() intenta calzar
// el nombre normalizado; si no calza, el paso vale igual (queda en la
// línea de tiempo) pero no mueve el camión.
// ============================================================

export const PUNTOS_CORREDOR = [
  { id: 'campo-grande', nombre: 'Campo Grande', pais: 'BR', lat: -20.4697, lng: -54.6201 },
  { id: 'ponta-pora', nombre: 'Ponta Porã (frontera BR/PY)', pais: 'BR', lat: -22.5361, lng: -55.7256 },
  { id: 'loma-plata', nombre: 'Loma Plata', pais: 'PY', lat: -22.3833, lng: -59.85 },
  { id: 'mariscal-estigarribia', nombre: 'Mariscal Estigarribia', pais: 'PY', lat: -22.0333, lng: -60.6167 },
  { id: 'pozo-hondo', nombre: 'Pozo Hondo (frontera PY/AR)', pais: 'PY', lat: -22.2833, lng: -62.8667 },
  { id: 'tartagal', nombre: 'Tartagal', pais: 'AR', lat: -22.5164, lng: -63.8069 },
  { id: 'jujuy', nombre: 'San Salvador de Jujuy', pais: 'AR', lat: -24.1858, lng: -65.2995 },
  { id: 'susques', nombre: 'Susques', pais: 'AR', lat: -23.4167, lng: -66.3667 },
  { id: 'paso-de-jama', nombre: 'Paso de Jama (frontera AR/CL)', pais: 'AR', lat: -23.2358, lng: -67.0333 },
  { id: 'san-pedro-de-atacama', nombre: 'San Pedro de Atacama', pais: 'CL', lat: -22.9098, lng: -68.1997 },
  { id: 'calama', nombre: 'Calama', pais: 'CL', lat: -22.4544, lng: -68.9294 },
  { id: 'puerto-seco', nombre: 'Puerto seco (La Negra, interior)', pais: 'CL', lat: -23.766, lng: -70.323 },
  { id: 'puerto-antofagasta', nombre: 'Puerto Antofagasta', pais: 'CL', lat: -23.648, lng: -70.4046 },
  { id: 'puerto-mejillones', nombre: 'Puerto Mejillones', pais: 'CL', lat: -23.0959, lng: -70.4519 },
];

// Los 3 pasos fronterizos que cruza el Corredor Bioceánico — mismo
// catálogo que PUNTOS_FRONTERA en backend/src/services/pasaporteOrigen.js.
// A diferencia de 'estacionamiento' (zona = texto libre), para
// 'frontera' la zona ES uno de estos 3 ids (ya existentes en
// PUNTOS_CORREDOR arriba).
export const PUNTOS_FRONTERA = ['ponta-pora', 'pozo-hondo', 'paso-de-jama'];

// Destino de una instrucción de la torre → punto del catálogo.
// 'estacionamiento' no tiene punto fijo: la zona la designa la torre
// como texto (ej. "Zona E-3, La Negra") y no se dibuja línea. 'frontera'
// tampoco tiene un punto único fijo: el punto lo da la propia zona (uno
// de los 3 pasos) — ver puntoDestinoDe() más abajo.
export const DESTINO_A_PUNTO = {
  puerto_seco: 'puerto-seco',
  puerto: 'puerto-antofagasta',
};

// Clave i18n de la etiqueta de un destino de torre.
export const CLAVE_DESTINO = {
  puerto_seco: 'torre.puerto_seco',
  puerto: 'torre.puerto',
  estacionamiento: 'torre.estacionamiento',
  frontera: 'torre.frontera',
};

// Resuelve a qué punto del catálogo apunta una instrucción de la torre —
// fijo para puerto_seco/puerto, dinámico (por zona) para frontera, sin
// punto para estacionamiento (zona es texto libre).
export function puntoDestinoDe(m) {
  if (!m) return null;
  if (m.destino === 'frontera' && m.zona) return porId.get(m.zona) || null;
  const id = DESTINO_A_PUNTO[m.destino];
  return id ? porId.get(id) || null : null;
}

// Etiqueta completa de una instrucción: "PUERTO SECO" / "ESTACIONAMIENTO · Zona E-3"
// / "FRONTERA · Paso de Jama (frontera AR/CL)".
export function etiquetaInstruccion(m, t) {
  if (!m) return '';
  const base = t(CLAVE_DESTINO[m.destino] || m.destino);
  if (m.destino === 'frontera' && m.zona) {
    const punto = porId.get(m.zona);
    return `${base} · ${punto?.nombre || m.zona}`;
  }
  return m.zona ? `${base} · ${m.zona}` : base;
}

const porId = new Map(PUNTOS_CORREDOR.map((p) => [p.id, p]));

// Normaliza texto libre a slug comparable ("Paso de Jama " → "paso-de-jama").
export function normalizarPunto(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const porNombre = new Map(PUNTOS_CORREDOR.map((p) => [normalizarPunto(p.nombre), p]));

// Ubica el punto del catálogo de un eslabón: primero por datos.punto_id,
// después por el nombre normalizado de datos.punto_control. null = no
// reconocido (el paso existe igual; solo no se dibuja en el mapa).
export function puntoDe(eslabon) {
  const d = eslabon?.datos || {};
  if (d.punto_id && porId.has(d.punto_id)) return porId.get(d.punto_id);
  const n = normalizarPunto(d.punto_control);
  if (!n) return null;
  if (porId.has(n)) return porId.get(n);
  if (porNombre.has(n)) return porNombre.get(n);
  // Último intento: el texto contiene el nombre de un punto ("Báscula Calama").
  for (const p of PUNTOS_CORREDOR) {
    if (n.includes(p.id)) return p;
  }
  return null;
}

// ============================================================
// Torre de control — alertas operativas (puramente informativas: nunca
// bloquean el registro de un paso, solo llaman la atención del operador).
// ============================================================

const indicePorId = new Map(PUNTOS_CORREDOR.map((p, i) => [p.id, i]));

// Umbrales de "sin avance" en horas. El corredor no tiene horario fijo
// (depende de fronteras, clima, descansos del conductor), así que son
// heurísticas blandas — un color de aviso, no una infracción — calibradas
// sobre el tramo más largo típico entre dos puntos consecutivos del
// catálogo (Mariscal Estigarribia↔Pozo Hondo, Chaco paraguayo).
export const HORAS_ALERTA_AMBAR = 12;
export const HORAS_ALERTA_ROJA = 24;

// Horas transcurridas desde el último paso sellado hasta ahora (`ahoraMs`
// inyectable para tests). null si aún no hay paso.
export function horasSinAvance(isoCreado, ahoraMs = Date.now()) {
  if (!isoCreado) return null;
  const ms = ahoraMs - new Date(isoCreado).getTime();
  return ms >= 0 ? ms / 3_600_000 : 0;
}

// Estado visual a partir de las horas sin avance: null (sin paso aún),
// 'ok', 'ambar' o 'rojo'.
export function estadoAvance(horas) {
  if (horas == null) return null;
  if (horas >= HORAS_ALERTA_ROJA) return 'rojo';
  if (horas >= HORAS_ALERTA_AMBAR) return 'ambar';
  return 'ok';
}

// Texto corto de una duración en horas ("3h", "2d"): abreviatura de
// magnitud, no de idioma (igual en es/en/pt en un panel de logística),
// así que no pasa por el diccionario i18n.
export function textoDuracion(horas) {
  if (horas == null) return '';
  return horas < 48 ? `${Math.round(horas)}h` : `${Math.round(horas / 24)}d`;
}

// Detecta pasos que RETROCEDEN en el catálogo del corredor: dado un
// arreglo de eslabones YA ordenado ascendente por número de eslabón,
// devuelve el Set de números de eslabón cuyo punto tiene un índice menor
// al máximo índice ya alcanzado por un paso anterior. Es una señal de
// posible error de tipeo o de un paso registrado en el orden equivocado
// — el timeline lo marca, no lo rechaza (el punto pudo ser un desvío
// real, y castigar con un rechazo penalizaría al conductor por algo que
// no eligió el sistema).
// Los eslabones sin punto reconocible (puntoDe = null) no cuentan ni
// rompen la secuencia: simplemente se ignoran.
export function pasosRetrocedidos(eslabonesOrdenados) {
  const retrocedidos = new Set();
  let maxIndice = -1;
  for (const e of eslabonesOrdenados || []) {
    const p = puntoDe(e);
    if (!p) continue;
    const i = indicePorId.get(p.id);
    if (i < maxIndice) retrocedidos.add(e.eslabon);
    else maxIndice = i;
  }
  return retrocedidos;
}
