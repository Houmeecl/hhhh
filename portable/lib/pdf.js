import PDFDocument from 'pdfkit';
import { qrBuffer } from './qr.js';

// ============================================================
// Generación de PDF: informe consolidado "defendible" y etiqueta por factura.
// Marca sicr3p · verde #22c55e · navy #1e2a3a.
// Prohibida la palabra "huella" en todo el texto.
// ============================================================

const GREEN = '#22c55e';
const NAVY = '#1e2a3a';
const GRAY = '#64748b';
const LIGHT = '#f1f5f9';
const BORDER = '#e2e8f0';

const MESES = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];

// Formatea número con locale chileno (coma decimal, punto miles).
function nf(n, dec = 4) {
  const num = Number(n) || 0;
  return num.toLocaleString('es-CL', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fechaCorta(d) {
  const dt = d ? new Date(d) : new Date();
  return `${String(dt.getDate()).padStart(2, '0')}-${MESES[dt.getMonth()]}-${dt.getFullYear()}`;
}

// Dibuja el logotipo "sicr3p" con el punto verde sobre la i.
function drawLogo(doc, x, y, size = 22) {
  doc.font('Helvetica-Bold').fontSize(size).fillColor(NAVY).text('sicr3p', x, y, { lineBreak: false });
  const w = doc.widthOfString('s');
  // punto verde sobre la "i" (segunda letra)
  doc.circle(x + w + size * 0.13, y - size * 0.12, size * 0.09).fill(GREEN);
  doc.fillColor(NAVY);
}

function bufferDoc(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

// Folio del libro mayor: C-AAAA-NNNN a partir del id de sesión.
function folio(sesion) {
  const year = new Date(sesion.fecha || sesion.created_at || Date.now()).getFullYear();
  const seq = String(parseInt((sesion.id || '').replace(/\D/g, '').slice(-4) || '1', 10) % 10000).padStart(4, '0');
  return `C-${year}-${seq}`;
}

// ---------- INFORME CONSOLIDADO ----------
export async function generateReport({ sesion, facturas }) {
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
  const totalCo2e = facturas.reduce((a, f) => a + Number(f.total_co2e || 0), 0);
  const totalItems = facturas.reduce((a, f) => a + (f.items?.length || 0), 0);
  const categorias = [...new Set(facturas.map((f) => f.categoria).filter(Boolean))];

  // --- Encabezado ---
  drawLogo(doc, 48, 44);
  doc.font('Helvetica').fontSize(9).fillColor(GRAY)
    .text('Contabilidad de carbono trazable', 48, 74);
  doc.fontSize(9).fillColor(GRAY)
    .text(`Folio ${folio(sesion)}`, 400, 46, { width: 147, align: 'right' })
    .text(`Emitido: ${fechaCorta(new Date())}`, 400, 60, { width: 147, align: 'right' });

  doc.moveTo(48, 92).lineTo(547, 92).strokeColor(BORDER).stroke();

  // --- Título ---
  doc.font('Helvetica-Bold').fontSize(18).fillColor(NAVY)
    .text('Informe de contabilidad de carbono', 48, 106);
  doc.font('Helvetica').fontSize(10).fillColor(GRAY)
    .text('Tu contabilidad, tu trazabilidad.', 48, 130);

  // --- Datos del cliente ---
  let y = 156;
  doc.roundedRect(48, y, 499, 58, 8).fillAndStroke(LIGHT, BORDER);
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10);
  doc.text('Empresa', 64, y + 12);
  doc.text('RUT', 260, y + 12);
  doc.text('Fecha del período', 400, y + 12);
  doc.font('Helvetica').fontSize(11).fillColor(NAVY);
  doc.text(sesion.nombre_cliente || '—', 64, y + 28, { width: 190 });
  doc.text(sesion.rut_cliente || '—', 260, y + 28, { width: 130 });
  doc.text(fechaCorta(sesion.fecha), 400, y + 28, { width: 130 });

  // --- Tarjetas de resumen ---
  y += 78;
  const cards = [
    { label: 'Total incorporado', value: `${nf(totalCo2e, 4)}`, unit: 't CO2e' },
    { label: 'Facturas', value: String(facturas.length), unit: 'documentos' },
    { label: 'Ítems', value: String(totalItems), unit: 'analizados' },
    { label: 'Categorías', value: String(categorias.length || 1), unit: 'identificadas' },
  ];
  const cw = 118, gap = 9;
  cards.forEach((c, i) => {
    const cx = 48 + i * (cw + gap);
    doc.roundedRect(cx, y, cw, 62, 8).fillAndStroke('#ffffff', BORDER);
    doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(c.label.toUpperCase(), cx + 10, y + 10, { width: cw - 20 });
    doc.font('Helvetica-Bold').fontSize(16).fillColor(GREEN).text(c.value, cx + 10, y + 24, { width: cw - 20 });
    doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(c.unit, cx + 10, y + 46, { width: cw - 20 });
  });

  // --- LIBRO MAYOR DE CARBONO ---
  y += 88;
  doc.font('Helvetica-Bold').fontSize(13).fillColor(NAVY).text('Libro Mayor de Carbono', 48, y);
  doc.font('Courier').fontSize(9).fillColor(GRAY).text(`Folio ${folio(sesion)}`, 400, y + 3, { width: 147, align: 'right' });
  y += 22;

  // Cabecera de columnas (formato libro contable clásico)
  const cols = { fecha: 48, doc: 130, glosa: 250, cargo: 470 };
  doc.rect(48, y, 499, 20).fill(NAVY);
  doc.font('Courier-Bold').fontSize(9).fillColor('#ffffff');
  doc.text('Fecha', cols.fecha + 6, y + 6);
  doc.text('Documento', cols.doc, y + 6);
  doc.text('Glosa', cols.glosa, y + 6);
  doc.text('Cargo (tCO2e)', cols.cargo - 20, y + 6, { width: 97, align: 'right' });
  y += 20;

  // Filas: una línea por ítem, agrupadas por factura.
  doc.font('Courier').fontSize(8.5).fillColor(NAVY);
  let saldo = 0;
  let zebra = false;
  for (const f of facturas) {
    for (const it of f.items || []) {
      if (y > 760) { doc.addPage(); y = 48; }
      saldo += Number(it.co2e || 0);
      if (zebra) { doc.rect(48, y, 499, 16).fill(LIGHT); doc.fillColor(NAVY); }
      zebra = !zebra;
      doc.font('Courier').fontSize(8.5).fillColor(NAVY);
      doc.text(fechaCorta(sesion.fecha), cols.fecha + 6, y + 4, { lineBreak: false });
      doc.text(String(f.numero_venta || '—').slice(0, 16), cols.doc, y + 4, { lineBreak: false });
      doc.text(String(it.descripcion || '').slice(0, 34), cols.glosa, y + 4, { lineBreak: false });
      doc.text(nf(it.co2e, 4), cols.cargo - 20, y + 4, { width: 97, align: 'right' });
      y += 16;
    }
  }

  // Saldo del período
  doc.rect(48, y, 499, 22).fillAndStroke('#ecfdf5', GREEN);
  doc.font('Courier-Bold').fontSize(10).fillColor(NAVY);
  doc.text('SALDO DEL PERÍODO', cols.glosa - 90, y + 6, { lineBreak: false });
  doc.fillColor(GREEN).text(`${nf(saldo, 4)} tCO2e`, cols.cargo - 60, y + 6, { width: 137, align: 'right' });
  y += 34;

  // --- Metodología ---
  if (y > 620) { doc.addPage(); y = 48; }
  doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY).text('Metodología', 48, y);
  y += 18;
  const metod = [
    'Marco de referencia: GHG Protocol (Scope 3 — emisiones indirectas de la cadena de valor) e ISO 14064-1.',
    'Factores de emisión: HuellaChile (Ministerio del Medio Ambiente). Electricidad — Sistema Eléctrico Nacional (SEN) 2023: 0,2421 kgCO2e/kWh.',
    'Jerarquía de calidad del dato (4 niveles): (1) dato primario medido; (2) dato del proveedor; (3) factor nacional/sectorial; (4) factor por defecto / proxy.',
    'La asignación por ítem se realiza a partir del documento tributario cargado y su glosa, clasificada por categoría de actividad.',
  ];
  doc.font('Helvetica').fontSize(9).fillColor(GRAY);
  for (const m of metod) {
    doc.text('•  ' + m, 48, y, { width: 499 });
    y = doc.y + 6;
  }

  // --- Disclaimer ---
  y += 6;
  doc.roundedRect(48, y, 499, 40, 6).fillAndStroke('#fffbeb', '#fde68a');
  doc.font('Helvetica-Oblique').fontSize(9).fillColor('#92400e')
    .text('Este informe no constituye una verificación de tercera parte acreditada.', 60, y + 8, { width: 475 });
  doc.font('Helvetica').fontSize(8).fillColor(GRAY)
    .text('Documento generado por sicr3p como contabilidad de carbono trazable, base para su gestión y decisiones.', 60, y + 24, { width: 475 });

  // --- Pie de página en todas las páginas ---
  // Se anula el margen inferior temporalmente para poder escribir en el pie
  // sin que PDFKit agregue páginas en blanco por desbordar el margen.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const oldBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(8).fillColor(GRAY)
      .text(`sicr3p · Contabilidad de carbono trazable · Folio ${folio(sesion)}`, 48, 808, { width: 400, lineBreak: false });
    doc.text(`Página ${i + 1} de ${range.count}`, 400, 808, { width: 147, align: 'right', lineBreak: false });
    doc.page.margins.bottom = oldBottom;
  }

  return bufferDoc(doc);
}

