// ============================================================
// Verificador de la API real de itssimple (Simple).
// Ejecutar EN EL VPS (o en una red con acceso a app.itssimple.com), con la
// SIMPLE_API_KEY real en el entorno / backend/.env.
//
//   node scripts/verificar-simple.js
//
// Hace solo lecturas GET (no crea datos). Imprime la forma real de las respuestas
// y contrasta con las claves que espera normalizeReal() para decirte qué ajustar.
// ============================================================
import { config } from '../src/config.js';

const BASE = config.simple.base;
const KEY = config.simple.key;

// Claves que normalizeReal() intenta leer (deben calzar con la respuesta real).
const ESPERA = {
  invoice: {
    id: ['id', 'invoice_id', 'uuid'],
    numero_venta: ['sale_number', 'saleNumber', 'number', 'document_number', 'folio'],
    rut_emisor: ['issuer_tax_id', 'issuerTaxId', 'issuer.tax_id', 'supplier.tax_id', 'rut_emisor'],
    rut_receptor: ['receiver_tax_id', 'receiverTaxId', 'receiver.tax_id', 'customer.tax_id', 'rut_receptor'],
  },
  totals: {
    total_co2e: ['total_co2e', 'totalCo2e', 'co2e', 'total', 'emissions_total'],
    categoria: ['main_category', 'mainCategory', 'category', 'categoria'],
    line_items: ['line_items', 'lineItems', 'items', 'lines'],
  },
  item: {
    descripcion: ['description', 'descripcion', 'name', 'article.name', 'title'],
    cantidad: ['quantity', 'qty', 'cantidad'],
    co2e: ['co2e', 'co2', 'total_co2e', 'emissions', 'kgco2e'],
    porcentaje_total: ['percent', 'percentage', 'share', 'porcentaje_total'],
  },
};

const pick = (obj, keys) => keys.find((k) => k.split('.').reduce((o, p) => (o == null ? o : o[p]), obj) != null);

async function get(pathname) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}${pathname}`, { headers: { Authorization: `Bearer ${KEY}` } });
  const ms = Date.now() - t0;
  let body = null;
  try { body = await res.json(); } catch { body = await res.text().catch(() => null); }
  return { status: res.status, ms, body };
}

function contrasta(nombre, muestra, esperado) {
  console.log(`\n  Contraste de campos (${nombre}):`);
  for (const [campo, variantes] of Object.entries(esperado)) {
    const encontrada = pick(muestra || {}, variantes);
    console.log(`   ${encontrada ? '✓' : '✗'} ${campo.padEnd(16)} → ${encontrada || 'NINGUNA de: ' + variantes.join(', ')}`);
  }
}

async function main() {
  console.log('============================================================');
  console.log('  Verificación de itssimple');
  console.log('  Base:', BASE);
  console.log('  Modo mock:', config.simple.mock, '(debe ser false para verificar en vivo)');
  console.log('  API key presente:', KEY ? 'sí' : 'NO — define SIMPLE_API_KEY');
  console.log('============================================================');
  if (!KEY) { console.log('\n  Falta SIMPLE_API_KEY. Abortando.'); process.exit(1); }

  try {
    const ping = await get('/ping');
    console.log(`\n  GET /ping → HTTP ${ping.status} (${ping.ms} ms)`);
    if (ping.status === 403 || ping.status === 407) {
      console.log('\n  ⚠ HTTP 403/407: la red bloquea app.itssimple.com (egress policy).');
      console.log('  Ejecuta este script EN EL VPS, donde el host sí es alcanzable.\n');
      process.exit(2);
    }

    const articles = await get('/articles');
    console.log(`  GET /articles → HTTP ${articles.status}`);
    if (Array.isArray(articles.body)) console.log(`   ${articles.body.length} artículos; claves del 1º:`, Object.keys(articles.body[0] || {}));

    const invoices = await get('/invoices');
    console.log(`  GET /invoices → HTTP ${invoices.status}`);
    const lista = Array.isArray(invoices.body) ? invoices.body : (invoices.body?.data || invoices.body?.invoices || []);
    console.log(`   ${lista.length} facturas; claves del 1º:`, Object.keys(lista[0] || {}));
    if (lista[0]) contrasta('invoice', lista[0], ESPERA.invoice);

    if (lista[0]?.id) {
      const totals = await get(`/analysis/totals?invoice=${lista[0].id}`);
      console.log(`\n  GET /analysis/totals → HTTP ${totals.status}; claves:`, Object.keys(totals.body || {}));
      contrasta('totals', totals.body, ESPERA.totals);
      const items = totals.body?.line_items || totals.body?.items || totals.body?.lines || [];
      if (items[0]) contrasta('item', items[0], ESPERA.item);
    }

    console.log('\n  Si algún campo salió ✗, ajusta las variantes en normalizeReal()');
    console.log('  (backend/src/services/simpleApi.js) con el nombre real que aparece arriba.\n');
  } catch (e) {
    console.log('\n  ⚠ No se pudo consultar la API:', e.message);
    console.log('  Si es un bloqueo de red/egress (p.ej. este contenedor), ejecuta este');
    console.log('  script EN EL VPS, donde app.itssimple.com sí es alcanzable.\n');
    process.exit(2);
  }
}

main();
