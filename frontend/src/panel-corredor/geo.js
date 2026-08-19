// ============================================================
// Leer el polígono de un predio desde el archivo del catastro.
//
// Es la vía PRINCIPAL de captura, y no por comodidad: se descartó tomar
// coordenadas con GPS en terreno porque la carga cruza cuatro países y
// mandar a alguien a recorrer un predio en zona de frontera es un riesgo
// que este producto no corre. Ver docs/CORREDOR-PLAN.md §4.0.
//
// Además el archivo es MEJOR dato: el polígono ya existe, ya lo declaró
// su dueño ante una autoridad —el CAR brasileño tiene el de cada predio
// rural— y es más preciso que cualquier recorrido con un teléfono.
//
// Acá solo se LEE y se normaliza a GeoJSON. Quien decide si el polígono
// sirve es el backend (services/corredor.js), que es el mismo que decide
// el nivel de confianza. Validar en el cliente y no en el servidor sería
// dejar la puerta abierta a un curl.
// ============================================================

// GeoJSON puede venir como Feature, FeatureCollection, Polygon o
// MultiPolygon. El catastro exporta cualquiera de los cuatro, así que
// rechazar tres obligaría a la persona a editar a mano un archivo que ya
// tenía bien.
export function normalizarGeoJson(texto) {
  let json;
  try { json = JSON.parse(texto); } catch { return { ok: false, error: 'El archivo no es un GeoJSON válido.' }; }

  const geo = json.type === 'Feature' ? json.geometry
    : json.type === 'FeatureCollection' ? json.features?.[0]?.geometry
      : json;
  if (!geo?.type) return { ok: false, error: 'El archivo no contiene una geometría.' };

  if (geo.type === 'Polygon') return { ok: true, poligono: geo, aviso: null };
  if (geo.type === 'MultiPolygon') {
    return {
      ok: true,
      poligono: { type: 'Polygon', coordinates: geo.coordinates[0] },
      // No se mezclan en un solo polígono: el reglamento pide declarar
      // cada predio por separado, y unirlos sumaría superficies que la
      // autoridad va a querer ver desagregadas.
      aviso: geo.coordinates.length > 1
        ? `El archivo trae ${geo.coordinates.length} predios. Se cargó el primero; los demás se declaran como parcelas aparte.`
        : null,
    };
  }
  return { ok: false, error: `La geometría es de tipo ${geo.type}; se necesita un polígono.` };
}

// KML: lo que exportan Google Earth y buena parte de los SIG. El formato
// de <coordinates> es "lng,lat,alt" separado por espacios o saltos de
// línea — con la altitud opcional, y con el orden al revés de como se
// escribe una coordenada normalmente.
export function kmlAGeoJson(texto) {
  const bloques = [...String(texto).matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/gi)];
  if (!bloques.length) return { ok: false, error: 'El archivo KML no tiene coordenadas.' };

  const anillo = bloques[0][1].trim().split(/\s+/).map((par) => {
    const [lng, lat] = par.split(',').map(Number);
    return [lng, lat];
  }).filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));

  if (anillo.length < 3) return { ok: false, error: 'El KML no trae suficientes vértices para un polígono.' };

  // KML no siempre cierra el anillo; GeoJSON lo exige. Cerrarlo acá evita
  // rechazar un archivo que el SIG considera perfectamente válido.
  const [pl, pa] = anillo[0];
  const [ul, ua] = anillo[anillo.length - 1];
  if (pl !== ul || pa !== ua) anillo.push([pl, pa]);

  return {
    ok: true,
    poligono: { type: 'Polygon', coordinates: [anillo] },
    aviso: bloques.length > 1
      ? `El archivo trae ${bloques.length} geometrías. Se cargó la primera.`
      : null,
  };
}

export function leerArchivoDePredio(nombre, texto) {
  const esKml = /\.kml$/i.test(nombre) || /<kml[\s>]/i.test(texto);
  return esKml ? kmlAGeoJson(texto) : normalizarGeoJson(texto);
}

// Superficie en hectáreas, para mostrarla al momento de cargar el archivo
// y que la persona vea si calza con lo que declaró ANTES de guardar.
// Misma fórmula que el backend (services/corredor.js): exceso esférico,
// sin proyectar a un plano.
const R = 6378137;
const gr = (x) => (x * Math.PI) / 180;

export function areaHa(poligono) {
  const anillo = poligono?.coordinates?.[0];
  if (!Array.isArray(anillo) || anillo.length < 4) return null;
  let suma = 0;
  for (let i = 0; i < anillo.length - 1; i++) {
    const [lng1, lat1] = anillo[i].map(Number);
    const [lng2, lat2] = anillo[i + 1].map(Number);
    suma += gr(lng2 - lng1) * (2 + Math.sin(gr(lat1)) + Math.sin(gr(lat2)));
  }
  return Math.round(Math.abs((suma * R * R) / 2) / 10000 * 10000) / 10000;
}
