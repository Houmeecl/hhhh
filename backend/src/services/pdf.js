import PDFDocument from 'pdfkit';
import { qrBuffer, qrBufferDe, loteUrl, tarjetaUrl } from './qr.js';
import { query } from '../lib/db.js';
import { filtrarPorVisibilidad, enmascararRut } from './pasaporteOrigen.js';
import { eslabonValido } from './cadenaHash.js';
import { verificarCadenaGlobal } from './cadenaGlobal.js';
import { hashCorto } from './cadenaPublica.js';

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
// Cita corta de una fuente metodológica: "organismo — documento (año)".
// PURA y exportada para test. Honestidad: los organismos citados avalan
// la METODOLOGÍA, no a sicr3p.
export function citaFuente({ organismo, documento, version_anio } = {}) {
  const cuerpo = [organismo, documento]
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
    .join(' — ');
  if (!cuerpo) return '';
  const anio = String(version_anio ?? '').trim();
  return anio ? `${cuerpo} (${anio})` : cuerpo;
}

// Trae las categorías activas con alcance GHG declarado (columna nueva
// motor_categorias.alcance_ghg) y, si existe el registro de fuentes
// (migración 018), la fuente vinculada para citarla en la metodología.
// Tolerante en dos niveles: sin tabla/columna de fuentes se reintenta la
// consulta original (render idéntico al actual, sin citas); si tampoco
// existe alcance_ghg, devuelve [] y el informe sale exactamente como hoy.
async function fetchAlcancesGHG() {
  try {
    const { rows } = await query(
      `SELECT mc.nombre, mc.alcance_ghg, f.organismo, f.documento, f.version_anio
         FROM motor_categorias mc
         LEFT JOIN fuentes_metodologicas f ON f.id = mc.fuente_metodologica_id
        WHERE mc.activo = true AND mc.alcance_ghg IS NOT NULL
        ORDER BY mc.nombre`
    );
    return rows;
  } catch {
    // fuentes_metodologicas o la FK aún no migradas: sigue el camino original
  }
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
// `alcances` (opcional): filas {nombre, alcance_ghg} ya consultadas — pueden
// traer además {organismo, documento, version_anio} para citar la fuente. Si
// viene undefined, el servicio las busca en motor_categorias; con [] se omiten.
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
    // Cabecera de hash del documento (una sola vez por factura, no por
    // ítem): mismo dato que ya se usa en la etiqueta/carpeta, ahora
    // también visible en el informe consolidado.
    if (f.hash_cadena) {
      if (y > 755) { doc.addPage(); y = 48; }
      const intacta = eslabonValido(f);
      doc.font('Courier').fontSize(7).fillColor(intacta === false ? '#b91c1c' : GRAY)
        .text(
          `Doc. ${String(f.numero_venta || '—').slice(0, 16)} · hash ${hashCorto(f.hash_cadena)} · eslabón #${f.eslabon}` +
          (intacta === false ? ' · ⚠ ALTERADO' : ''),
          cols.doc, y + 2, { lineBreak: false }
        );
      y += 11;
    }
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

  // --- Verificación de integridad ---
  // Cuenta cuántas de las facturas de ESTE informe son internamente
  // consistentes (eslabonValido) y, aparte, el estado de la cadena
  // GLOBAL completa (facturas + anclajes de lote + declaraciones REP).
  const facturasHasheadas = facturas.filter((f) => f.hash_cadena);
  if (facturasHasheadas.length) {
    if (y > 700) { doc.addPage(); y = 48; }
    const intactas = facturasHasheadas.filter((f) => eslabonValido(f)).length;
    const cadenaGlobal = await verificarCadenaGlobal();
    doc.roundedRect(48, y, 499, 56, 6).fillAndStroke(LIGHT, cadenaGlobal.valido ? GREEN : '#b91c1c');
    doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text('VERIFICACIÓN DE INTEGRIDAD', 60, y + 10);
    doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(
      `${intactas}/${facturasHasheadas.length} documento${facturasHasheadas.length === 1 ? '' : 's'} de este informe verificado${facturasHasheadas.length === 1 ? '' : 's'} individualmente. ` +
      `Cadena global sicr3p: ${cadenaGlobal.valido ? 'íntegra' : 'ALTERADA'} (${cadenaGlobal.total_eslabones ?? '—'} eslabones totales).`,
      60, y + 26, { width: 475 }
    );
    if (!cadenaGlobal.valido) {
      doc.font('Helvetica-Bold').fillColor('#b91c1c').text('⚠ La cadena global presenta una alteración detectada.', 60, y + 40);
    }
    y += 68;
  }

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
      // Con fuente vinculada (migración 018) se cita "organismo — documento
      // (año)"; sin fuente la línea queda idéntica a la actual.
      const cita = citaFuente(a);
      doc.font('Helvetica').fontSize(9).fillColor(GRAY)
        .text(`· ${a.nombre}: ${a.alcance_ghg}${cita ? ` · Fuente: ${cita}` : ''}`, 64, y, { width: 483 });
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
export async function generateBalanceNatural({ balance, movimientos, activos, integridad, periodo = {} }) {
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

  // --- Sello de integridad por cuenta ---
  // Cada cuenta tiene su propia mini-cadena de hash (migración 029): se
  // omite silenciosamente si aún no tiene movimientos hasheados (cuentas
  // creadas antes de esta migración, o sin actividad) — no se inventa nada.
  if ((integridad || []).some((i) => i.total_eslabones)) {
    if (y > 640) { doc.addPage(); y = 48; }
    doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY).text('Sello de integridad por cuenta', 48, y);
    y += 18;
    for (const i of integridad) {
      if (!i.total_eslabones) continue;
      if (y > 745) { doc.addPage(); y = 48; }
      doc.roundedRect(48, y, 499, 34, 6).fillAndStroke(LIGHT, i.valido ? GREEN : '#b91c1c');
      doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY).text(i.codigo, 60, y + 8);
      doc.font('Helvetica').fontSize(8).fillColor(GRAY)
        .text(`${i.total_eslabones} movimiento${i.total_eslabones === 1 ? '' : 's'} hasheado${i.total_eslabones === 1 ? '' : 's'} · ${i.valido ? 'cadena íntegra' : 'ALTERACIÓN detectada'} · hash actual:`, 130, y + 8, { width: 340 });
      doc.font('Courier').fontSize(7).fillColor(NAVY).text(String(i.ultimo_hash || ''), 60, y + 20, { width: 475 });
      y += 40;
    }
    y += 8;
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

// ---------- EXPEDIENTE DE TRAZABILIDAD — Pasaporte de Origen ----------
// El respaldo FÍSICO de un lote mineral: se imprime, se archiva junto a
// la tarjeta de viaje NFC/RFID y acompaña a la carga. Divulgación
// selectiva nivel PÚBLICO (lo ven terceros): eslabones reservados
// muestran su hash pero no su contenido. "SELLADO" solo si el lote está
// cerrado; si además fue anclado, se imprime su eslabón global.
const ROL_EXPEDIENTE = {
  mina: 'Mina', planta: 'Planta', refineria: 'Refinería', transporte: 'Transporte',
  comerciante: 'Comerciante', exportador: 'Exportador', comprador: 'Comprador',
  // tipo producto (ciudad / mostrador sicr3p)
  productor: 'Productor', proveedor: 'Proveedor', comercio: 'Comercio',
  punto_aduana_verde: 'Punto sicr3p',
  // tipo documental (Corredor)
  origen: 'Origen', deposito: 'Depósito', frontera: 'Frontera', puerto: 'Puerto', destino: 'Destino',
};
const MATERIAL_EXPEDIENTE = {
  cobre_catodo: 'Cátodos de cobre', concentrado_cobre: 'Concentrado de cobre',
  litio_carbonato: 'Carbonato de litio', oro: 'Oro', otro: 'Otro',
  alimentos: 'Alimentos', bebidas: 'Bebidas', textil: 'Textil', embalajes: 'Embalajes',
  manufactura: 'Manufactura', quimicos: 'Químicos',
  carga_general: 'Carga general', carga_refrigerada: 'Carga refrigerada',
  granel: 'Granel', contenedor: 'Contenedor', documentos: 'Documentos',
};
const TITULO_EXPEDIENTE = {
  mineral: 'EXPEDIENTE DE TRAZABILIDAD',
  producto: 'EXPEDIENTE DE TRAZABILIDAD DE PRODUCTO',
  documental: 'EXPEDIENTE DE TRAZABILIDAD DOCUMENTAL',
};
const SUBTITULO_EXPEDIENTE = {
  mineral: 'Pasaporte de Origen · cadena de custodia del lote mineral',
  producto: 'Pasaporte de Producto · cadena de custodia del lote',
  documental: 'Pasaporte Documental · cadena de custodia de la carga (Corredor)',
};

export async function generateExpedienteLote({ lote, eslabones, declaraciones, normativo, balance, emisiones, anclaje, integra }) {
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
  const W = doc.page.width - 96;
  const sellado = lote.estado === 'cerrado';

  // ---- Carátula ----
  drawLogo(doc, 48, 44);
  doc.font('Helvetica').fontSize(9).fillColor(GRAY)
    .text(`Emitido: ${fechaCorta(new Date())}`, 380, 48, { width: 167, align: 'right' });
  doc.moveTo(48, 78).lineTo(547, 78).strokeColor(BORDER).stroke();

  const tipoLote = lote.tipo || 'mineral';
  doc.font('Helvetica-Bold').fontSize(16).fillColor(NAVY)
    .text(TITULO_EXPEDIENTE[tipoLote] || TITULO_EXPEDIENTE.mineral, 48, 96);
  doc.font('Helvetica').fontSize(11).fillColor(GRAY)
    .text(SUBTITULO_EXPEDIENTE[tipoLote] || SUBTITULO_EXPEDIENTE.mineral, 48, 118);

  // Código gigante + estado + QR
  doc.font('Courier-Bold').fontSize(24).fillColor(NAVY).text(lote.codigo, 48, 150);
  const chip = sellado ? 'SELLADO' : 'PARCIAL — LOTE ABIERTO';
  const chipColor = sellado ? GREEN : '#b45309';
  doc.roundedRect(48, 186, doc.widthOfString(chip) + 60, 22, 4).fillAndStroke(LIGHT, chipColor);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(chipColor).text(chip, 60, 192);
  if (!integra) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#b91c1c')
      .text('⚠ CADENA DE CUSTODIA ALTERADA (verificación fallida)', 48, 214);
  }
  try {
    const qr = await qrBufferDe(loteUrl(lote.codigo));
    doc.image(qr, 437, 96, { width: 110, height: 110 });
    doc.font('Helvetica').fontSize(7.5).fillColor(GRAY)
      .text('Escanee para verificar en línea', 437, 210, { width: 110, align: 'center' });
  } catch { /* sin QR el expediente sigue siendo válido */ }

  // ---- Identificación del lote ----
  let y = 245;
  doc.roundedRect(48, y, W, 92, 6).fillAndStroke(LIGHT, BORDER);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text('IDENTIFICACIÓN DEL LOTE', 60, y + 10);
  const filasId = [
    ['Material', MATERIAL_EXPEDIENTE[lote.material] || lote.material,
      'Cantidad', `${nf(lote.cantidad, 3)} ${lote.unidad}`],
    ['País de origen', lote.pais_origen, 'Faena / instalación', lote.faena_origen || '—'],
    ['Código NC (UE)', lote.codigo_nc || '—', 'Titular (RUT)', lote.rut_titular ? (enmascararRut(lote.rut_titular) || '—') : '—'],
  ];
  let fy = y + 28;
  for (const [l1, v1, l2, v2] of filasId) {
    doc.font('Helvetica').fontSize(8.5).fillColor(GRAY).text(l1, 60, fy).text(l2, 310, fy);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(NAVY)
      .text(String(v1), 150, fy - 1).text(String(v2), 420, fy - 1);
    fy += 20;
  }

  // ---- Cadena de custodia ----
  y = 355;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text('CADENA DE CUSTODIA', 48, y);
  if (balance?.alerta) {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#b45309')
      .text(`⚠ Merma acumulada ${nfp(balance.merma_pct)}% (sobre tolerancia)`, 300, y + 1, { width: 247, align: 'right' });
  }
  y += 18;
  // Cabecera de tabla
  doc.rect(48, y, W, 18).fill(NAVY);
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
  doc.text('#', 54, y + 5).text('Rol', 72, y + 5).text('Actor', 140, y + 5)
    .text('País', 285, y + 5).text('Fecha', 318, y + 5)
    .text('Punto de control', 372, y + 5).text('Hash (inicio)', 470, y + 5);
  y += 18;
  const publicos = filtrarPorVisibilidad(eslabones || [], 'publico');
  doc.font('Helvetica').fontSize(8).fillColor(NAVY);
  let zebra = false;
  for (const e of publicos) {
    if (y > 760) { doc.addPage(); y = 60; }
    if (zebra) { doc.rect(48, y, W, 16).fill(LIGHT); doc.fillColor(NAVY); }
    zebra = !zebra;
    const actor = e.divulgado
      ? (e.nombre_empresa || (e.rut_empresa ? enmascararRut(e.rut_empresa) : '—') || '—')
      : 'No divulgado (reservado)';
    const punto = e.divulgado ? (e.datos?.punto_control || '—') : '—';
    doc.font('Helvetica').fontSize(8).fillColor(NAVY)
      .text(String(e.eslabon), 54, y + 4)
      .text(ROL_EXPEDIENTE[e.rol] || e.rol, 72, y + 4, { width: 64 })
      .text(String(actor).slice(0, 34), 140, y + 4, { width: 140 })
      .text(e.pais || '', 285, y + 4)
      .text(e.fecha ? fechaCorta(e.fecha) : '', 318, y + 4, { width: 52 })
      .text(String(punto).slice(0, 22), 372, y + 4, { width: 94 });
    doc.font('Courier').fontSize(7).text(String(e.hash_cadena).slice(0, 12) + '…', 470, y + 4);
    y += 16;
  }
  if (!publicos.length) {
    doc.font('Helvetica').fontSize(9).fillColor(GRAY).text('Sin eslabones registrados.', 54, y + 4);
    y += 20;
  }

  // ---- Emisiones incorporadas ----
  y += 14;
  if (y > 700) { doc.addPage(); y = 60; }
  doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text('EMISIONES INCORPORADAS', 48, y);
  y += 16;
  const declarado = emisiones?.declarado_t != null ? `${nf(emisiones.declarado_t, 4)} t CO2e/t (declarado por el titular)` : 'Sin declaración del titular';
  const trazado = emisiones?.trazado_t != null ? `${nf(emisiones.trazado_t, 4)} t CO2e/t (trazado en la cadena)` : 'Sin aportes trazados';
  doc.font('Helvetica').fontSize(9).fillColor(NAVY).text(`Declarado: ${declarado}`, 48, y);
  y += 14;
  doc.text(`Trazado:   ${trazado}`, 48, y);
  y += 14;
  if (emisiones?.advertencia) {
    doc.font('Helvetica-Bold').fillColor('#b45309')
      .text(`⚠ Declarado y trazado difieren en ${nfp(emisiones.divergencia_pct)}%`, 48, y);
    y += 14;
  }
  if (emisiones?.fuente) {
    doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(`Fuente metodológica: ${citaFuente(emisiones.fuente)}`, 48, y);
    y += 14;
  }

  // ---- Alineación normativa ----
  y += 8;
  if (y > 680) { doc.addPage(); y = 60; }
  doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text('ALINEACIÓN NORMATIVA', 48, y);
  y += 16;
  const lineasNorm = [
    // OECD minerales SOLO aplica a lotes minerales (normativo.oecd null en otros tipos).
    ...(normativo.oecd ? [
      `OECD Due Diligence (minerales): ${normativo.oecd.pasos_cubiertos}/${normativo.oecd.pasos_total} pasos declarados · ${normativo.oecd.anexo2_cubiertas}/${normativo.oecd.anexo2_total} banderas Anexo II`,
    ] : []),
    `CBAM (Reglamento UE 2023/956): ${normativo.cbam.listo ? 'datos estructurados completos' : `faltan: ${normativo.cbam.faltantes.join(', ')}`}${normativo.cbam.aplicable ? '' : ' — material fuera del Anexo I vigente (la declaración CBAM la presenta el importador UE)'}`,
    `Pasaporte Digital de Producto (ESPR): ${normativo.dpp.listo ? 'formato completo' : `faltan: ${normativo.dpp.faltantes.join(', ')}`}`,
  ];
  doc.font('Helvetica').fontSize(8.5).fillColor(NAVY);
  for (const linea of lineasNorm) {
    doc.text(`·  ${linea}`, 48, y, { width: W });
    y = doc.y + 4;
  }

  // ---- Sello de integridad ----
  y += 8;
  if (y > 640) { doc.addPage(); y = 60; }
  doc.roundedRect(48, y, W, anclaje ? 96 : 72, 6).fillAndStroke(LIGHT, sellado ? GREEN : BORDER);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text('SELLO DE INTEGRIDAD', 60, y + 10);
  doc.font('Helvetica').fontSize(8).fillColor(GRAY)
    .text(`Hash final del lote (${lote.n_eslabones} eslabones):`, 60, y + 26);
  doc.font('Courier').fontSize(7.5).fillColor(NAVY).text(String(lote.ultimo_hash), 60, y + 38, { width: W - 24 });
  if (anclaje) {
    doc.font('Helvetica').fontSize(8).fillColor(GRAY)
      .text(`Anclado en la cadena pública sicr3p — eslabón global #${anclaje.eslabon} (${fechaCorta(anclaje.created_at)}):`, 60, y + 56);
    doc.font('Courier').fontSize(7.5).fillColor(NAVY).text(String(anclaje.hash_cadena), 60, y + 68, { width: W - 24 });
  }
  y += (anclaje ? 96 : 72) + 12;

  const marcos = normativo.oecd
    ? 'la Guía de Debida Diligencia OCDE para minerales, al Reglamento CBAM (UE) 2023/956 y al concepto de Pasaporte Digital de Producto (ESPR)'
    : 'el Reglamento CBAM (UE) 2023/956 y el concepto de Pasaporte Digital de Producto (ESPR)';
  doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(
    `Verificación en línea: ${loteUrl(lote.codigo)} — la cadena pública de sicr3p permite comprobar que este expediente no fue alterado. ` +
    `Formato alineado a ${marcos}. ` +
    'sicr3p no es certificador, auditor ni autoridad: registra y estructura declaraciones y documentos verificables de los actores de la cadena.',
    48, y, { width: W }
  );

  return bufferDoc(doc);
}

