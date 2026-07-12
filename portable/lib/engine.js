// Motor de análisis mock (offline) para la edición portátil.
// Portado de backend/src/services/simpleApi.js — respuestas deterministas y realistas
// (t CO2e por ítem, categoría, % del total). No hace llamadas externas.

const CATEGORIAS = [
  { key: 'Energía eléctrica', min: 0.4, max: 3.2 },
  { key: 'Combustibles', min: 0.6, max: 4.5 },
  { key: 'Transporte y logística', min: 0.3, max: 2.1 },
  { key: 'Insumos y materiales', min: 0.1, max: 1.8 },
  { key: 'Servicios', min: 0.05, max: 0.9 },
];
const GLOSAS = {
  'Energía eléctrica': ['Suministro eléctrico SEN', 'Consumo kWh planta', 'Energía activa punta'],
  Combustibles: ['Diésel B5 flota', 'Gasolina 95', 'Gas licuado GLP'],
  'Transporte y logística': ['Flete regional', 'Distribución última milla', 'Courier documentos'],
  'Insumos y materiales': ['Papelería y toner', 'Envases cartón', 'Repuestos menores'],
  Servicios: ['Servicio de aseo', 'Mantención equipos', 'Arriendo maquinaria'],
};

function seededRandom(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h = (h ^= h >>> 16) >>> 0;
    return h / 4294967296;
  };
}
const round4 = (n) => Math.round(n * 10000) / 10000;

function mockRut(rand) {
  const cuerpo = 60000000 + Math.floor(rand() * 39000000);
  const dv = cuerpo % 11;
  return `${cuerpo}-${dv === 10 ? 'K' : dv}`;
}

// Analiza una factura (por nombre de archivo) de forma determinista.
export function analizar({ filename, index, rutReceptor }) {
  const rand = seededRandom(`${filename}:${index}`);
  const nItems = 2 + Math.floor(rand() * 4);
  const cat = CATEGORIAS[Math.floor(rand() * CATEGORIAS.length)];
  const items = [];
  let total = 0;
  for (let i = 0; i < nItems; i++) {
    const pool = GLOSAS[cat.key];
    const descripcion = pool[Math.floor(rand() * pool.length)];
    const cantidad = round4(1 + rand() * 40);
    const co2e = round4(cat.min + rand() * (cat.max - cat.min));
    total += co2e;
    items.push({ descripcion, cantidad, co2e });
  }
  total = round4(total);
  for (const it of items) it.porcentaje_total = total > 0 ? round4((it.co2e / total) * 100) : 0;

  return {
    numero_venta: `V-${100000 + Math.floor(rand() * 899999)}`,
    rut_emisor: mockRut(rand),
    rut_receptor: rutReceptor || mockRut(rand),
    total_co2e: total,
    categoria: cat.key,
    items,
  };
}
