import PDFDocument from 'pdfkit';

// ============================================================
// Comprobante de transporte para email al cliente/empresa — PDF
// con detalles del viaje + CO2e calculado + información de la
// empresa proveedora.
// ============================================================

const GREEN = '#28a745';
const NAVY = '#0f1f2e';
const GRAY = '#64748b';
const LIGHT = '#f1f5f9';
const BORDER = '#e6e9ed';

function nf(n, dec = 2) {
  const num = Number(n) || 0;
  return num.toLocaleString('es-CL', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function formatearRut(rut) {
  if (!rut) return '';
  const s = String(rut).replace(/\D/g, '');
  if (s.length < 2) return rut;
  return `${s.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${s.slice(-1)}`;
}

function fechaCorta(d) {
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${d.getDate()} ${meses[d.getMonth()]} ${d.getFullYear()}`;
}

function bufferDoc(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

// Genera PDF de comprobante de viaje en transporte (bus, camioneta, etc.)
// con detalles del viaje, CO2e y datos de la empresa proveedora.
export async function generateComprobanteTransporte({
  viaje,
  empresa,
  modoNombre,
}) {
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
  const M = 48;
  const W = doc.page.width - M * 2;

  // Encabezado
  doc.font('Helvetica').fontSize(9).fillColor(GRAY)
    .text(`Emitido el ${fechaCorta(new Date())}`, M, 50, { width: W, align: 'right' });

  doc.font('Helvetica-Bold').fontSize(16).fillColor(NAVY)
    .text('Comprobante de Transporte', M, 96, { width: W });
  doc.font('Helvetica').fontSize(10.5).fillColor(GRAY)
    .text('Registro de traslado de personal · Alcance 3, Categoría 7 (GHG Protocol)', M, doc.y + 4, { width: W });

  // Datos de la empresa
  let y = 148;
  doc.roundedRect(M, y, W, 46, 8).fillAndStroke(LIGHT, BORDER);
  doc.font('Helvetica').fontSize(9).fillColor(GRAY).text('EMPRESA PROVEEDORA', M + 16, y + 10);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY)
    .text(`${empresa?.nombre_empresa || ''}  ·  ${formatearRut(empresa?.rut)}`, M + 16, y + 23);

  // Recuadro principal con CO2e
  y = 216;
  doc.roundedRect(M, y, W, 60, 8).fillAndStroke('#f0fdfa', '#14b8a6');
  doc.font('Helvetica-Bold').fontSize(18).fillColor(NAVY).text(`${nf(viaje.co2e, 3)} tCO2e`, M + 16, y + 10);
  doc.font('Helvetica').fontSize(9).fillColor(GRAY).text(
    'Emisiones calculadas para este traslado',
    M + 16, y + 36, { width: W - 32 }
  );
  y += 76;

  // Detalles del viaje
  y += 12;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY)
    .text('Detalles del traslado', M, y, { width: W });
  y += 18;

  const detallesFila = (label, value) => {
    doc.font('Helvetica').fontSize(9).fillColor(GRAY).text(label, M, y);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY)
      .text(String(value || '—'), M + 200, y);
    y += 16;
  };

  detallesFila('Modo de transporte:', modoNombre || viaje.modo);
  detallesFila('Fecha:', viaje.fecha || '—');
  detallesFila('Origen:', viaje.origen);
  detallesFila('Destino:', viaje.destino);
  detallesFila('Distancia:', `${nf(viaje.km, 1)} km${viaje.ida_vuelta ? ' (ida y vuelta)' : ''}`);
  detallesFila('Pasajeros:', `${viaje.pasajeros}`);
  if (viaje.notas) {
    y += 4;
    detallesFila('Notas:', viaje.notas);
  }

  // Metodología
  if (y > doc.page.height - 150) { doc.addPage(); y = 60; }
  y += 6;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY)
    .text('Metodología', M, y, { width: W });
  y += 14;
  doc.font('Helvetica').fontSize(8).fillColor(GRAY);
  const metodologia = [
    'Las emisiones se calculan multiplicando la distancia por el número de pasajeros por el factor de emisión del modo de transporte.',
    'Factores utilizados: sicr3p aplica factores referenciales validados según GHG Protocol (HuellaChile, DEFRA).',
    'Este documento NO constituye una verificación de tercera parte acreditada (ISO 14064-3).',
  ];
  for (const linea of metodologia) {
    if (y > doc.page.height - 80) { doc.addPage(); y = 60; }
    doc.text(`• ${linea}`, M, y, { width: W });
    y = doc.y + 6;
  }

  return bufferDoc(doc);
}