// ---------- CREDENCIAL VIRTUAL — Tarjeta de Viaje (solo QR, sin chip) ----------
// La "tarjeta" es esta credencial: un PDF tamaño tarjeta que el admin
// descarga y envía al transportista (WhatsApp o impresa). El QR apunta a
// /v/{serial} — la credencial VIVA del lote. La clave del portador NUNCA
// va impresa aquí: viaja aparte y se muestra una sola vez al emitir.
export async function generateCredencialTarjeta({ tarjeta, lote }) {
  const doc = new PDFDocument({ size: [420, 260], margin: 0 });
  const qr = await qrBufferDe(tarjetaUrl(tarjeta.serial));

  // Fondo
  doc.rect(0, 0, 420, 260).fill('#ffffff');
  doc.roundedRect(8, 8, 404, 244, 12).lineWidth(1.5).stroke(BORDER);

  // Encabezado
  drawLogo(doc, 24, 24, 20);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(GREEN)
    .text('TARJETA DE VIAJE', 24, 50, { lineBreak: false });
  doc.font('Helvetica').fontSize(7.5).fillColor(GRAY)
    .text(' · Pasaporte de Origen', doc.x, 51, { lineBreak: false });

  // Serial protagonista
  doc.font('Courier-Bold').fontSize(26).fillColor(NAVY).text(tarjeta.serial, 24, 74);

  // Datos del lote
  let y = 116;
  const fila = (label, value) => {
    doc.font('Helvetica').fontSize(7).fillColor(GRAY).text(label.toUpperCase(), 24, y);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(NAVY)
      .text(String(value || '—').slice(0, 40), 24, y + 9, { width: 235 });
    y += 27;
  };
  fila('Lote', lote.codigo);
  fila('Material', MATERIAL_EXPEDIENTE[lote.material] || lote.material);
  fila('Portador', tarjeta.portador);

  // QR grande — el corazón de la credencial
  doc.image(qr, 282, 62, { width: 118, height: 118 });
  doc.font('Helvetica').fontSize(6.5).fillColor(GRAY)
    .text('Escanee para abrir el pasaporte del lote', 274, 184, { width: 134, align: 'center' });

  // Pie
  doc.roundedRect(24, 200, 372, 40, 8).fill(LIGHT);
  doc.font('Helvetica').fontSize(7).fillColor(NAVY).text(
    'Cualquiera que escanee este QR ve el pasaporte público del lote. Solo el portador, ' +
    'con su clave (entregada por separado), registra pasos — cada paso queda sellado con ' +
    'hash, fecha y punto de control en la cadena del lote.',
    34, 207, { width: 352 }
  );

  return bufferDoc(doc);
}

