import PDFDocument from 'pdfkit';
import { opcionesCifrado } from './entrega.js';
import { qrBuffer, qrBufferDe, loteUrl, tarjetaUrl, constanciaUrl, firmaProveedorUrl } from './qr.js';
import { query } from '../lib/db.js';
import { filtrarPorVisibilidad, enmascararRut, semaforoDocumental } from './pasaporteOrigen.js';
import { eslabonValido } from './cadenaHash.js';
import { verificarCadenaGlobal } from './cadenaGlobal.js';
import { hashCorto } from './cadenaPublica.js';
import { metodologiaDeVersiones } from './motorVersiones.js';
import { esAtribuible, categoriaParaMostrar, MOTIVOS_SIN_ALCANCE } from './categoriaPresentacion.js';
import { formatearRut } from './mandante.js';
// Import circular benigno con alcanceGhg.js (que toma citaFuente de acá):
// citaFuente es una function declaration —hoisted—, así que está disponible
// aunque alcanceGhg se evalúe primero; y estas dos solo se llaman en runtime.
import { agregarPorAlcance, filasDesdeFacturas } from './alcanceGhg.js';

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

// Descargo obligatorio en TODO informe que declare emisiones. Va impreso —
// no basta con mostrarlo en pantalla: estos PDF se entregan a un mandante,
// a un auditor o a una autoridad, y ahí el documento viaja solo. Los
// materiales comerciales (ficha 01, dossier corporativo) afirman que cada
// informe lo dice de forma impresa; esta constante es lo que sostiene esa
// afirmación, así que no se quita sin corregir también esos documentos.
const AVISO_NO_VERIFICACION =
  'Este documento NO constituye una verificación de tercera parte acreditada (ISO 14064-3). ' +
  'Los factores de emisión se aplican como referenciales: corresponde validarlos contra la ' +
  'edición vigente de su fuente antes de un uso contractual o regulatorio.';

// Pie de descargo al final del contenido de un informe.
function avisoNoVerificacion(doc, x, y, ancho) {
  doc.font('Helvetica').fontSize(7.5).fillColor(GRAY)
    .text(AVISO_NO_VERIFICACION, x, y, { width: ancho });
}

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

