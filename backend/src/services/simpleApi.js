import { config } from '../config.js';
import { query } from '../lib/db.js';

// ============================================================
// Cliente del motor externo "Simple" (invisible para el cliente).
// La SIMPLE_API_KEY solo vive aquí, en el backend.
// Con MOCK_SIMPLE=true genera respuestas simuladas realistas.
// ============================================================

// Factores de referencia (HuellaChile / GHG Protocol) usados por el mock.
// Electricidad SEN 2023: 0,2421 kgCO2e/kWh.
const CATEGORIAS = [
  { key: 'Energía eléctrica', peso: 0.35, min: 0.4, max: 3.2 },
  { key: 'Combustibles', peso: 0.25, min: 0.6, max: 4.5 },
  { key: 'Transporte y logística', peso: 0.15, min: 0.3, max: 2.1 },
  { key: 'Insumos y materiales', peso: 0.15, min: 0.1, max: 1.8 },
  { key: 'Servicios', peso: 0.1, min: 0.05, max: 0.9 },
];

const GLOSAS = {
  'Energía eléctrica': ['Suministro eléctrico SEN', 'Consumo kWh planta', 'Energía activa punta'],
  Combustibles: ['Diésel B5 flota', 'Gasolina 95', 'Gas licuado GLP'],
  'Transporte y logística': ['Flete regional', 'Distribución última milla', 'Courier documentos'],
  'Insumos y materiales': ['Papelería y toner', 'Envases cartón', 'Repuestos menores'],
  Servicios: ['Servicio de aseo', 'Mantención equipos', 'Arriendo maquinaria'],
};

// Genera un número pseudoaleatorio determinista a partir de una semilla (string).
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

// Formatea un RUT chileno de mock con dígito verificador simple.
function mockRut(rand) {
  const cuerpo = 60000000 + Math.floor(rand() * 39000000);
  const dv = (cuerpo % 11);
  const dvChar = dv === 10 ? 'K' : String(dv);
  return `${cuerpo}-${dvChar}`;
}

// ---------- Motor mock: analiza una "factura" ----------
function mockAnalyzeInvoice({ filename, index, rutReceptor }) {
  const rand = seededRandom(`${filename}:${index}`);
  const nItems = 2 + Math.floor(rand() * 4); // 2–5 ítems
  const cat = CATEGORIAS[Math.floor(rand() * CATEGORIAS.length)];

  const items = [];
  let total = 0;
  for (let i = 0; i < nItems; i++) {
    const glosaPool = GLOSAS[cat.key];
    const descripcion = glosaPool[Math.floor(rand() * glosaPool.length)];
    const cantidad = round4(1 + rand() * 40);
    const co2e = round4(cat.min + rand() * (cat.max - cat.min));
    total += co2e;
    items.push({ descripcion, cantidad, co2e });
  }
  total = round4(total);
  for (const it of items) {
    it.porcentaje_total = total > 0 ? round4((it.co2e / total) * 100) : 0;
  }

  const numeroVenta = `V-${100000 + Math.floor(rand() * 899999)}`;
  return {
    invoice_id_simple: `smp_${Math.floor(rand() * 1e9).toString(36)}`,
    numero_venta: numeroVenta,
    rut_emisor: mockRut(rand),
    rut_receptor: rutReceptor || mockRut(rand),
    total_co2e: total,
    categoria: cat.key,
    items,
  };
}

// ---------- Registro de uso en simple_api_uso ----------
// Si se pasa `client` (conexión de transacción en curso), se usa esa misma
// conexión para que el FK a sesiones sea visible; si no, usa el pool.
async function logUso({ sesionId, endpoint, metodo, statusCode, latenciaMs, client }) {
  // Costo estimado de referencia por llamada (mock): 15 CLP.
  const costo = 15;
  const run = client ? client.query.bind(client) : query;
  try {
    await run(
      `INSERT INTO simple_api_uso (sesion_id, endpoint, metodo, status_code, latencia_ms, costo_estimado)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [sesionId || null, endpoint, metodo, statusCode, latenciaMs, costo]
    );
  } catch (e) {
    console.warn('[simple] no se pudo registrar uso:', e.message);
  }
}

// ---------- Llamada real (cuando MOCK_SIMPLE=false) ----------
async function realFetch(pathname, { method = 'GET', body } = {}) {
  const url = `${config.simple.base}${pathname}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${config.simple.key}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Simple API ${res.status} en ${pathname}`);
  return res.json();
}

// ---------- API pública del servicio ----------
export const simpleApi = {
  get mock() {
    return config.simple.mock;
  },

  // GET /ping — estado del motor
  async ping() {
    const t0 = Date.now();
    if (config.simple.mock) {
      const latencia = 20 + Math.floor(Math.random() * 40);
      await logUso({ endpoint: '/ping', metodo: 'GET', statusCode: 200, latenciaMs: latencia });
      return { ok: true, mock: true, latencia_ms: latencia };
    }
    try {
      await realFetch('/ping');
      const latencia = Date.now() - t0;
      await logUso({ endpoint: '/ping', metodo: 'GET', statusCode: 200, latenciaMs: latencia });
      return { ok: true, mock: false, latencia_ms: latencia };
    } catch (e) {
      await logUso({ endpoint: '/ping', metodo: 'GET', statusCode: 503, latenciaMs: Date.now() - t0 });
      return { ok: false, mock: false, error: e.message };
    }
  },

  // Analiza una factura subida y devuelve resultados normalizados.
  async analyzeInvoice({ sesionId, filename, index, rutReceptor, client }) {
    const t0 = Date.now();
    if (config.simple.mock) {
      // Simula latencia de red del motor.
      await new Promise((r) => setTimeout(r, 120 + Math.floor(Math.random() * 220)));
      const result = mockAnalyzeInvoice({ filename, index, rutReceptor });
      await logUso({
        sesionId,
        endpoint: '/invoices',
        metodo: 'POST',
        statusCode: 200,
        latenciaMs: Date.now() - t0,
        client,
      });
      return result;
    }
    // Camino real: POST /invoices + POST /lineitems + GET /analysis/totals.
    const created = await realFetch('/invoices', { method: 'POST', body: { filename } });
    const totals = await realFetch(`/analysis/totals?invoice=${created.id}`);
    await logUso({
      sesionId,
      endpoint: '/invoices',
      metodo: 'POST',
      statusCode: 200,
      latenciaMs: Date.now() - t0,
      client,
    });
    return normalizeReal(created, totals);
  },
};

// Normaliza la respuesta real de Simple al formato interno.
function normalizeReal(created, totals) {
  const items = (totals.line_items || []).map((li) => ({
    descripcion: li.description,
    cantidad: li.quantity ?? 1,
    co2e: round4(li.co2e ?? 0),
    porcentaje_total: round4(li.percent ?? 0),
  }));
  return {
    invoice_id_simple: created.id,
    numero_venta: created.sale_number || created.number,
    rut_emisor: created.issuer_tax_id || null,
    rut_receptor: created.receiver_tax_id || null,
    total_co2e: round4(totals.total_co2e ?? 0),
    categoria: totals.main_category || 'Sin categoría',
    items,
  };
}
