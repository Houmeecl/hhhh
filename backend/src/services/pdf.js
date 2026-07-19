import PDFDocument from 'pdfkit';
import { qrBuffer } from './qr.js';
import { query } from '../lib/db.js';

// ============================================================
// Generación de PDF: informe consolidado "defendible" y etiqueta por factura.
// Marca sicr3p · verde #28a745 · navy #0f1f2e.
// Prohibida la palabra "huella" en todo el texto.
// ============================================================

const GREEN = '#28a745';
const NAVY = '#0f1f2e';
const GRAY = '#64748b';
const LIGHT = '#f1f5f9';
const BORDER = '#e6e9ed';

const MESES = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];

// Formatea número con locale chileno (coma decimal, punto miles).
function nf(n, dec = 4) {
  const num = Number(n) || 0;
  return num.toLocaleString('es-CL', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// Formato es-CL "compacto": hasta 1 decimal, sin ceros de relleno (82,5 · 70).
function nfp(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

// ---------- Declaración de embalaje — REP Ley 20.920 ----------
// Nombres legibles de los materiales declarables (envases y embalajes).
const MATERIALES_EMBALAJE = {
  papel_carton: 'Papel y cartón',
  plasticos: 'Plásticos',
  vidrio: 'Vidrio',
  metales: 'Metales',
  madera: 'Madera',
  compuestos: 'Compuestos',
  otros: 'Otros',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Trae la declaración de embalaje de una sesión (una fila por sesión) o null.
// Tolerante: si la tabla aún no existe o el id no es UUID (informe mensual con
// sesión sintética), devuelve null y los PDF salen exactamente como hoy.
export async function fetchDeclaracionEmbalaje(sesionId) {
  if (!sesionId || !UUID_RE.test(String(sesionId))) return null;
  try {
    const { rows } = await query(
      `SELECT componentes, peso_total_gr, peso_reciclable_gr, porcentaje, nivel, created_at
         FROM declaraciones_embalaje
        WHERE sesion_id = $1`,
      [sesionId]
    );
    return rows[0] || null;
  } catch (e) {
    console.warn('[pdf] declaración de embalaje no disponible:', e.message);
    return null;
  }
}

// ---------- Alcances GHG por categoría ----------
// Trae las categorías activas con alcance GHG declarado (columna nueva
// motor_categorias.alcance_ghg). Tolerante: si la columna aún no existe o la
// consulta falla, devuelve [] y el informe sale exactamente como hoy.
async function fetchAlcancesGHG() {
  try {
    const { rows } = await query(
      `SELECT nombre, alcance_ghg
         FROM motor_categorias
        WHERE activo = true AND alcance_ghg IS NOT NULL
        ORDER BY nombre`
    );
    return rows;
  } catch (e) {
    console.warn('[pdf] alcances GHG no disponibles:', e.message);
    return [];
  }
}

// Normaliza el JSONB de componentes (puede llegar como string).
function componentesDe(declaracion) {
  const c = declaracion?.componentes;
  if (Array.isArray(c)) return c;
  if (typeof c === 'string') {
    try { return JSON.parse(c) || []; } catch { return []; }
  }
  return [];
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
// `declaracion` (opcional): fila de declaraciones_embalaje ya consultada por la
// ruta. Si viene undefined, el servicio la busca por sesion.id; con null se omite.
// `alcances` (opcional): filas {nombre, alcance_ghg} ya consultadas. Si viene
// undefined, el servicio las busca en motor_categorias; con [] se omiten.
export async function generateReport({ sesion, facturas, declaracion, alcances }) {
  const decl = declaracion !== undefined ? declaracion : await fetchDeclaracionEmbalaje(sesion?.id);
  const alcancesGhg = Array.isArray(alcances) ? alcances : await fetchAlcancesGHG();
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
  doc.text(sesion.periodo_texto || fechaCorta(sesion.fecha), 400, y + 28, { width: 130 });

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
      doc.text(fechaCorta(f.fecha || sesion.fecha), cols.fecha + 6, y + 4, { lineBreak: false });
      doc.text(String(f.numero_venta || '—').slice(0, 16), cols.doc, y + 4, { lineBreak: false });
      doc.text(String(it.descripcion || '').slice(0, 34), cols.glosa, y + 4, { lineBreak: false });
      doc.text(nf(it.co2e, 4), cols.cargo - 20, y + 4, { width: 97, align: 'right' });
      y += 16;
    }
  }

  // Saldo del período
  doc.rect(48, y, 499, 22).fillAndStroke('#eaf6ef', GREEN);
  doc.font('Courier-Bold').fontSize(10).fillColor(NAVY);
  doc.text('SALDO DEL PERÍODO', cols.glosa - 90, y + 6, { lineBreak: false });
  doc.fillColor(GREEN).text(`${nf(saldo, 4)} tCO2e`, cols.cargo - 60, y + 6, { width: 137, align: 'right' });
  y += 34;

  // Alcances GHG de las categorías presentes en el período (nota bajo la tabla,
  // solo si hay categorías con alcance declarado).
  const alcancePorCategoria = new Map(alcancesGhg.map((a) => [a.nombre, a.alcance_ghg]));
  const alcancesPeriodo = [...new Set(categorias.map((c) => alcancePorCategoria.get(c)).filter(Boolean))];
  if (alcancesPeriodo.length) {
    if (y > 760) { doc.addPage(); y = 48; }
    doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(GRAY)
      .text(`Alcances del período: ${alcancesPeriodo.join('; ')}`, 48, y, { width: 499 });
    y = doc.y + 10;
  }

  // --- Declaración de embalaje — REP Ley 20.920 ---
  if (decl && decl.nivel) {
    const comps = componentesDe(decl);
    if (y > 580) { doc.addPage(); y = 48; }

    doc.font('Helvetica-Bold').fontSize(13).fillColor(NAVY)
      .text('Declaración de embalaje — REP Ley 20.920', 48, y);
    y += 22;

    // Tabla de componentes (mismo formato contable del libro).
    const rc = { mat: 48, peso: 260, cant: 380, rec: 450 };
    doc.rect(48, y, 499, 18).fill(NAVY);
    doc.font('Courier-Bold').fontSize(8.5).fillColor('#ffffff');
    doc.text('Material', rc.mat + 6, y + 5);
    doc.text('Peso unit. (gr)', rc.peso - 60, y + 5, { width: 120, align: 'right' });
    doc.text('Cantidad', rc.cant - 40, y + 5, { width: 60, align: 'right' });
    doc.text('Reciclable', rc.rec, y + 5, { width: 91, align: 'right' });
    y += 18;

    let zebraE = false;
    for (const c of comps) {
      if (y > 760) { doc.addPage(); y = 48; }
      if (zebraE) { doc.rect(48, y, 499, 15).fill(LIGHT); }
      zebraE = !zebraE;
      doc.font('Courier').fontSize(8.5).fillColor(NAVY);
      doc.text(MATERIALES_EMBALAJE[c.material] || String(c.material || '—'), rc.mat + 6, y + 4, { lineBreak: false });
      doc.text(nfp(c.peso_gr), rc.peso - 60, y + 4, { width: 120, align: 'right' });
      doc.text(nfp(c.cantidad ?? 1), rc.cant - 40, y + 4, { width: 60, align: 'right' });
      doc.text(c.reciclable ? 'Sí' : 'No', rc.rec, y + 4, { width: 91, align: 'right' });
      y += 15;
    }

    // Totales declarados.
    if (y > 730) { doc.addPage(); y = 48; }
    doc.font('Courier-Bold').fontSize(8.5).fillColor(NAVY);
    doc.text(`Peso total: ${nfp(decl.peso_total_gr)} gr`, 54, y + 4, { lineBreak: false });
    doc.text(`Peso reciclable: ${nfp(decl.peso_reciclable_gr)} gr`, rc.peso - 60, y + 4, { width: 332, align: 'right' });
    y += 20;

    // Línea destacada: % de reciclabilidad y nivel.
    doc.rect(48, y, 499, 22).fillAndStroke('#eaf6ef', GREEN);
    doc.font('Courier-Bold').fontSize(10).fillColor(NAVY);
    doc.text('% de reciclabilidad:', 58, y + 6, { lineBreak: false });
    doc.fillColor(GREEN).text(`${nfp(decl.porcentaje)}% — nivel ${decl.nivel}`, 300, y + 6, { width: 237, align: 'right' });
    y += 28;

    // Nota al pie de la sección.
    doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(GRAY)
      // Nota: las fuentes core de pdfkit (WinAnsi) no tienen el glifo "≥"; se usa ">=".
      .text('Clasificación referencial según composición declarada (umbrales: Alto >= 70%, Medio >= 50%, Bajo < 50%). No constituye una verificación de tercera parte acreditada.', 48, y, { width: 499 });
    y = doc.y + 12;
  }

  // --- Metodología ---
  if (y > 620) { doc.addPage(); y = 48; }
  doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY).text('Metodología', 48, y);
  y += 18;
  doc.font('Helvetica').fontSize(9).fillColor(GRAY);
  // Marco de referencia: con alcances declarados por categoría se citan los
  // alcances GHG reales; sin datos se mantiene la línea genérica de siempre.
  if (alcancesGhg.length) {
    doc.text('•  Marco de referencia: GHG Protocol Corporate Standard e ISO 14064-1. Clasificación por alcance según categoría:', 48, y, { width: 499 });
    y = doc.y + 4;
    for (const a of alcancesGhg) {
      if (y > 760) { doc.addPage(); y = 48; }
      doc.font('Helvetica').fontSize(9).fillColor(GRAY)
        .text(`· ${a.nombre}: ${a.alcance_ghg}`, 64, y, { width: 483 });
      y = doc.y + 3;
    }
    y += 3;
  } else {
    doc.text('•  Marco de referencia: GHG Protocol (Scope 3 — emisiones indirectas de la cadena de valor) e ISO 14064-1.', 48, y, { width: 499 });
    y = doc.y + 6;
  }
  const metod = [
    'Factores de emisión: HuellaChile (Ministerio del Medio Ambiente). Electricidad — Sistema Eléctrico Nacional (SEN) 2023: 0,2421 kgCO2e/kWh.',
    'Jerarquía de calidad del dato (4 niveles): (1) dato primario medido; (2) dato del proveedor; (3) factor nacional/sectorial; (4) factor por defecto / proxy.',
    'La asignación por ítem se realiza a partir del documento tributario cargado y su glosa, clasificada por categoría de actividad.',
  ];
  doc.font('Helvetica').fontSize(9).fillColor(GRAY);
  for (const m of metod) {
    if (y > 750) { doc.addPage(); y = 48; doc.font('Helvetica').fontSize(9).fillColor(GRAY); }
    doc.text('•  ' + m, 48, y, { width: 499 });
    y = doc.y + 6;
  }

  // --- Disclaimer ---
  y += 6;
  if (y > 720) { doc.addPage(); y = 48; }
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

// ---------- ESTADO DE CAPITAL NATURAL ----------
// Balance por cuenta ambiental (flujos del período + activos naturales).
export async function generateBalanceNatural({ balance, movimientos, activos, periodo = {} }) {
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
  const year = new Date().getFullYear();
  const folioN = `N-${year}-${String(((movimientos?.length || 0) + (activos?.length || 0) + 1) % 10000).padStart(4, '0')}`;
  const rango = periodo.desde || periodo.hasta
    ? `${periodo.desde ? fechaCorta(periodo.desde) : 'inicio'} a ${periodo.hasta ? fechaCorta(periodo.hasta) : 'hoy'}`
    : 'todo el período registrado';

  // --- Encabezado ---
  drawLogo(doc, 48, 44);
  doc.font('Helvetica').fontSize(9).fillColor(GRAY).text('Contabilidad de capital natural', 48, 74);
  doc.fontSize(9).fillColor(GRAY)
    .text(`Folio ${folioN}`, 400, 46, { width: 147, align: 'right' })
    .text(`Emitido: ${fechaCorta(new Date())}`, 400, 60, { width: 147, align: 'right' });
  doc.moveTo(48, 92).lineTo(547, 92).strokeColor(BORDER).stroke();

  doc.font('Helvetica-Bold').fontSize(18).fillColor(NAVY).text('Estado de Capital Natural', 48, 106);
  doc.font('Helvetica').fontSize(10).fillColor(GRAY)
    .text(`Período: ${rango} · Cuentas ambientales según SEEA (ONU)`, 48, 130);

  // --- Resumen por cuenta (tarjetas) ---
  let y = 156;
  const activasFlujo = (balance || []).filter((b) => b.activo && b.tipo !== 'stock');
  const cw = 118, gap = 9;
  activasFlujo.slice(0, 4).forEach((b, i) => {
    const cx = 48 + i * (cw + gap);
    doc.roundedRect(cx, y, cw, 62, 8).fillAndStroke('#ffffff', BORDER);
    doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(`${b.codigo} · ${b.nombre}`.toUpperCase(), cx + 10, y + 10, { width: cw - 20 });
    doc.font('Helvetica-Bold').fontSize(14).fillColor(GREEN).text(nf(b.saldo, 2), cx + 10, y + 26, { width: cw - 20 });
    doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(`${b.unidad} · ${b.n_movimientos} mov.`, cx + 10, y + 46, { width: cw - 20 });
  });
  y += 84;

  // --- Libro por cuenta (movimientos del período) ---
  const porCuenta = new Map();
  for (const m of movimientos || []) {
    if (!porCuenta.has(m.cuenta_codigo)) porCuenta.set(m.cuenta_codigo, []);
    porCuenta.get(m.cuenta_codigo).push(m);
  }

  for (const b of balance || []) {
    const movs = porCuenta.get(b.codigo) || [];
    if (!movs.length) continue;
    if (y > 660) { doc.addPage(); y = 48; }

    doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY)
      .text(`${b.codigo} — ${b.nombre} (${b.unidad})`, 48, y);
    y += 18;

    const cols = { fecha: 48, glosa: 130, tipo: 400, cant: 460 };
    doc.rect(48, y, 499, 18).fill(NAVY);
    doc.font('Courier-Bold').fontSize(8.5).fillColor('#ffffff');
    doc.text('Fecha', cols.fecha + 6, y + 5);
    doc.text('Glosa', cols.glosa, y + 5);
    doc.text('Tipo', cols.tipo, y + 5);
    doc.text(`Cantidad (${b.unidad})`, cols.cant - 40, y + 5, { width: 127, align: 'right' });
    y += 18;

    let zebra = false;
    for (const m of movs) {
      if (y > 760) { doc.addPage(); y = 48; }
      if (zebra) { doc.rect(48, y, 499, 15).fill(LIGHT); }
      zebra = !zebra;
      doc.font('Courier').fontSize(8).fillColor(NAVY);
      doc.text(fechaCorta(m.fecha), cols.fecha + 6, y + 4, { lineBreak: false });
      doc.text(String(m.glosa || '').slice(0, 44), cols.glosa, y + 4, { lineBreak: false });
      doc.text(m.tipo === 'abono' ? 'Abono' : 'Cargo', cols.tipo, y + 4, { lineBreak: false });
      doc.text(nf(m.cantidad, 2), cols.cant - 40, y + 4, { width: 127, align: 'right' });
      y += 15;
    }

    // Saldo del período por cuenta
    if (y > 745) { doc.addPage(); y = 48; }
    doc.rect(48, y, 499, 20).fillAndStroke('#eaf6ef', GREEN);
    doc.font('Courier-Bold').fontSize(9).fillColor(NAVY)
      .text('SALDO DEL PERÍODO', cols.glosa, y + 6, { lineBreak: false });
    doc.fillColor(GREEN).text(`${nf(b.saldo, 2)} ${b.unidad}`, cols.cant - 60, y + 6, { width: 147, align: 'right' });
    y += 32;
  }

  // --- Activos naturales (stocks) ---
  if ((activos || []).length) {
    if (y > 620) { doc.addPage(); y = 48; }
    doc.font('Helvetica-Bold').fontSize(13).fillColor(NAVY).text('Activos naturales (stocks)', 48, y);
    y += 20;
    const cols = { nombre: 48, cuenta: 220, ext: 300, cond: 390, clp: 450 };
    doc.rect(48, y, 499, 18).fill(NAVY);
    doc.font('Courier-Bold').fontSize(8.5).fillColor('#ffffff');
    doc.text('Activo', cols.nombre + 6, y + 5);
    doc.text('Cuenta', cols.cuenta, y + 5);
    doc.text('Extensión', cols.ext, y + 5);
    doc.text('Cond.', cols.cond, y + 5);
    doc.text('Valor (CLP)', cols.clp - 20, y + 5, { width: 117, align: 'right' });
    y += 18;
    let zebra = false;
    for (const a of activos) {
      if (y > 760) { doc.addPage(); y = 48; }
      if (zebra) { doc.rect(48, y, 499, 15).fill(LIGHT); }
      zebra = !zebra;
      doc.font('Courier').fontSize(8).fillColor(NAVY);
      doc.text(String(a.nombre || '').slice(0, 26), cols.nombre + 6, y + 4, { lineBreak: false });
      doc.text(a.cuenta_codigo, cols.cuenta, y + 4, { lineBreak: false });
      doc.text(`${nf(a.extension, 1)} ${a.unidad || ''}`.trim(), cols.ext, y + 4, { lineBreak: false });
      doc.text(a.condicion != null ? `${a.condicion}` : '—', cols.cond, y + 4, { lineBreak: false });
      const valorTxt = a.valor_clp_efectivo != null
        ? `${nf(a.valor_clp_efectivo, 0)}${a.valor_origen === 'automatico' ? ' (auto)' : ''}`
        : '—';
      doc.text(valorTxt, cols.clp - 20, y + 4, { width: 117, align: 'right' });
      y += 15;
    }
    y += 10;
  }

  // --- Metodología ---
  if (y > 610) { doc.addPage(); y = 48; }
  doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY).text('Metodología', 48, y);
  y += 18;
  const metod = [
    'Marco de referencia: SEEA — Sistema de Contabilidad Ambiental y Económica (ONU), Marco Central y Cuentas de Ecosistemas; Natural Capital Protocol (Capitals Coalition); TNFD para reporte corporativo.',
    'Cuenta de carbono (CO2E): GHG Protocol (Scope 3) e ISO 14064-1; factores HuellaChile (MMA). Electricidad SEN 2023: 0,2421 kgCO2e/kWh.',
    'Flujos: derivados de documentos tributarios capturados, con traza al documento de origen. Cantidades físicas estimadas mediante factores de conversión editables por cuenta.',
    'Stocks: activos naturales registrados con extensión, condición (0–100) y valorización CLP — manual cuando se ingresa directamente, o automática (extensión × precio unitario citado por cuenta, marcada "auto") cuando la cuenta define un precio de referencia.',
  ];
  doc.font('Helvetica').fontSize(9).fillColor(GRAY);
  for (const m of metod) {
    doc.text('•  ' + m, 48, y, { width: 499 });
    y = doc.y + 6;
  }

  // --- Disclaimer ---
  y += 6;
  if (y > 720) { doc.addPage(); y = 48; }
  doc.roundedRect(48, y, 499, 40, 6).fillAndStroke('#fffbeb', '#fde68a');
  doc.font('Helvetica-Oblique').fontSize(9).fillColor('#92400e')
    .text('Este informe no constituye una verificación de tercera parte acreditada.', 60, y + 8, { width: 475 });
  doc.font('Helvetica').fontSize(8).fillColor(GRAY)
    .text('Documento generado por sicr3p como contabilidad de capital natural trazable, base para su gestión y decisiones.', 60, y + 24, { width: 475 });

  // --- Pie de página ---
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const oldBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(8).fillColor(GRAY)
      .text(`sicr3p · Estado de Capital Natural · Folio ${folioN}`, 48, 808, { width: 400, lineBreak: false });
    doc.text(`Página ${i + 1} de ${range.count}`, 400, 808, { width: 147, align: 'right', lineBreak: false });
    doc.page.margins.bottom = oldBottom;
  }

  return bufferDoc(doc);
}