const round4 = (n) => Math.round(n * 10000) / 10000;
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
//
// CUIDADO: esta consulta lee el estado VIGENTE del motor. Es el camino de
// respaldo, no el principal — el informe se arma en cada descarga, así que
// leer en vivo hacía que editar un factor cambiara la metodología de un
// informe ya emitido, dejándolo citando una fuente que nunca produjo ese
// cálculo. El camino correcto es metodologiaDeVersiones() a partir de
// facturas.motor_version_id (migración 051); acá solo se cae cuando las
// facturas no traen versión (datos anteriores al versionado).
export async function fetchAlcancesGHG() {
  try {
    const { rows } = await query(
      `SELECT mc.codigo, mc.nombre, mc.alcance_ghg, f.organismo, f.documento, f.version_anio
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

// 'YYYY-MM-DD' (columna DATE, sin hora) se arma directo del string: pasarla
// por `new Date()` la interpreta como medianoche UTC y los getters locales
// (getDate/getMonth/getFullYear) dependen del TZ del proceso — en Chile
// mostraría un día antes. Con hora/zona sí conviene pasar por Date.
function fechaLocal(d) {
  const soloFecha = d && String(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (soloFecha) return { dia: Number(soloFecha[3]), mes: Number(soloFecha[2]) - 1, anio: Number(soloFecha[1]) };
  const dt = d ? new Date(d) : new Date();
  return { dia: dt.getDate(), mes: dt.getMonth(), anio: dt.getFullYear() };
}

function fechaCorta(d) {
  const { dia, mes, anio } = fechaLocal(d);
  return `${String(dia).padStart(2, '0')}-${MESES[mes]}-${anio}`;
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
  const year = fechaLocal(sesion.fecha || sesion.created_at || Date.now()).anio;
  const seq = String(parseInt((sesion.id || '').replace(/\D/g, '').slice(-4) || '1', 10) % 10000).padStart(4, '0');
  return `C-${year}-${seq}`;
}

// ---------- INFORME CONSOLIDADO ----------
// `declaracion` (opcional): fila de declaraciones_embalaje ya consultada por la
// ruta. Si viene undefined, el servicio la busca por sesion.id; con null se omite.
// `alcances` (opcional): filas {nombre, alcance_ghg} ya consultadas — pueden
// traer además {organismo, documento, version_anio} para citar la fuente. Si
// viene undefined, el servicio resuelve la metodología CONGELADA de las
// versiones del motor con que se calcularon estas facturas; con [] se omiten.
// `clave` (opcional): contraseña del PDF. Con ella el informe sale cifrado
// con AES-256 (ver services/entrega.js). El activo de sicr3p es este
// documento: entregarlo en claro por correo sería sellar el cálculo y
// mandarlo desnudo.
export async function generateReport({ sesion, facturas, declaracion, alcances, clave = null }) {
  const decl = declaracion !== undefined ? declaracion : await fetchDeclaracionEmbalaje(sesion?.id);
  // Metodología congelada: sale de la versión del motor estampada en cada
  // factura, no del estado vigente. Así el informe sigue citando lo que
  // realmente produjo sus números aunque después se editen los factores.
  const metodologia = Array.isArray(alcances)
    ? null
    : await metodologiaDeVersiones(facturas.map((f) => f.motor_version_id));
  const alcancesGhg = Array.isArray(alcances)
    ? alcances
    : (metodologia?.alcances ?? await fetchAlcancesGHG());
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, ...opcionesCifrado(clave) });
  const totalCo2e = facturas.reduce((a, f) => a + Number(f.total_co2e || 0), 0);
  const totalItems = facturas.reduce((a, f) => a + (f.items?.length || 0), 0);
  // Solo las categorías ATRIBUIBLES: las que salieron de la glosa real del
  // documento. El catch-all del motor no cuenta como categoría identificada
  // ni aporta un alcance al período — es un default de cálculo, no una
  // conclusión. Ver services/categoriaPresentacion.js.
  const atribuibles = facturas.filter((f) => esAtribuible(f.categoria_origen));
  const categorias = [...new Set(atribuibles.map((f) => f.categoria).filter(Boolean))];
  // Los dos motivos NO son el mismo hecho y no se pueden sumar en una frase:
  // de un `sin_coincidencia` consta que el motor intentó y falló; de un NULL
  // solo consta que no se registró la procedencia. Ver categoriaParaMostrar().
  const estados = facturas.map((f) => categoriaParaMostrar(f).estado);
  const nSinConfirmar = estados.filter((e) => e === 'sin_confirmar' || e === 'sin_categoria').length;
  const nSinProcedencia = estados.filter((e) => e === 'sin_procedencia').length;
  // Reclasificados a mano por un operador (migración 079). SÍ reciben alcance
  // —'operador' es atribuible—, pero el informe lo declara: una categoría que
  // asignó una persona no puede leerse como una que dedujo el motor.
  const nReclasificados = facturas.filter((f) => f.ajuste_id).length;

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
    // "|| 1" no: si el motor no identificó ninguna categoría, el número honesto
    // es cero. Redondear hacia arriba para que la tarjeta no se vea vacía era
    // afirmar una categoría identificada que no existe.
    //
    // Pero cero tampoco sirve cuando lo único que hay son documentos SIN
    // PROCEDENCIA REGISTRADA: de esos no consta que no se hayan identificado,
    // consta que no se anotó quién lo hizo. El número honesto ahí es ninguno.
    (categorias.length === 0 && nSinProcedencia > 0)
      ? { label: 'Categorías', value: '—', unit: 'sin registrar' }
      : { label: 'Categorías', value: String(categorias.length), unit: 'identificadas' },
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
    // Un documento reclasificado por un operador tiene su CO2e recalculado en
    // la factura, pero sus `line_items` conservan el cálculo ORIGINAL: son lo
    // que el motor leyó del documento y no se reescriben. Si el libro sumara
    // los ítems, el saldo del período contradiría al total de la portada
    // dentro del MISMO PDF. Se reparte el total vigente entre los ítems, en
    // proporción a lo que cada uno pesaba.
    const sumaItems = (f.items || []).reduce((a, it) => a + Number(it.co2e || 0), 0);
    const ajustado = f.ajuste_id != null && sumaItems > 0;
    const escala = ajustado ? Number(f.total_co2e || 0) / sumaItems : 1;
    for (const it of f.items || []) {
      if (y > 760) { doc.addPage(); y = 48; }
      const co2eItem = round4(Number(it.co2e || 0) * escala);
      saldo += co2eItem;
      if (zebra) { doc.rect(48, y, 499, 16).fill(LIGHT); doc.fillColor(NAVY); }
      zebra = !zebra;
      doc.font('Courier').fontSize(8.5).fillColor(NAVY);
      doc.text(fechaCorta(f.fecha || sesion.fecha), cols.fecha + 6, y + 4, { lineBreak: false });
      doc.text(String(f.numero_venta || '—').slice(0, 16), cols.doc, y + 4, { lineBreak: false });
      doc.text(String(it.descripcion || '').slice(0, 34), cols.glosa, y + 4, { lineBreak: false });
      doc.text(nf(co2eItem, 4), cols.cargo - 20, y + 4, { width: 97, align: 'right' });
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

  // Alcances GHG de las categorías ATRIBUIBLES del período (nota bajo la tabla).
  //
  // El índice va por CÓDIGO y no por nombre: `motor_categorias.nombre` se edita
  // desde el panel del motor, así que renombrar una categoría sacaba su alcance
  // del informe sin aviso — el mismo acoplamiento frágil que describe la
  // migración 077. Se conserva el respaldo por nombre para los documentos
  // anteriores a esa migración, que no tienen `categoria_codigo`.
  // Tabla "Emisiones por alcance (GHG Protocol)" — la misma del informe SII,
  // ahora también en el informe del flujo público: un inventario entregable
  // (programa HuellaChile del MMA, verificadores externos) exige el detalle
  // por Alcance 1/2/3 con su desglose por categoría, no una línea de texto.
  // El adaptador traduce el vocabulario de `facturas` y el saldo sin alcance
  // sale con su causa (misma regla central: solo se atribuye alcance a la
  // categoría que salió de la glosa real del documento o de un operador).
  const porAlcance = agregarPorAlcance(filasDesdeFacturas(facturas, alcancesGhg));
  if (porAlcance.alcances.length || porAlcance.sin_clasificar.n_documentos > 0) {
    if (y > 620) { doc.addPage(); y = 48; }
    y = tablaPorAlcance(doc, 48, y, 499, porAlcance, totalCo2e);
  }
  // Lo que quedó fuera no se esconde: su CO2e está dentro del total de arriba,
  // así que omitirlo dejaría un informe que no cuadra consigo mismo.
  const notas = [];
  if (nSinConfirmar > 0) {
    notas.push(
      `${nSinConfirmar} ${nSinConfirmar === 1 ? 'documento no pudo clasificarse' : 'documentos no pudieron clasificarse'} `
      + 'a partir del detalle de sus ítems.'
    );
  }
  if (nSinProcedencia > 0) {
    notas.push(
      `${nSinProcedencia} ${nSinProcedencia === 1 ? 'documento no registra' : 'documentos no registran'} `
      + 'de qué fuente salió su categoría.'
    );
  }
  if (notas.length) {
    if (y > 760) { doc.addPage(); y = 48; }
    doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(GRAY)
      .text(
        `${notas.join(' ')} Su CO2e está incluido en el total, pero no se les atribuye alcance GHG.`,
        48, y, { width: 499 }
      );
    y = doc.y + 10;
  }
  // Los reclasificados van en nota APARTE, no en la de arriba: esa termina en
  // "no se les atribuye alcance GHG", y estos SÍ lo reciben —'operador' es
  // atribuible—. Meterlos ahí decía lo contrario de lo que hace el código.
  if (nReclasificados > 0) {
    if (y > 760) { doc.addPage(); y = 48; }
    doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(GRAY)
      .text(
        `${nReclasificados} ${nReclasificados === 1 ? 'documento fue clasificado' : 'documentos fueron clasificados'} `
        + 'por un operador y no por el motor, porque su detalle no permitía deducir la categoría. '
        + 'Sí reciben alcance GHG. El ajuste queda registrado aparte, sin alterar el documento '
        + 'original ni su sello.',
        48, y, { width: 499 }
      );
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
      .text('Clasificación según composición declarada (umbrales: Alto >= 70%, Medio >= 50%, Bajo < 50%).', 48, y, { width: 499 });
    y = doc.y + 12;
  }

  // --- Pie de página en todas las páginas ---
  // Se anula el margen inferior temporalmente para poder escribir en el pie
  // sin que PDFKit agregue páginas en blanco por desbordar el margen.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const oldBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(6.5).fillColor(GRAY)
      .text(AVISO_NO_VERIFICACION, 48, 786, { width: 499, lineBreak: true });
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
    .text(`Período: ${rango}`, 48, 130);

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

  // --- Pie de página ---
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const oldBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(6.5).fillColor(GRAY)
      .text(AVISO_NO_VERIFICACION, 48, 786, { width: 499, lineBreak: true });
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
    // La etiqueta se pega en un archivador: no puede afirmar una categoría que
    // el motor no dedujo del documento (ver categoriaPresentacion.js).
    .text(`·  ${categoriaParaMostrar(factura).detalle}  ·  ${nItems} ítems`, 150, 222, { width: 240 });

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

// Carga Bioceánica (migración 043) — etiquetas legibles de los tipos de
// documento del expediente, mismo catálogo que TIPOS_DOCUMENTO_CARGA.
const TIPO_DOCUMENTO_EXPEDIENTE = {
  factura: 'Factura comercial', packing_list: 'Packing list', carta_porte: 'Carta de porte',
  mic_dta: 'MIC/DTA', cert_origen: 'Certificado de origen', sag: 'Documento SAG',
  seguro: 'Seguro', pesaje: 'Comprobante de pesaje', foto: 'Fotografía',
  comprobante_frontera: 'Comprobante fronterizo', otro: 'Otro',
};
const SEMAFORO_COLOR_EXPEDIENTE = {
  verde: GREEN, amarillo: '#b45309', rojo: '#b91c1c', gris: GRAY,
};
const SEMAFORO_TEXTO_EXPEDIENTE = {
  verde: 'COMPLETO', amarillo: 'PARCIAL', rojo: 'SIN DOCUMENTOS', gris: 'SIN CRITERIO DEFINIDO',
};

export async function generateExpedienteLote({ lote, eslabones, declaraciones, normativo, balance, emisiones, anclaje, integra, documentos, tarjetas }) {
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

  // ---- Vehículos y conductores (Carga Bioceánica) ----
  if (tarjetas?.length) {
    y += 10;
    if (y > 700) { doc.addPage(); y = 60; }
    doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text('VEHÍCULOS Y CONDUCTORES', 48, y);
    y += 16;
    doc.font('Helvetica').fontSize(8.5).fillColor(NAVY);
    for (const t of tarjetas) {
      if (y > 760) { doc.addPage(); y = 60; }
      const placas = [t.placa_tracto, t.placa_semirremolque].filter(Boolean).join(' / ') || 'sin placa registrada';
      const conductor = t.conductor_nombre
        ? `${t.conductor_nombre}${t.conductor_documento ? ` (${t.conductor_documento})` : ''}`
        : 'sin conductor registrado';
      doc.text(`·  ${t.portador || 'Tarjeta ' + t.serial}  —  Placas: ${placas}  —  Conductor: ${conductor}`, 48, y, { width: W });
      y = doc.y + 4;
    }
  }

  // ---- Documentos del expediente (Carga Bioceánica, migración 043) ----
  if (lote.tipo === 'documental') {
    const docs = documentos || [];
    const semaforo = semaforoDocumental(lote, docs);

    y += 14;
    if (y > 700) { doc.addPage(); y = 60; }
    doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text('SEMÁFORO DOCUMENTAL', 48, y);
    y += 16;
    const chipSem = SEMAFORO_TEXTO_EXPEDIENTE[semaforo.color] || semaforo.color.toUpperCase();
    const colorSem = SEMAFORO_COLOR_EXPEDIENTE[semaforo.color] || GRAY;
    doc.roundedRect(48, y, doc.font('Helvetica-Bold').fontSize(9).widthOfString(chipSem) + 24, 20, 4).fillAndStroke(LIGHT, colorSem);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(colorSem).text(chipSem, 60, y + 6);
    y += 30;
    doc.font('Helvetica').fontSize(8.5).fillColor(NAVY)
      .text(`Documentos esperados para ${MATERIAL_EXPEDIENTE[lote.material] || lote.material}: ${semaforo.esperados.map((t) => TIPO_DOCUMENTO_EXPEDIENTE[t] || t).join(', ') || '—'}`, 48, y, { width: W });
    y = doc.y + 4;
    if (semaforo.faltantes.length) {
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#b45309')
        .text(`Faltantes: ${semaforo.faltantes.map((t) => TIPO_DOCUMENTO_EXPEDIENTE[t] || t).join(', ')}`, 48, y, { width: W });
      y = doc.y + 4;
    }

    y += 10;
    if (y > 700) { doc.addPage(); y = 60; }
    doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text('DOCUMENTOS DEL EXPEDIENTE', 48, y);
    y += 16;
    doc.rect(48, y, W, 18).fill(NAVY);
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
    doc.text('Tipo', 54, y + 5).text('Estado', 220, y + 5)
      .text('Fecha', 310, y + 5).text('Hash (inicio)', 380, y + 5);
    y += 18;
    doc.font('Helvetica').fontSize(8).fillColor(NAVY);
    let zebraDoc = false;
    for (const d of docs) {
      if (y > 760) { doc.addPage(); y = 60; }
      if (zebraDoc) { doc.rect(48, y, W, 16).fill(LIGHT); doc.fillColor(NAVY); }
      zebraDoc = !zebraDoc;
      const estadoTexto = d.estado === 'leido' ? 'Leído' : d.estado === 'pendiente_revision' ? 'En revisión' : d.estado === 'sin_texto' ? 'Sin señal' : d.estado;
      doc.font('Helvetica').fontSize(8).fillColor(NAVY)
        .text(TIPO_DOCUMENTO_EXPEDIENTE[d.tipo_documento] || d.tipo_documento, 54, y + 4, { width: 160 })
        .text(estadoTexto, 220, y + 4, { width: 84 })
        .text(d.created_at ? fechaCorta(d.created_at) : '', 310, y + 4, { width: 64 });
      doc.font('Courier').fontSize(7)
        .text(d.hash_cadena ? String(d.hash_cadena).slice(0, 12) + '…' : '—', 380, y + 4);
      y += 16;
    }
    if (!docs.length) {
      doc.font('Helvetica').fontSize(9).fillColor(GRAY).text('Sin documentos cargados todavía.', 54, y + 4);
      y += 20;
    }
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

  doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(
    `Verificación en línea: ${loteUrl(lote.codigo)} — la cadena pública de sicr3p permite comprobar que este expediente no fue alterado.`,
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

// ---------- REPORTE CBAM PARA EL MANDANTE — export de apoyo, no certificación ----------
// El mandante exportador pide evidencia de sus lotes (lotes_minerales) para
// armar su propia declaración CBAM ante la UE. Reusa tal cual el cálculo de
// pasaporteOrigen.js (cbamAplicable/resumenNormativo) — este PDF solo lo
// imprime en una tabla, sin recalcular nada.
export async function generateReporteCbam({ mandante, lotes }) {
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
  const W = doc.page.width - 96;
  const destinatario = sanearNombreMandante(mandante?.nombre_empresa) || 'su empresa mandante';

  // ---- Portada ----
  drawLogo(doc, 48, 44);
  doc.font('Helvetica').fontSize(9).fillColor(GRAY)
    .text(`Emitido: ${fechaCorta(new Date())}`, 380, 48, { width: 167, align: 'right' });
  doc.moveTo(48, 78).lineTo(547, 78).strokeColor(BORDER).stroke();

  doc.font('Helvetica-Bold').fontSize(18).fillColor(NAVY)
    .text('REPORTE DE APOYO CBAM', 48, 106);
  doc.font('Helvetica').fontSize(10.5).fillColor(GRAY)
    .text('Datos de trazabilidad y emisiones incorporadas de tus lotes, para tu declaración ante la UE', 48, 130, { width: W });

  doc.roundedRect(48, 158, W, 46, 8).fillAndStroke(LIGHT, BORDER);
  doc.font('Helvetica').fontSize(9).fillColor(GRAY).text('PREPARADO PARA', 64, 170);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY).text(destinatario, 64, 183);

  // ---- Tabla de lotes ----
  let y = 224;
  doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY).text('LOTES', 48, y);
  y += 18;
  doc.rect(48, y, W, 18).fill(NAVY);
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff');
  doc.text('Código', 54, y + 5).text('País', 130, y + 5).text('Material', 160, y + 5)
    .text('NC', 240, y + 5).text('CBAM', 275, y + 5).text('Método', 315, y + 5)
    .text('Directas', 375, y + 5).text('Indirectas', 425, y + 5).text('Estado', 480, y + 5);
  y += 18;

  doc.font('Helvetica').fontSize(7.5).fillColor(NAVY);
  let zebra = false;
  for (const l of lotes || []) {
    if (y > 750) {
      doc.addPage();
      y = 60;
      doc.rect(48, y, W, 18).fill(NAVY);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff');
      doc.text('Código', 54, y + 5).text('País', 130, y + 5).text('Material', 160, y + 5)
        .text('NC', 240, y + 5).text('CBAM', 275, y + 5).text('Método', 315, y + 5)
        .text('Directas', 375, y + 5).text('Indirectas', 425, y + 5).text('Estado', 480, y + 5);
      y += 18;
      doc.font('Helvetica').fontSize(7.5).fillColor(NAVY);
    }
    if (zebra) { doc.rect(48, y, W, 16).fill(LIGHT); doc.fillColor(NAVY); }
    zebra = !zebra;
    const estado = l.cbam?.aplicable ? (l.cbam.listo ? 'Completo' : 'Incompleto') : 'No aplica';
    doc.font('Helvetica').fontSize(7.5).fillColor(NAVY)
      .text(String(l.codigo), 54, y + 4, { width: 74 })
      .text(String(l.pais_origen || '—'), 130, y + 4, { width: 26 })
      .text(String(l.material || '—').slice(0, 18), 160, y + 4, { width: 78 })
      .text(String(l.codigo_nc || '—'), 240, y + 4, { width: 33 })
      .text(l.cbam?.aplicable ? 'Sí' : 'No', 275, y + 4, { width: 38 })
      .text(String(l.metodo_emisiones || '—').slice(0, 14), 315, y + 4, { width: 58 })
      .text(l.emisiones_directas_tco2e_t != null ? nf(l.emisiones_directas_tco2e_t, 3) : '—', 375, y + 4, { width: 48 })
      .text(l.emisiones_indirectas_tco2e_t != null ? nf(l.emisiones_indirectas_tco2e_t, 3) : '—', 425, y + 4, { width: 52 })
      .text(estado, 480, y + 4, { width: 63 });
    y += 16;
  }
  if (!(lotes || []).length) {
    doc.font('Helvetica').fontSize(9).fillColor(GRAY).text('Sin lotes en el período consultado.', 54, y + 4);
    y += 20;
  }

  return bufferDoc(doc);
}

// ---------- INFORME DE CONTABILIDAD DE CARBONO (SII) ----------
// A partir de analizarPeriodo() (services/analisisSiiProveedor.js): compras
// y ventas descargadas del SII de un período, con las emisiones calculadas
// documento a documento. Lenguaje corporativo: las emisiones se dicen
// "calculadas sobre N documentos del SII" (no "estimadas"), sin afirmar
// certificación, sin la palabra "huella".
function folioInforme(proveedorId, periodo) {
  const seq = String(parseInt((proveedorId || '').replace(/\D/g, '').slice(-4) || '1', 10) % 10000).padStart(4, '0');
  return `CC-${(periodo || '').replace('-', '')}-${seq}`;
}

function tablaPorTipo(doc, x, y, ancho, titulo, filas) {
  doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text(titulo, x, y, { width: ancho });
  y = doc.y + 8;
  if (!filas?.length) {
    doc.font('Helvetica').fontSize(9).fillColor(GRAY).text('Sin documentos en este período.', x, y);
    return doc.y + 12;
  }
  doc.rect(x, y, ancho, 16).fill(NAVY);
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff')
    .text('Tipo de documento', x + 6, y + 4).text('Docs', x + ancho - 190, y + 4, { width: 50, align: 'right' })
    .text('Neto', x + ancho - 140, y + 4, { width: 65, align: 'right' })
    .text('Total', x + ancho - 70, y + 4, { width: 64, align: 'right' });
  y += 16;
  let zebra = false;
  for (const f of filas) {
    if (y > doc.page.height - 90) { doc.addPage(); y = 60; }
    if (zebra) doc.rect(x, y, ancho, 15).fill(LIGHT);
    zebra = !zebra;
    doc.font('Helvetica').fontSize(8).fillColor(NAVY)
      .text(f.nombre, x + 6, y + 3, { width: ancho - 200 })
      .text(f.resumen ? 'resumen' : nfp(f.n), x + ancho - 190, y + 3, { width: 50, align: 'right' })
      .text(nfp(f.neto), x + ancho - 140, y + 3, { width: 65, align: 'right' })
      .text(nfp(f.total), x + ancho - 70, y + 3, { width: 64, align: 'right' });
    y += 15;
  }
  return y + 14;
}

// Desglose por alcance GHG. La fila "sin clasificar" NO es opcional: su CO2e
// está dentro del total del informe, así que omitirla dejaría tres alcances
// que no suman lo que dice el número grande de arriba.
// Los motivos viven en services/categoriaPresentacion.js — estaban duplicados
// acá y en el frontend, con el riesgo de que agregar uno en alcanceGhg.js
// dejara el informe mostrando un saldo sin explicar.

function tablaPorAlcance(doc, x, y, ancho, porAlcance, total) {
  const alcances = porAlcance?.alcances || [];
  const sin = porAlcance?.sin_clasificar;
  if (!alcances.length && !sin?.n_documentos) return y;
  const DESC = {
    1: 'Emisiones directas de la operación',
    2: 'Electricidad comprada',
    3: 'Cadena de valor (proveedores, residuos, viajes)',
  };
  const pct = (n) => (total > 0 ? `${nf((n / total) * 100, 1)}%` : '—');

  if (y > doc.page.height - 140) { doc.addPage(); y = 60; }
  doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text('Emisiones por alcance (GHG Protocol)', x, y, { width: ancho });
  y = doc.y + 8;
  doc.rect(x, y, ancho, 16).fill(NAVY);
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff')
    .text('Alcance', x + 6, y + 4).text('Docs', x + ancho - 190, y + 4, { width: 50, align: 'right' })
    .text('tCO2e', x + ancho - 140, y + 4, { width: 65, align: 'right' })
    .text('%', x + ancho - 70, y + 4, { width: 64, align: 'right' });
  y += 16;

  const filas = [
    ...alcances.flatMap((a) => [
      { etiqueta: `Alcance ${a.alcance}`, desc: DESC[a.alcance], n: a.n_documentos, co2e: a.tco2e },
      // Desglose por categoría DENTRO del alcance: un inventario entregable
      // (programa HuellaChile del MMA, verificadores externos) necesita ver
      // de qué se compone cada alcance, no solo su total. En Alcance 3 se
      // cita además la categoría canónica del GHG Protocol.
      ...(a.categorias || []).map((c) => ({
        etiqueta: `   · ${c.nombre}`,
        desc: c.categoria_ghg ? `Cat. ${c.categoria_ghg} — ${c.categoria_ghg_nombre || ''}` : '',
        n: c.n_documentos,
        co2e: c.tco2e,
        sub: true,
      })),
    ]),
    ...(sin?.n_documentos > 0
      ? [{
        etiqueta: 'Sin alcance atribuido',
        // La causa importa para quien lee el informe: no es lo mismo un
        // documento que se clasificó por el nombre del proveedor que uno
        // descargado antes de que existiera esta clasificación.
        desc: MOTIVOS_SIN_ALCANCE
          .filter(([clave]) => sin[clave] > 0)
          .map(([clave, texto]) => `${nfp(sin[clave])} ${texto}`)
          .join(' · ') || 'Sin categoría asignada',
        n: sin.n_documentos,
        co2e: sin.tco2e,
      }]
      : []),
  ];
  // El alto de fila se MIDE, no se asume: la descripción de "Sin alcance
  // atribuido" enumera hasta cinco motivos y con alto fijo de 22 pt se
  // desbordaba sobre el título de la sección siguiente y, cerca del pie,
  // sobre la nota metodológica y el aviso de no verificación.
  const anchoDesc = ancho - 200;
  let zebra = false;
  for (const f of filas) {
    // Las filas de categoría (sub) son de una línea: etiqueta y descripción
    // comparten renglón, con tipografía menor — el alcance sigue siendo el
    // protagonista y su desglose se lee como sangría.
    doc.font('Helvetica').fontSize(7);
    const altoDesc = f.sub ? 0 : doc.heightOfString(f.desc, { width: anchoDesc });
    const alto = f.sub ? 13 : Math.max(22, 12 + altoDesc + 4);
    if (y + alto > doc.page.height - 100) { doc.addPage(); y = 60; }
    if (zebra) doc.rect(x, y, ancho, alto).fill(LIGHT);
    zebra = !zebra;
    if (f.sub) {
      doc.font('Helvetica').fontSize(7).fillColor(NAVY).text(f.etiqueta, x + 6, y + 3, { width: 160, lineBreak: false });
      if (f.desc) doc.font('Helvetica').fontSize(6.5).fillColor(GRAY).text(f.desc, x + 170, y + 3.5, { width: anchoDesc - 164, lineBreak: false, ellipsis: true });
      doc.font('Helvetica').fontSize(7).fillColor(NAVY)
        .text(nfp(f.n), x + ancho - 190, y + 3, { width: 50, align: 'right' })
        .text(nf(f.co2e, 2), x + ancho - 140, y + 3, { width: 65, align: 'right' })
        .text(pct(f.co2e), x + ancho - 70, y + 3, { width: 64, align: 'right' });
    } else {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(NAVY).text(f.etiqueta, x + 6, y + 3, { width: anchoDesc });
      doc.font('Helvetica').fontSize(7).fillColor(GRAY).text(f.desc, x + 6, y + 12, { width: anchoDesc });
      doc.font('Helvetica').fontSize(8).fillColor(NAVY)
        .text(nfp(f.n), x + ancho - 190, y + 6, { width: 50, align: 'right' })
        .text(nf(f.co2e, 2), x + ancho - 140, y + 6, { width: 65, align: 'right' })
        .text(pct(f.co2e), x + ancho - 70, y + 6, { width: 64, align: 'right' });
    }
    y += alto;
  }
  return y + 14;
}

export async function generateInformeCarbono({ empresa, periodo, analisis }) {
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
  const M = 48;
  const W = doc.page.width - M * 2;

  drawLogo(doc, M, 44);
  doc.font('Helvetica').fontSize(9).fillColor(GRAY)
    .text(`${folioInforme(empresa?.id, periodo)} · Emitido el ${fechaCorta(new Date())}`, M, 50, { width: W, align: 'right' });

  doc.font('Helvetica-Bold').fontSize(16).fillColor(NAVY)
    .text('Contabilidad de carbono', M, 96, { width: W });
  doc.font('Helvetica').fontSize(10.5).fillColor(GRAY)
    .text(`Compras y ventas del período ${periodo} — Registro de Compras y Ventas del SII`, M, doc.y + 4, { width: W });

  doc.roundedRect(M, 148, W, 46, 8).fillAndStroke(LIGHT, BORDER);
  doc.font('Helvetica').fontSize(9).fillColor(GRAY).text('EMPRESA', M + 16, 160);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY)
    .text(`${empresa?.nombre_empresa || ''}  ·  ${formatearRut(empresa?.rut)}`, M + 16, 173);

  let y = 216;
  const c = analisis.resumen.compra, v = analisis.resumen.venta;
  const mitad = (W - 16) / 2;
  doc.roundedRect(M, y, mitad, 54, 6).fillAndStroke('#fff', BORDER);
  doc.font('Helvetica').fontSize(8.5).fillColor(GRAY).text('COMPRAS', M + 12, y + 10);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(NAVY).text(`${nfp(c.n)} documentos`, M + 12, y + 24);
  doc.font('Helvetica').fontSize(9).fillColor(GRAY).text(`$${nfp(c.total)}`, M + 12, y + 40);

  doc.roundedRect(M + mitad + 16, y, mitad, 54, 6).fillAndStroke('#fff', BORDER);
  doc.font('Helvetica').fontSize(8.5).fillColor(GRAY).text('VENTAS', M + mitad + 28, y + 10);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(NAVY).text(`${nfp(v.n)} documentos`, M + mitad + 28, y + 24);
  doc.font('Helvetica').fontSize(9).fillColor(GRAY).text(`$${nfp(v.total)}`, M + mitad + 28, y + 40);

  y += 76;

  const em = analisis.emisiones;
  if (em) {
    doc.roundedRect(M, y, W, 60, 8).fillAndStroke('#f0fdfa', '#14b8a6');
    doc.font('Helvetica-Bold').fontSize(18).fillColor(NAVY).text(`${nf(em.total_co2e_tref, 2)} tCO2e`, M + 16, y + 10);
    doc.font('Helvetica').fontSize(9).fillColor(GRAY).text(
      `Emisiones de las compras, calculadas sobre ${nfp(em.documentos_calculados)} de ${nfp(em.documentos_totales)} ` +
      `documentos del SII${em.metodo_fisico > 0 ? ` · ${nfp(em.metodo_fisico)} por unidades físicas, ${nfp(em.metodo_gasto)} por gasto` : ''}.`,
      M + 16, y + 36, { width: W - 32 }
    );
    y += 76;
    y = tablaPorAlcance(doc, M, y, W, em.por_alcance, em.total_co2e_tref);
  }

  y = tablaPorTipo(doc, M, y, W, 'Compras por tipo de documento', analisis.por_tipo?.compra);
  y = tablaPorTipo(doc, M, y, W, 'Ventas por tipo de documento', analisis.por_tipo?.venta);

  // --- Límites y exclusiones declaradas ---
  // Un verificador externo (o el programa HuellaChile del MMA) necesita los
  // límites A LA VISTA, no deducidos: qué cubre este inventario y qué no.
  // Texto honesto — declara lo que el método puede y no puede, sin prometer
  // completitud que no consta.
  if (y > doc.page.height - 240) { doc.addPage(); y = 60; }
  doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY)
    .text('Límites y exclusiones declaradas', M, y, { width: W });
  y = doc.y + 6;
  const LIMITES = [
    'Cobertura: el inventario se deriva de los documentos tributarios del período (RCV y DTE del SII). '
      + 'No incluye datos de actividad medidos directamente (litros de combustible, kWh de fuente propia, '
      + 'fugas de refrigerantes) salvo que consten en un documento del período.',
    'Alcance 2: solo enfoque location-based (factor promedio del sistema eléctrico citado en la metodología); '
      + 'no se aplica el enfoque market-based (contratos de suministro renovable).',
    'Resultados en CO2e: sin desglose por gas individual (CO2, CH4, N2O).',
    'Sin año base ni recálculo histórico: cada período se informa por separado.',
    'Solo se atribuye alcance GHG al documento cuya categoría salió del detalle real de sus ítems; '
      + 'el saldo restante se declara aparte con su causa (tabla de alcances).',
  ];
  doc.font('Helvetica').fontSize(8).fillColor(GRAY);
  for (const l of LIMITES) {
    if (y > doc.page.height - 130) { doc.addPage(); y = 60; }
    doc.text(`• ${l}`, M, y, { width: W });
    y = doc.y + 4;
  }
  y += 4;
  // Para qué sirve este documento — y para qué NO. El programa HuellaChile
  // del MMA reconoce a la empresa titular, nunca a sicr3p ni a través de
  // sicr3p; este informe es un insumo que la empresa presenta, no un
  // certificado.
  if (y > doc.page.height - 150) { doc.addPage(); y = 60; }
  doc.roundedRect(M, y, W, 46, 6).fillAndStroke(LIGHT, BORDER);
  doc.font('Helvetica').fontSize(7.5).fillColor(NAVY).text(
    'Este informe se prepara como INSUMO para procesos de reporte o verificación externos (por ejemplo, '
    + 'el programa HuellaChile del MMA, que reconoce a la empresa titular del inventario — nunca a sicr3p '
    + 'ni a través de sicr3p). No constituye certificación ni verificación de tercera parte: esa revisión '
    + 'la realiza el programa o el verificador que la empresa contrate.',
    M + 10, y + 7, { width: W - 20 }
  );
  y += 56;

  // La versión que se cita es la ESTAMPADA al calcular (migración 076), no la
  // vigente al emitir el PDF: si alguien editó el motor después, este informe
  // sigue diciendo con qué se calculó de verdad.
  const versiones = em?.motor_versiones?.length ? ` Motor de cálculo v${em.motor_versiones.join(', v')}.` : '';
  // Si parte del período se calculó sin versión estampada, se dice: callarlo
  // haría leer "v3, v4" como si cubriera todos los documentos del informe.
  const sinVersion = em?.documentos_sin_version > 0
    ? ` ${nfp(em.documentos_sin_version)} documento(s) sin versión de motor registrada.`.replace('(s)', em.documentos_sin_version === 1 ? '' : 's')
    : '';
  doc.font('Helvetica').fontSize(7.5).fillColor(GRAY).text(
    'Emisiones calculadas con el motor propio de sicr3p sobre lo que entrega el SII de cada documento ' +
    'tributario: el detalle de sus ítems cuando está disponible, y el monto del documento cuando solo llega ' +
    'el registro del RCV (unidades físicas cuando el documento las trae, factores por gasto en el resto). ' +
    'Es una estimación referencial. Solo se atribuye alcance al documento cuya categoría salió del detalle ' +
    'de sus propios ítems, usando su categoría principal; el resto se informa aparte. Categorías de Alcance 3 ' +
    'según GHG Protocol — Corporate Value Chain (Scope 3) Standard, WRI/WBCSD 2011.' + versiones + sinVersion,
    M, doc.page.height - 92, { width: W }
  );
  avisoNoVerificacion(doc, M, doc.page.height - 54, W);

  return bufferDoc(doc);
}

// ---------- INFORME MENSUAL — Transporte de personal (Cat. 7) ----------
// Mismo estilo que generateInformeCarbono (arriba), consolidado del propio
// proveedor: registró sus traslados vía panel-proveedor (routes/
// transporteProveedor.js), este PDF resume el período para su declaración.
function tablaPorModo(doc, x, y, ancho, filas) {
  doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text('Por modo de transporte', x, y, { width: ancho });
  y = doc.y + 8;
  if (!filas?.length) {
    doc.font('Helvetica').fontSize(9).fillColor(GRAY).text('Sin traslados en este período.', x, y);
    return doc.y + 12;
  }
  doc.rect(x, y, ancho, 16).fill(NAVY);
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff')
    .text('Modo', x + 6, y + 4).text('Viajes', x + ancho - 190, y + 4, { width: 50, align: 'right' })
    .text('Km', x + ancho - 140, y + 4, { width: 65, align: 'right' })
    .text('tCO2e', x + ancho - 70, y + 4, { width: 64, align: 'right' });
  y += 16;
  let zebra = false;
  for (const f of filas) {
    if (y > doc.page.height - 90) { doc.addPage(); y = 60; }
    if (zebra) doc.rect(x, y, ancho, 15).fill(LIGHT);
    zebra = !zebra;
    doc.font('Helvetica').fontSize(8).fillColor(NAVY)
      .text(f.nombre, x + 6, y + 3, { width: ancho - 200 })
      .text(nfp(f.n_viajes), x + ancho - 190, y + 3, { width: 50, align: 'right' })
      .text(nf(f.km, 1), x + ancho - 140, y + 3, { width: 65, align: 'right' })
      .text(nf(f.co2e, 3), x + ancho - 70, y + 3, { width: 64, align: 'right' });
    y += 15;
  }
  return y + 14;
}

function tablaViajes(doc, x, y, ancho, viajes) {
  if (y > doc.page.height - 140) { doc.addPage(); y = 60; }
  doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text('Detalle de traslados', x, y, { width: ancho });
  y = doc.y + 8;
  if (!viajes?.length) {
    doc.font('Helvetica').fontSize(9).fillColor(GRAY).text('Sin traslados en este período.', x, y);
    return doc.y + 12;
  }
  doc.rect(x, y, ancho, 16).fill(NAVY);
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff')
    .text('Fecha', x + 6, y + 4, { width: 55 })
    .text('Trayecto', x + 64, y + 4, { width: ancho - 260 })
    .text('Modo', x + ancho - 190, y + 4, { width: 60 })
    .text('Km', x + ancho - 120, y + 4, { width: 50, align: 'right' })
    .text('tCO2e', x + ancho - 70, y + 4, { width: 64, align: 'right' });
  y += 16;
  let zebra = false;
  for (const v of viajes) {
    if (y > doc.page.height - 90) { doc.addPage(); y = 60; }
    if (zebra) doc.rect(x, y, ancho, 15).fill(LIGHT);
    zebra = !zebra;
    const { dia, mes } = fechaLocal(v.fecha);
    doc.font('Helvetica').fontSize(7.5).fillColor(NAVY)
      .text(`${String(dia).padStart(2, '0')}-${MESES[mes]}`, x + 6, y + 3, { width: 55 })
      // '->' en vez de '→': la fuente estándar Helvetica/WinAnsi de PDFKit
      // no trae el glifo de flecha (U+2192) y lo mostraría corrupto.
      .text(`${v.origen} -> ${v.destino}${v.ida_vuelta ? ' (i/v)' : ''}`, x + 64, y + 3, { width: ancho - 260 })
      .text(v.modo_nombre, x + ancho - 190, y + 3, { width: 60 })
      .text(nf(v.km, 0), x + ancho - 120, y + 3, { width: 50, align: 'right' })
      .text(nf(v.co2e, 3), x + ancho - 70, y + 3, { width: 64, align: 'right' });
    y += 15;
  }
  return y + 14;
}

export async function generateInformeTransporte({ empresa, periodo, viajes, resumen }) {
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
  const M = 48;
  const W = doc.page.width - M * 2;

  drawLogo(doc, M, 44);
  doc.font('Helvetica').fontSize(9).fillColor(GRAY)
    .text(`CT-${(periodo || '').replace('-', '')} · Emitido el ${fechaCorta(new Date())}`, M, 50, { width: W, align: 'right' });

  doc.font('Helvetica-Bold').fontSize(16).fillColor(NAVY)
    .text('Transporte de personal', M, 96, { width: W });
  doc.font('Helvetica').fontSize(10.5).fillColor(GRAY)
    .text(`Alcance 3 · Categoría 7 (GHG Protocol) — traslados del período ${periodo}`, M, doc.y + 4, { width: W });

  doc.roundedRect(M, 148, W, 46, 8).fillAndStroke(LIGHT, BORDER);
  doc.font('Helvetica').fontSize(9).fillColor(GRAY).text('EMPRESA', M + 16, 160);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY)
    .text(`${empresa?.nombre_empresa || ''}  ·  ${formatearRut(empresa?.rut)}`, M + 16, 173);

  let y = 216;
  doc.roundedRect(M, y, W, 60, 8).fillAndStroke('#f0fdfa', '#14b8a6');
  doc.font('Helvetica-Bold').fontSize(18).fillColor(NAVY).text(`${nf(resumen.total.co2e, 3)} tCO2e`, M + 16, y + 10);
  doc.font('Helvetica').fontSize(9).fillColor(GRAY).text(
    `${nfp(resumen.total.n_viajes)} traslado${resumen.total.n_viajes === 1 ? '' : 's'} · ${nf(resumen.total.km, 1)} km recorridos en total.`,
    M + 16, y + 36, { width: W - 32 }
  );
  y += 76;

  y = tablaPorModo(doc, M, y, W, resumen.por_modo);
  y = tablaViajes(doc, M, y, W, viajes);

  // Límites declarados — mismo criterio de honestidad que el informe SII:
  // qué cubre este número y qué no, a la vista, no deducido.
  if (y > doc.page.height - 200) { doc.addPage(); y = 60; }
  doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY)
    .text('Límites y exclusiones declaradas', M, y, { width: W });
  y = doc.y + 6;
  const LIMITES = [
    'Cobertura: solo los traslados que la propia empresa registró en sicr3p para este período — '
      + 'no incluye desplazamientos no declarados.',
    'Factores por modo (bus/camioneta/auto/tren/avión) son referenciales — validar con la fuente '
      + 'oficial (HuellaChile / DEFRA) antes de reportar; quedan citados en el panel de Transporte.',
    'Sin desglose por gas individual (CO2, CH4, N2O).',
  ];
  doc.font('Helvetica').fontSize(8).fillColor(GRAY);
  for (const l of LIMITES) {
    if (y > doc.page.height - 100) { doc.addPage(); y = 60; }
    doc.text(`• ${l}`, M, y, { width: W });
    y = doc.y + 4;
  }

  avisoNoVerificacion(doc, M, doc.page.height - 54, W);
  return bufferDoc(doc);
}

// ---------- REP — Trazabilidad integrada (escaneo 360) ----------
// Cuatro perspectivas del mismo envase declarado, en un solo documento:
// composición (qué declaró la empresa) → ventas (qué facturó, pegado a
// esos productos) → validación RCV (¿el SII conoce esas ventas?) →
// evidencia fotográfica + hashes de integridad (¿hay respaldo verificable
// de cada pieza?). A diferencia de otros informes de sicr3p (lotes,
// corredor), la declaración REP del proveedor NO está en la cadena de
// hash pública (CADENA.NINGUNA — ver inventarioDatos.js): es un insumo
// para la declaración de la EMPRESA ante RETC/SGR, no una atestación
// propia de sicr3p, así que este documento no lleva QR de verificación
// pública — sería prometer una cadena que no existe.
function tablaComposicionRep(doc, x, y, ancho, productos) {
  doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text('1. Composición declarada', x, y, { width: ancho });
  y = doc.y + 4;
  doc.font('Helvetica').fontSize(8).fillColor(GRAY)
    .text('Catálogo vigente de productos con la composición de su envase, tal como está declarado hoy.', x, y, { width: ancho });
  y = doc.y + 8;
  if (!productos?.length) {
    doc.font('Helvetica').fontSize(9).fillColor(GRAY).text('Sin productos en el catálogo.', x, y);
    return doc.y + 12;
  }
  doc.rect(x, y, ancho, 16).fill(NAVY);
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff')
    .text('Producto', x + 6, y + 4, { width: ancho - 260 })
    .text('Envase (g/u)', x + ancho - 250, y + 4, { width: 80, align: 'right' })
    .text('% reciclable', x + ancho - 160, y + 4, { width: 80, align: 'right' })
    .text('Nivel', x + ancho - 70, y + 4, { width: 64, align: 'right' });
  y += 16;
  let zebra = false;
  for (const p of productos) {
    if (y > doc.page.height - 90) { doc.addPage(); y = 60; }
    if (zebra) doc.rect(x, y, ancho, 15).fill(LIGHT);
    zebra = !zebra;
    doc.font('Helvetica').fontSize(8).fillColor(NAVY)
      .text(`${p.nombre}${p.activo ? '' : ' (inactivo)'}`, x + 6, y + 3, { width: ancho - 260 })
      .text(nf(p.peso_total_gr, 1), x + ancho - 250, y + 3, { width: 80, align: 'right' })
      .text(nf(p.porcentaje, 1), x + ancho - 160, y + 3, { width: 80, align: 'right' })
      .text(p.nivel, x + ancho - 70, y + 3, { width: 64, align: 'right' });
    y += 15;
  }
  return y + 14;
}

function tablaVentasRep(doc, x, y, ancho, ventas) {
  if (y > doc.page.height - 140) { doc.addPage(); y = 60; }
  doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text('2. Ventas del período y validación RCV', x, y, { width: ancho });
  y = doc.y + 4;
  doc.font('Helvetica').fontSize(8).fillColor(GRAY)
    .text('Cada factura pegada a productos del catálogo, contrastada contra el RCV que la empresa descargó del SII.', x, y, { width: ancho });
  y = doc.y + 8;
  if (!ventas?.length) {
    doc.font('Helvetica').fontSize(9).fillColor(GRAY).text('Sin ventas registradas en este período.', x, y);
    return doc.y + 12;
  }
  doc.rect(x, y, ancho, 16).fill(NAVY);
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff')
    .text('Documento', x + 6, y + 4, { width: 120 })
    .text('Fecha', x + 130, y + 4, { width: 60 })
    .text('Kg envase', x + ancho - 160, y + 4, { width: 80, align: 'right' })
    .text('¿En RCV?', x + ancho - 70, y + 4, { width: 64, align: 'right' });
  y += 16;
  let zebra = false;
  const ENRCV = { true: 'Sí', false: 'No', null: 'Sin datos' };
  for (const v of ventas) {
    if (y > doc.page.height - 90) { doc.addPage(); y = 60; }
    if (zebra) doc.rect(x, y, ancho, 15).fill(LIGHT);
    zebra = !zebra;
    doc.font('Helvetica').fontSize(8).fillColor(NAVY)
      .text(v.numero_documento || '—', x + 6, y + 3, { width: 120 })
      .text(fechaCorta(new Date(v.fecha_documento)), x + 130, y + 3, { width: 60 })
      .text(nf(v.kg_envases, 2), x + ancho - 160, y + 3, { width: 80, align: 'right' })
      .fillColor(v.consta_en_rcv === false ? '#b45309' : NAVY)
      .text(ENRCV[String(v.consta_en_rcv)], x + ancho - 70, y + 3, { width: 64, align: 'right' })
      .fillColor(NAVY);
    y += 15;
  }
  return y + 14;
}

// Miniaturas de la evidencia fotográfica guardada por producto — solo
// jpg/png (formatos que PDFKit sabe decodificar; webp no).
function seccionFotosRep(doc, x, y, ancho, productosConFoto) {
  if (!productosConFoto.length) return y;
  if (y > doc.page.height - 160) { doc.addPage(); y = 60; }
  doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text('3. Evidencia fotográfica del envase', x, y, { width: ancho });
  y = doc.y + 10;
  const LADO = 110;
  const GAP = 14;
  let colX = x;
  let filaAltoMax = 0;
  for (const p of productosConFoto) {
    if (colX + LADO > x + ancho) { colX = x; y += filaAltoMax + GAP; filaAltoMax = 0; }
    if (y + LADO + 20 > doc.page.height - 60) { doc.addPage(); y = 60; colX = x; }
    try {
      doc.image(p.foto_embalaje, colX, y, { width: LADO, height: LADO, fit: [LADO, LADO] });
    } catch {
      doc.roundedRect(colX, y, LADO, LADO, 6).fillAndStroke(LIGHT, BORDER);
      doc.font('Helvetica').fontSize(7).fillColor(GRAY)
        .text('Formato no visualizable en PDF', colX + 8, y + LADO / 2 - 10, { width: LADO - 16, align: 'center' });
    }
    doc.font('Helvetica').fontSize(7.5).fillColor(GRAY)
      .text(p.nombre, colX, y + LADO + 4, { width: LADO });
    colX += LADO + GAP;
    filaAltoMax = LADO + 20;
  }
  return y + filaAltoMax + 14;
}

function seccionIntegridadRep(doc, x, y, ancho, hashes) {
  if (y > doc.page.height - 140) { doc.addPage(); y = 60; }
  doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text('4. Integridad de la evidencia', x, y, { width: ancho });
  y = doc.y + 4;
  doc.font('Helvetica').fontSize(8).fillColor(GRAY)
    .text('SHA-256 de cada archivo original tal como se subió — permite comprobar que el archivo no fue alterado.', x, y, { width: ancho });
  y = doc.y + 8;
  if (!hashes.length) {
    doc.font('Helvetica').fontSize(9).fillColor(GRAY).text('Sin archivos con hash registrado en este período.', x, y);
    return doc.y + 12;
  }
  doc.font('Courier').fontSize(7.5).fillColor(GRAY);
  for (const h of hashes) {
    if (y > doc.page.height - 80) { doc.addPage(); y = 60; }
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(NAVY).text(h.etiqueta, x, y, { width: ancho, continued: true })
      .font('Courier').fillColor(GRAY).text(`  ${h.sha256}`);
    y = doc.y + 3;
  }
  return y + 10;
}

export async function generateReporteRepTrazabilidad({ empresa, periodo, productos, ventas, resumen }) {
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
  const M = 48;
  const W = doc.page.width - M * 2;

  drawLogo(doc, M, 44);
  doc.font('Helvetica').fontSize(9).fillColor(GRAY)
    .text(`Emitido el ${fechaCorta(new Date())}`, M, 50, { width: W, align: 'right' });

  doc.font('Helvetica-Bold').fontSize(16).fillColor(NAVY)
    .text('Trazabilidad Ley REP — Escaneo 360', M, 96, { width: W });
  doc.font('Helvetica').fontSize(10.5).fillColor(GRAY)
    .text(`Ley 20.920 — período ${periodo || 'todo el catálogo'}`, M, doc.y + 4, { width: W });

  doc.roundedRect(M, 148, W, 46, 8).fillAndStroke(LIGHT, BORDER);
  doc.font('Helvetica').fontSize(9).fillColor(GRAY).text('EMPRESA', M + 16, 160);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY)
    .text(`${empresa?.nombre_empresa || ''}  ·  ${formatearRut(empresa?.rut)}`, M + 16, 173);

  let y = 216;
  doc.roundedRect(M, y, W, 60, 8).fillAndStroke('#f0fdfa', '#14b8a6');
  doc.font('Helvetica-Bold').fontSize(18).fillColor(NAVY).text(`${nf(resumen.total.kg_envases, 2)} kg`, M + 16, y + 10);
  doc.font('Helvetica').fontSize(9).fillColor(GRAY).text(
    `${nf(resumen.total.kg_reciclables, 2)} kg reciclables · ${nfp(resumen.total.n_ventas)} venta${resumen.total.n_ventas === 1 ? '' : 's'} pegada${resumen.total.n_ventas === 1 ? '' : 's'} a productos.`,
    M + 16, y + 36, { width: W - 32 }
  );
  y += 76;

  y = tablaComposicionRep(doc, M, y, W, productos);
  y = tablaVentasRep(doc, M, y, W, ventas);

  const productosConFoto = productos.filter((p) => p.foto_embalaje);
  y = seccionFotosRep(doc, M, y, W, productosConFoto);

  const hashes = [
    ...productosConFoto.map((p) => ({ etiqueta: `Foto — ${p.nombre}`, sha256: p.foto_sha256 })),
    ...ventas.filter((v) => v.sha256).map((v) => ({ etiqueta: `Factura ${v.numero_documento || v.id.slice(0, 8)}`, sha256: v.sha256 })),
  ];
  y = seccionIntegridadRep(doc, M, y, W, hashes);

  if (y > doc.page.height - 100) { doc.addPage(); y = 60; }
  doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text('Alcance de este documento', M, y, { width: W });
  y = doc.y + 6;
  const LIMITES_REP = [
    'La declaración formal de envases y embalajes ante el MMA (RETC/SGR) la hace la empresa — '
      + 'sicr3p prepara el insumo, no declara ni certifica en su nombre.',
    'La validación RCV solo puede afirmar algo de los períodos con RCV descargado: "Sin datos" no '
      + 'es un error, es la ausencia de esa descarga.',
    'La foto de evidencia es la que la empresa decidió guardar al declarar el producto — no es una '
      + 'auditoría independiente del envase.',
  ];
  doc.font('Helvetica').fontSize(8).fillColor(GRAY);
  for (const l of LIMITES_REP) {
    if (y > doc.page.height - 90) { doc.addPage(); y = 60; }
    doc.text(`• ${l}`, M, y, { width: W });
    y = doc.y + 4;
  }

  // Pie propio (no avisoNoVerificacion/AVISO_NO_VERIFICACION): ese aviso
  // es específico de informes que declaran EMISIONES ("factores de
  // emisión", ISO 14064-3) — este documento no calcula CO2e, así que
  // reutilizarlo mencionaría algo que no está en el PDF y confundiría a
  // quien lo lea.
  doc.font('Helvetica').fontSize(7.5).fillColor(GRAY).text(
    'Este documento reúne evidencia declarada por la empresa en sicr3p — no constituye una '
      + 'verificación de tercera parte acreditada ni una auditoría independiente del envase.',
    M, doc.page.height - 54, { width: W }
  );
  return bufferDoc(doc);
}

// ---------- CREDENCIAL VIRTUAL — Firma del actor de la cadena (atestación) ----------
// IMPORTANTE (honestidad, ver migraciones 038/039): esto NO es una firma
// electrónica con validez legal (Ley N° 19.799 de Chile). Es una
// atestación sellada por hash: confirma que el titular de esta credencial
// (identidad fijada por quien la emitió) registró SU eslabón (rol
// 'proveedor' o 'puerto', según el tipo de lote) en la cadena de custodia.
// sicr3p no certifica ni verifica la identidad del firmante más allá de
// la credencial entregada.
const ROL_CREDENCIAL_LABEL = { proveedor: 'PROVEEDOR', puerto: 'PUERTO' };
const ROL_CREDENCIAL_EMPRESA_LABEL = { proveedor: 'Empresa proveedora', puerto: 'Autoridad portuaria' };

export async function generateCredencialProveedor({ credencial, lote }) {
  const doc = new PDFDocument({ size: [420, 260], margin: 0 });
  const qr = await qrBufferDe(firmaProveedorUrl(credencial.serial));
  const rolLabel = ROL_CREDENCIAL_LABEL[credencial.rol] || ROL_CREDENCIAL_LABEL.proveedor;
  const empresaLabel = ROL_CREDENCIAL_EMPRESA_LABEL[credencial.rol] || ROL_CREDENCIAL_EMPRESA_LABEL.proveedor;

  // Fondo
  doc.rect(0, 0, 420, 260).fill('#ffffff');
  doc.roundedRect(8, 8, 404, 244, 12).lineWidth(1.5).stroke(BORDER);

  // Encabezado
  drawLogo(doc, 24, 24, 20);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(GREEN)
    .text(`CREDENCIAL DE FIRMA · ${rolLabel}`, 24, 50, { lineBreak: false });
  doc.font('Helvetica').fontSize(7.5).fillColor(GRAY)
    .text(' · Pasaporte de Origen', doc.x, 51, { lineBreak: false });

  // Serial protagonista
  doc.font('Courier-Bold').fontSize(24).fillColor(NAVY).text(credencial.serial, 24, 74);

  // Datos de la credencial — 4 filas en el mismo espacio que el molde de
  // 3 filas de la Tarjeta de Viaje (menor paso vertical, para no invadir
  // la caja de disclaimer que empieza en y=200).
  let y = 106;
  const fila = (label, value) => {
    doc.font('Helvetica').fontSize(7).fillColor(GRAY).text(label.toUpperCase(), 24, y);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(NAVY)
      .text(String(value || '—').slice(0, 40), 24, y + 9, { width: 235 });
    y += 21;
  };
  fila('Lote', lote.codigo);
  fila('Material', MATERIAL_EXPEDIENTE[lote.material] || lote.material);
  fila(empresaLabel, credencial.nombre_empresa);
  fila('RUT', credencial.rut_empresa);

  // QR grande — el corazón de la credencial
  doc.image(qr, 282, 62, { width: 118, height: 118 });
  doc.font('Helvetica').fontSize(6.5).fillColor(GRAY)
    .text('Escanee para ver el estado de la credencial', 274, 184, { width: 134, align: 'center' });

  // Pie — disclaimer de honestidad, obligatorio
  doc.roundedRect(24, 200, 372, 40, 8).fill(LIGHT);
  doc.font('Helvetica').fontSize(6.7).fillColor(NAVY).text(
    'Esta credencial NO es una firma electrónica con validez legal (Ley N° 19.799). Es una atestación ' +
    'sellada con hash: quien tenga la clave entregada junto con esta credencial firma UNA sola vez el ' +
    `eslabón "${(credencial.rol || 'proveedor')}" de este lote, con la identidad indicada arriba (fijada al emitir la credencial).`,
    34, 205, { width: 352 }
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
      // La carpeta se imprime y se le entrega en papel al mandante: cada
      // documento dice su categoría solo si el motor la dedujo de su glosa.
      .text(categoriaParaMostrar(f).detalle.slice(0, 40), bx + 12, by + 28, { width: CAJA_W - 110 })
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
      .text('Datos derivados de documentos ya procesados por sicr3p.', 48, cy, { width: W });
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
  const pyPie = Math.max(py, 620);
  doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(
    'sicr3p registra, calcula y sella datos desde los documentos tributarios reales del presentador, con integridad ' +
    'garantizada por una cadena de hash pública. Esta carpeta se emitió para acompañar una entrega física; su versión ' +
    'digital siempre prevalece.',
    48, pyPie, { width: W }
  );
  avisoNoVerificacion(doc, 48, pyPie + 34, W);

  return bufferDoc(doc);
}

// ---------- CONSTANCIA DE CAPACITACIÓN ----------
// Diploma A4 apaisado para un operador que aprobó un curso interno
// (ver services/capacitacion.js). El QR apunta a /constancia/{serial} —
// verificación pública, sin login, igual que la credencial de tarjeta
// de viaje. Nunca se llama "certificación": es participación interna.
export async function generateConstanciaCurso({ constancia, curso, usuario }) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0 });
  const W = doc.page.width;
  const H = doc.page.height;
  const qr = await qrBufferDe(constanciaUrl(constancia.serial));

  doc.rect(0, 0, W, H).fill('#ffffff');
  doc.roundedRect(24, 24, W - 48, H - 48, 6).lineWidth(2).stroke(GREEN);
  doc.roundedRect(34, 34, W - 68, H - 68, 4).lineWidth(0.75).stroke(BORDER);

  drawLogo(doc, 60, 66, 22);
  doc.font('Helvetica').fontSize(9).fillColor(GRAY)
    .text(constancia.serial, W - 220, 68, { width: 160, align: 'right' });
  // Sello "Instituto sicr3p": lockup de marca bajo el logo, la línea de
  // formación de sicr3p (ver docs/instituto/PLAN-INSTITUTO-SICR3P.md).
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(GREEN)
    .text('INSTITUTO SICR3P', 60, 94, { width: 220, characterSpacing: 1 });
  doc.font('Helvetica').fontSize(6.5).fillColor(GRAY)
    .text('La línea de formación de sicr3p', 60, 103, { width: 220 });

  doc.font('Helvetica-Bold').fontSize(11).fillColor(GREEN)
    .text('CONSTANCIA DE PARTICIPACIÓN', 0, 130, { width: W, align: 'center', characterSpacing: 1.5 });
  doc.font('Helvetica').fontSize(11).fillColor(GRAY)
    .text('Se otorga a', 0, 168, { width: W, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(26).fillColor(NAVY)
    .text(String(usuario?.nombre || '—'), 0, 190, { width: W, align: 'center' });
  doc.font('Helvetica').fontSize(11).fillColor(GRAY)
    .text('por completar el curso interno', 0, 232, { width: W, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(17).fillColor(NAVY)
    .text(String(curso?.titulo || '—'), 60, 254, { width: W - 120, align: 'center' });
  doc.font('Helvetica').fontSize(10).fillColor(GRAY)
    .text(`Evaluación aprobada con ${nfp(constancia.puntaje_pct)}% · ${fechaCorta(constancia.emitida_at)}`,
      0, 288, { width: W, align: 'center' });

  doc.image(qr, W - 190, H - 190, { width: 100, height: 100 });
  doc.font('Helvetica').fontSize(7).fillColor(GRAY)
    .text('Escanee para verificar', W - 190, H - 84, { width: 100, align: 'center' });

  doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(
    'Constancia de participación interna emitida por el Instituto sicr3p — la línea de formación ' +
    'de sicr3p. Verificable con el QR o en sicr3p.cl/constancia/' + constancia.serial + '.',
    60, H - 76, { width: W - 260 }
  );

  return bufferDoc(doc);
}

// ---------- CONTRATO DE SERVICIO ----------
// Documento multipágina de texto: el cuerpo lo arma services/contrato.js
// (puro y versionado) y aquí solo se maqueta. Las cláusulas con un vacío
// por resolver se imprimen marcadas: un contrato en borrador tiene que
// verse como borrador, no disimularlo.
export async function generateContrato({ contrato, clausulas, pendientes = [], titulo = 'CONTRATO DE SERVICIO', codigo = '' }) {
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  const W = doc.page.width;
  const M = 48;
  const ANCHO = W - M * 2;
  const borrador = contrato?.estado === 'borrador';

  drawLogo(doc, M, 44);
  doc.font('Helvetica').fontSize(9).fillColor(GRAY)
    .text(`${contrato?.numero || ''} · ${codigo || 'plantilla'} ${contrato?.plantilla_version || ''}`,
      M, 50, { width: ANCHO, align: 'right' });

  doc.moveDown(2);
  doc.font('Helvetica-Bold').fontSize(14).fillColor(NAVY)
    .text(titulo, M, 92, { width: ANCHO });
  doc.font('Helvetica').fontSize(10).fillColor(GRAY)
    .text(`Emitido el ${fechaCorta(contrato?.created_at)}`, M, doc.y + 4, { width: ANCHO });

  let y = doc.y + 16;

  if (borrador) {
    const alto = 56;
    doc.roundedRect(M, y, ANCHO, alto, 4).fillAndStroke('#fff7ed', '#f59e0b');
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#b45309')
      .text('BORRADOR — NO FIRMAR', M + 12, y + 10, { width: ANCHO - 24 });
    doc.font('Helvetica').fontSize(8.5).fillColor('#92400e').text(
      'Este documento se genera automáticamente al dar de alta la empresa, con las condiciones ya ' +
      'decididas. Las cláusulas marcadas siguen con puntos por definir y requieren revisión legal ' +
      'antes de firmar.',
      M + 12, y + 24, { width: ANCHO - 24 }
    );
    y += alto + 18;
  }

  for (const c of clausulas || []) {
    if (y > doc.page.height - 140) { doc.addPage(); y = M; }
    doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY)
      .text(`${c.n}. ${c.titulo}`, M, y, { width: ANCHO });
    y = doc.y + 2;
    if (c.pendiente) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#b45309')
        .text('PENDIENTE DE REVISIÓN LEGAL', M, y, { width: ANCHO });
      y = doc.y + 2;
    }
    for (const p of c.parrafos || []) {
      if (y > doc.page.height - 110) { doc.addPage(); y = M; }
      doc.font('Helvetica').fontSize(9.5).fillColor(NAVY)
        .text(p, M, y, { width: ANCHO, align: 'justify' });
      y = doc.y + 5;
    }
    y += 8;
  }

  if (pendientes.length) {
    if (y > doc.page.height - 200) { doc.addPage(); y = M; }
    doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY)
      .text('Puntos por definir antes de firmar', M, y, { width: ANCHO });
    y = doc.y + 6;
    for (const p of pendientes) {
      doc.font('Helvetica').fontSize(9.5).fillColor(GRAY)
        .text(`•  ${p}`, M + 8, y, { width: ANCHO - 8 });
      y = doc.y + 3;
    }
    y += 12;
  }

  if (y > doc.page.height - 150) { doc.addPage(); y = M; }
  doc.font('Helvetica').fontSize(9.5).fillColor(NAVY)
    .text('Firmas', M, y, { width: ANCHO });
  y = doc.y + 34;
  doc.moveTo(M, y).lineTo(M + 200, y).lineWidth(0.75).stroke(BORDER);
  doc.moveTo(W - M - 200, y).lineTo(W - M, y).stroke(BORDER);
  doc.font('Helvetica').fontSize(8).fillColor(GRAY)
    .text('sicr3p SpA', M, y + 6, { width: 200 })
    .text(contrato?.datos?.razon_social || 'El cliente', W - M - 200, y + 6, { width: 200, align: 'right' });

  doc.font('Helvetica').fontSize(7.5).fillColor(GRAY).text(
    `Sello del documento (SHA-256): ${contrato?.hash_documento || ''}. Acredita que este PDF corresponde ` +
    'a estas condiciones y a esta versión de plantilla; no es una firma electrónica con validez legal ' +
    '(Ley N° 19.799) ni una certificación de terceros.',
    M, doc.page.height - 78, { width: ANCHO }
  );

  return bufferDoc(doc);
}

// ---------- ESTADO DE AVANCE APL ----------
// Registro interno del avance de un Acuerdo de Producción Limpia.
// El disclaimer del pie es parte del contrato de honestidad: la
// certificación de cumplimiento la otorga la auditoría del sistema
// APL, nunca este documento.
const ESTADO_APL = {
  adherido: 'Adherido', en_implementacion: 'En implementación',
  en_auditoria: 'En auditoría', certificado: 'Certificado', cerrado: 'Cerrado',
};
const ESTADO_META_APL = {
  pendiente: 'Pendiente', en_avance: 'En avance', cumplida: 'Cumplida', no_aplica: 'No aplica',
};

export async function generateInformeApl({ acuerdo, metas = [], resumen = {}, evidencia = {} }) {
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });

  // Encabezado
  drawLogo(doc, 48, 44);
  doc.font('Helvetica').fontSize(9).fillColor(GRAY)
    .text('Contabilidad de carbono trazable', 48, 74)
    .text(`Emitido: ${fechaCorta(new Date())}`, 400, 46, { width: 147, align: 'right' });
  doc.moveTo(48, 92).lineTo(547, 92).strokeColor(BORDER).stroke();

  doc.font('Helvetica-Bold').fontSize(18).fillColor(NAVY)
    .text('Estado de avance — Acuerdo de Producción Limpia', 48, 106);
  doc.font('Helvetica').fontSize(10).fillColor(GRAY)
    .text('Registro interno de seguimiento', 48, 130);

  // Datos del acuerdo
  let y = 156;
  doc.roundedRect(48, y, 499, 74, 8).fillAndStroke(LIGHT, BORDER);
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10);
  doc.text('Empresa', 64, y + 12);
  doc.text('RUT', 300, y + 12);
  doc.text('Estado', 420, y + 12);
  doc.font('Helvetica').fontSize(10.5).fillColor(NAVY);
  doc.text(acuerdo.nombre_empresa || '—', 64, y + 26, { width: 220 });
  doc.text(acuerdo.cliente_rut || '—', 300, y + 26, { width: 110 });
  doc.text(ESTADO_APL[acuerdo.estado] || acuerdo.estado, 420, y + 26, { width: 115 });
  doc.font('Helvetica-Bold').fontSize(10).text('Acuerdo', 64, y + 44);
  doc.font('Helvetica').fontSize(10)
    .text(`${acuerdo.nombre}${acuerdo.sector ? ` · ${acuerdo.sector}` : ''}${acuerdo.fecha_adhesion ? ` · adhesión ${fechaCorta(acuerdo.fecha_adhesion)}` : ''}`,
      130, y + 44, { width: 400 });

  // Resumen de metas
  y += 90;
  const total = resumen.total || 0;
  doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY).text('Metas y acciones', 48, y);
  doc.font('Helvetica').fontSize(9.5).fillColor(GRAY)
    .text(total
      ? `${total} registradas · ${resumen.cumplida || 0} cumplidas · ${resumen.en_avance || 0} en avance · ${resumen.pendiente || 0} pendientes${resumen.no_aplica ? ` · ${resumen.no_aplica} no aplican` : ''}`
      : 'Sin metas registradas todavía.', 48, y + 16);

  // Tabla de metas
  y += 38;
  if (metas.length) {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(GRAY);
    doc.text('N°', 48, y, { width: 50 });
    doc.text('META / ACCIÓN', 100, y, { width: 245 });
    doc.text('ESTADO', 350, y, { width: 70 });
    doc.text('EVIDENCIA', 424, y, { width: 123 });
    y += 14;
    doc.moveTo(48, y - 3).lineTo(547, y - 3).strokeColor(BORDER).stroke();
    for (const m of metas) {
      const hDesc = doc.font('Helvetica').fontSize(9).heightOfString(m.descripcion, { width: 245 });
      const hEvi = doc.fontSize(8.5).heightOfString(m.evidencia || '—', { width: 123 });
      const hFila = Math.max(hDesc, hEvi, 12) + 8;
      if (y + hFila > doc.page.height - 120) { doc.addPage(); y = 60; }
      doc.font('Helvetica').fontSize(9).fillColor(NAVY);
      doc.text(m.numero || '—', 48, y, { width: 50 });
      doc.text(m.descripcion, 100, y, { width: 245 });
      doc.fillColor(m.estado === 'cumplida' ? GREEN : NAVY)
        .text(ESTADO_META_APL[m.estado] || m.estado, 350, y, { width: 70 });
      doc.fillColor(GRAY).fontSize(8.5)
        .text(m.evidencia || '—', 424, y, { width: 123 });
      y += hFila;
    }
  }

  // Evidencia disponible en la plataforma
  if (y > doc.page.height - 210) { doc.addPage(); y = 60; }
  y += 14;
  doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY).text('Evidencia disponible en sicr3p', 48, y);
  doc.font('Helvetica').fontSize(9.5).fillColor(GRAY).text(
    'Lo que la plataforma ya tiene registrado para este RUT y puede respaldar documentalmente:',
    48, y + 16, { width: 499 }
  );
  y += 36;
  doc.roundedRect(48, y, 499, 54, 8).fillAndStroke(LIGHT, BORDER);
  doc.font('Helvetica-Bold').fontSize(15).fillColor(NAVY);
  doc.text(String(evidencia.documentos ?? 0), 64, y + 10, { width: 110 });
  doc.text(nf(evidencia.co2e_total_kg ?? 0, 2), 190, y + 10, { width: 140 });
  doc.text(String(evidencia.declaraciones_rep ?? 0), 350, y + 10, { width: 110 });
  doc.font('Helvetica').fontSize(8).fillColor(GRAY);
  doc.text('documentos procesados', 64, y + 32, { width: 110 });
  doc.text('kg CO2e calculados (factor citado)', 190, y + 32, { width: 150 });
  doc.text('declaraciones REP registradas', 350, y + 32, { width: 140 });

  // Pie de honestidad
  doc.font('Helvetica').fontSize(7.5).fillColor(GRAY).text(
    'Este documento es un registro interno de seguimiento generado por sicr3p a partir de lo que el propio ' +
    'equipo registró. NO acredita ni certifica el cumplimiento del Acuerdo de Producción Limpia: la evaluación ' +
    'de conformidad y el certificado de cumplimiento los otorga el sistema APL a través de su proceso de ' +
    'auditoría. Los datos de evidencia son agregados contables de la plataforma, verificables documento a documento.',
    48, doc.page.height - 100, { width: 499 }
  );

  return bufferDoc(doc);
}
