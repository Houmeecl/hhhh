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

// Destino de una instrucción de la torre → punto del catálogo.
export const DESTINO_A_PUNTO = {
  puerto_seco: 'puerto-seco',
  puerto: 'puerto-antofagasta',
};

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