// ---------- ETIQUETA POR FACTURA (con QR) ----------
// `declaracion` (opcional): fila de declaraciones_embalaje ya consultada por la
// ruta. Si viene undefined, se busca por factura.sesion_id; con null se omite.
export async function generateLabel({ sesion, factura, declaracion }) {
  const decl = declaracion !== undefined
    ? declaracion
    : await fetchDeclaracionEmbalaje(factura?.sesion_id || sesion?.id);
  // Etiqueta compacta tipo tarjeta (media carta apaisada).
  const doc = new PDFDocument({ size: [420, 260], margin: 0 });
  const qr = await qrBuffer(factura.id);

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

  // Declaración de embalaje (REP): una sola línea, solo si existe.
  if (decl && decl.nivel) {
    doc.font('Helvetica').fontSize(7.5).fillColor(GRAY)
      .text(`Embalaje REP: ${nfp(decl.porcentaje)}% reciclabilidad · nivel ${decl.nivel}`, 24, y + 2, { width: 250, lineBreak: false });
  }

  // QR
  doc.image(qr, 290, 70, { width: 110, height: 110 });
  doc.font('Helvetica').fontSize(6.5).fillColor(GRAY)
    .text('Verifica la trazabilidad', 290, 184, { width: 110, align: 'center' });

  // Bloque verde: resultado incorporado
  const nItems = factura.items?.length || 0;
  doc.roundedRect(24, 196, 372, 44, 8).fill('#eaf6ef');
  doc.roundedRect(24, 196, 372, 44, 8).lineWidth(1).stroke(GREEN);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(GREEN).text('RESULTADO INCORPORADO', 36, 206);
  doc.font('Helvetica-Bold').fontSize(14).fillColor(NAVY)
    .text(`${nf(factura.total_co2e, 3)} t CO2e`, 36, 218, { lineBreak: false });
  doc.font('Helvetica').fontSize(8.5).fillColor(GRAY)
    .text(`·  ${factura.categoria || 'Sin categoría'}  ·  ${nItems} ítems`, 150, 222, { width: 240 });

  return bufferDoc(doc);
}