// ---------- CARPETA PARA EL MANDANTE — evidencia física por trámite ----------
// Las mineras y grandes empresas piden la evidencia EN PAPEL. Esta carpeta
// es el entregable único imprimible del trámite: portada dirigida al
// mandante, resumen, un QR de verificación POR DOCUMENTO y la hoja que le
// dice al receptor cómo comprobar en 30 segundos que el papel es veraz.
// El papel y el registro digital se validan mutuamente (mismo principio
// del expediente de lotes).

// Saneo del nombre del mandante (viene por query, solo texto de portada,
// jamás se persiste). PURO y exportado para test.
export function sanearNombreMandante(v) {
  const limpio = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 80).trim();
  return limpio || null;
}

export async function generateCarpetaMandante({ sesion, facturas, declaracion, alcances, mandante, contrapartes }) {
  const decl = declaracion !== undefined ? declaracion : await fetchDeclaracionEmbalaje(sesion?.id);
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
  const W = doc.page.width - 96;
  const destinatario = sanearNombreMandante(mandante) || 'su empresa mandante';
  const totalCo2e = (facturas || []).reduce((a, f) => a + Number(f.total_co2e || 0), 0);

  // ---- Portada ----
  drawLogo(doc, 48, 44);
  doc.font('Helvetica').fontSize(9).fillColor(GRAY)
    .text(`Folio ${folio(sesion)} · ${fechaCorta(new Date())}`, 340, 48, { width: 207, align: 'right' });
  doc.moveTo(48, 78).lineTo(547, 78).strokeColor(BORDER).stroke();

  doc.font('Helvetica-Bold').fontSize(18).fillColor(NAVY)
    .text('CARPETA DE EVIDENCIA AMBIENTAL', 48, 110);
  doc.font('Helvetica').fontSize(11).fillColor(GRAY)
    .text('Contabilidad de carbono y declaración REP, verificables por QR', 48, 134);

  doc.roundedRect(48, 165, W, 96, 8).fillAndStroke(LIGHT, BORDER);
  doc.font('Helvetica').fontSize(9).fillColor(GRAY).text('PRESENTADA POR', 64, 180);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(NAVY)
    .text(String(sesion.nombre_cliente || '—').slice(0, 60), 64, 193);
  doc.font('Helvetica').fontSize(10).fillColor(GRAY)
    .text(`RUT ${sesion.rut_cliente || '—'}`, 64, 211);
  doc.font('Helvetica').fontSize(9).fillColor(GRAY).text('PREPARADA PARA', 64, 231);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY).text(destinatario, 64, 244);

  try {
    const qrPortada = await qrBuffer(facturas?.[0]?.id);
    doc.image(qrPortada, 437, 175, { width: 76, height: 76 });
    doc.font('Helvetica').fontSize(6.5).fillColor(GRAY)
      .text('Verificación en línea', 427, 253, { width: 96, align: 'center' });
  } catch { /* sin facturas: portada sin QR */ }

  // ---- Resumen ejecutivo ----
  let y = 285;
  doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY).text('RESUMEN DEL TRÁMITE', 48, y);
  y += 20;
  const tarjetas = [
    [`${nf(totalCo2e, 3)} t CO2e`, 'Emisiones incorporadas'],
    [`${(facturas || []).length}`, 'Documentos verificables'],
    [decl?.nivel ? `${nfp(decl.porcentaje)}% · ${decl.nivel}` : 'Sin declaración', 'Reciclabilidad REP'],
  ];
  let x = 48;
  for (const [cifra, etiqueta] of tarjetas) {
    doc.roundedRect(x, y, 158, 54, 8).fillAndStroke('#eaf6ef', GREEN);
    doc.font('Helvetica-Bold').fontSize(13).fillColor(NAVY).text(cifra, x + 12, y + 12, { width: 138 });
    doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(etiqueta, x + 12, y + 34, { width: 138 });
    x += 170;
  }
  y += 72;
  doc.font('Helvetica').fontSize(9).fillColor(GRAY).text(
    'Cada documento de esta carpeta tiene su propia página pública de verificación (QR en la sección ' +
    'siguiente). Las cifras impresas deben coincidir con las cifras en línea: si no coinciden, el papel fue alterado.',
    48, y, { width: W }
  );

  // ---- Detalle por documento (2 columnas × 3 filas por página) ----
  doc.addPage();
  doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY).text('DOCUMENTOS VERIFICABLES', 48, 48);
  let col = 0;
  let fila = 0;
  const CAJA_W = 243;
  const CAJA_H = 148;
  for (const f of facturas || []) {
    if (fila === 3) { doc.addPage(); fila = 0; col = 0; }
    const bx = 48 + col * (CAJA_W + 13);
    const by = 74 + fila * (CAJA_H + 14);
    doc.roundedRect(bx, by, CAJA_W, CAJA_H, 8).fillAndStroke('#ffffff', BORDER);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY)
      .text(String(f.numero_venta || '—').slice(0, 24), bx + 12, by + 12, { width: CAJA_W - 110 });
    doc.font('Helvetica').fontSize(8).fillColor(GRAY)
      .text(String(f.categoria || 'Sin categoría').slice(0, 40), bx + 12, by + 28, { width: CAJA_W - 110 })
      .text(`Estado: ${f.status || '—'}`, bx + 12, by + 42, { width: CAJA_W - 110 });
    doc.font('Helvetica-Bold').fontSize(12).fillColor(GREEN)
      .text(`${nf(f.total_co2e, 3)}`, bx + 12, by + 66, { lineBreak: false });
    doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(' t CO2e', doc.x, by + 69);
    if (f.hash_cadena) {
      doc.font('Courier').fontSize(6.5).fillColor(GRAY)
        .text(`eslabón #${f.eslabon} · ${String(f.hash_cadena).slice(0, 18)}…`, bx + 12, by + 126, { width: CAJA_W - 24 });
    }
    try {
      const qr = await qrBuffer(f.id);
      doc.image(qr, bx + CAJA_W - 96, by + 12, { width: 84, height: 84 });
      doc.font('Helvetica').fontSize(6).fillColor(GRAY)
        .text('Escanear para verificar', bx + CAJA_W - 100, by + 99, { width: 92, align: 'center' });
    } catch { /* QR opcional */ }
    col = (col + 1) % 2;
    if (col === 0) fila += 1;
  }

  // ---- Declaración REP (si existe) ----
  if (decl) {
    doc.addPage();
    doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY)
      .text('DECLARACIÓN DE ENVASES Y EMBALAJES — LEY REP 20.920', 48, 48);
    let ry = 76;
    doc.roundedRect(48, ry, W, 46, 8).fillAndStroke('#eaf6ef', GREEN);
    doc.font('Helvetica-Bold').fontSize(13).fillColor(NAVY)
      .text(`${nfp(decl.porcentaje)}% de reciclabilidad · nivel ${decl.nivel}`, 64, ry + 10);
    doc.font('Helvetica').fontSize(9).fillColor(GRAY)
      .text(`${nf(Number(decl.peso_reciclable_gr || 0), 0)} g reciclables de ${nf(Number(decl.peso_total_gr || 0), 0)} g totales · porcentaje calculado por el servidor`, 64, ry + 28);
    ry += 64;
    const comps = componentesDe(decl);
    if (comps.length) {
      doc.rect(48, ry, W, 18).fill(NAVY);
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff')
        .text('Componente', 56, ry + 5).text('Material', 250, ry + 5).text('Peso (g)', 420, ry + 5).text('Reciclable', 480, ry + 5);
      ry += 18;
      doc.font('Helvetica').fontSize(8.5).fillColor(NAVY);
      for (const c of comps) {
        if (ry > 770) { doc.addPage(); ry = 60; }
        doc.text(String(c.nombre || '—').slice(0, 38), 56, ry + 4, { width: 186 })
          .text(MATERIALES_EMBALAJE[c.material] || c.material || '—', 250, ry + 4, { width: 160 })
          .text(nf(Number(c.peso_gr || 0), 0), 420, ry + 4)
          .text(c.reciclable ? 'Sí' : 'No', 480, ry + 4);
        ry += 16;
      }
    }
  }

  // ---- Contrapartes relacionadas (reusa GET /informes/cadena, sin
  // inventar ningún cálculo nuevo) ----
  const nProv = contrapartes?.proveedores?.length || 0;
  const nComp = contrapartes?.compradores?.length || 0;
  if (nProv || nComp) {
    doc.addPage();
    doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY).text('CONTRAPARTES RELACIONADAS', 48, 48);
    doc.font('Helvetica').fontSize(9).fillColor(GRAY)
      .text(`Otras empresas que le emitieron documentos a ${sesion.rut_cliente || 'este RUT'} (proveedores) o que recibieron documentos de este RUT (compradores), según los documentos ya procesados por sicr3p — no incluye relaciones fuera de la plataforma.`, 48, 68, { width: W });
    let cy = doc.y + 14;

    const tablaContraparte = (titulo, filas) => {
      if (!filas.length) return;
      if (cy > 700) { doc.addPage(); cy = 48; }
      doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text(titulo, 48, cy);
      cy += 16;
      doc.rect(48, cy, W, 16).fill(NAVY);
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff')
        .text('RUT', 56, cy + 4).text('Documentos', 260, cy + 4).text('t CO2e', 360, cy + 4).text('Último documento', 440, cy + 4);
      cy += 16;
      doc.font('Helvetica').fontSize(8).fillColor(NAVY);
      for (const p of filas.slice(0, 10)) {
        if (cy > 760) { doc.addPage(); cy = 48; }
        doc.text(p.rut || '—', 56, cy + 4, { width: 190 })
          .text(String(p.n_documentos), 260, cy + 4)
          .text(nf(p.total_co2e, 3), 360, cy + 4)
          .text(p.ultimo_documento ? fechaCorta(p.ultimo_documento) : '—', 440, cy + 4);
        cy += 15;
      }
      cy += 12;
    };
    tablaContraparte('Proveedores (le emitieron documentos a este RUT)', contrapartes.proveedores || []);
    tablaContraparte('Compradores (recibieron documentos de este RUT)', contrapartes.compradores || []);

    doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(GRAY)
      .text('Datos derivados de documentos ya procesados por sicr3p; no constituye una verificación de tercera parte acreditada.', 48, cy, { width: W });
  }

  // ---- Hoja de verificación para el receptor ----
  doc.addPage();
  doc.font('Helvetica-Bold').fontSize(14).fillColor(NAVY)
    .text('CÓMO COMPROBAR ESTA CARPETA EN 30 SEGUNDOS', 48, 48);
  const pasos = [
    ['1', 'Escanee cualquier QR de esta carpeta con la cámara de su teléfono. Se abre la página pública de verificación — sin cuentas ni claves.'],
    ['2', `Compare: el folio (${folio(sesion)}), la empresa y las toneladas de CO2e impresas deben coincidir con lo que muestra la pantalla.`],
    ['3', 'Revise el estado de la cadena de integridad en la misma página: "intacta" significa que el registro no fue alterado desde su emisión.'],
  ];
  let py = 84;
  for (const [n, texto] of pasos) {
    doc.circle(60, py + 8, 10).fill(GREEN);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#ffffff').text(n, 56, py + 2);
    doc.font('Helvetica').fontSize(10).fillColor(NAVY).text(texto, 84, py, { width: W - 40 });
    py = doc.y + 14;
  }
  const primera = (facturas || [])[0];
  if (primera?.hash_cadena) {
    py += 6;
    doc.roundedRect(48, py, W, 64, 8).fillAndStroke(LIGHT, eslabonValido(primera) ? GREEN : BORDER);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY).text('SELLO DE INTEGRIDAD (primer documento de la carpeta)', 60, py + 10);
    doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(`Eslabón #${primera.eslabon} de la cadena pública sicr3p:`, 60, py + 26);
    doc.font('Courier').fontSize(7.5).fillColor(NAVY).text(String(primera.hash_cadena), 60, py + 38, { width: W - 24 });
    py += 78;
  }
  doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(
    'sicr3p no es un organismo certificador ni un verificador de tercera parte acreditado: registra, calcula y ' +
    'sella datos desde los documentos tributarios reales del presentador, con integridad garantizada por una cadena ' +
    'de hash pública. Esta carpeta se emitió para acompañar una entrega física; su versión digital siempre prevalece.',
    48, Math.max(py, 620), { width: W }
  );

  return bufferDoc(doc);
}