// ---------- ETIQUETA POR FACTURA (con QR) ----------
export async function generateLabel({ sesion, factura, baseUrl }) {
  // Etiqueta compacta tipo tarjeta (media carta apaisada).
  const doc = new PDFDocument({ size: [420, 260], margin: 0 });
  const qr = await qrBuffer(baseUrl, factura.id);

  // Fondo
  doc.rect(0, 0, 420, 260).fill('#ffffff');
  doc.roundedRect(8, 8, 404, 244, 12).lineWidth(1.5).stroke(BORDER);

  // Encabezado con logo
  drawLogo(doc, 24, 24, 20);
  doc.font('Helvetica').fontSize(7.5).fillColor(GRAY)
    .text('Contabilidad Trazabilidad. Controla. Traza. Decide.', 24, 50, { width: 250 });

  // Datos
  let y = 78;
  const row = (label, value) => {
    doc.font('Helvetica').fontSize(7.5).fillColor(GRAY).text(label.toUpperCase(), 24, y);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text(value || '—', 24, y + 10, { width: 230 });
    y += 30;
  };
  row('N° de venta', factura.numero_venta);
  row('Cliente', sesion.nombre_cliente);
  row('Fecha', fechaCorta(sesion.fecha));

  // QR
  doc.image(qr, 290, 70, { width: 110, height: 110 });
  doc.font('Helvetica').fontSize(6.5).fillColor(GRAY)
    .text('Verifica la trazabilidad', 290, 184, { width: 110, align: 'center' });

  // Bloque verde: resultado incorporado
  const nItems = factura.items?.length || 0;
  doc.roundedRect(24, 196, 372, 44, 8).fill('#ecfdf5');
  doc.roundedRect(24, 196, 372, 44, 8).lineWidth(1).stroke(GREEN);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(GREEN).text('RESULTADO INCORPORADO', 36, 206);
  doc.font('Helvetica-Bold').fontSize(14).fillColor(NAVY)
    .text(`${nf(factura.total_co2e, 3)} t CO2e`, 36, 218, { lineBreak: false });
  doc.font('Helvetica').fontSize(8.5).fillColor(GRAY)
    .text(`·  ${factura.categoria || 'Sin categoría'}  ·  ${nItems} ítems`, 150, 222, { width: 240 });

  return bufferDoc(doc);
}
