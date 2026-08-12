// ============================================================
// Verificador local de DTE (Documento Tributario Electrónico, SII Chile).
// Parser sin dependencias: extrae los campos del XML para trazabilidad
// real (RUT emisor/receptor, folio, montos, detalle). No requiere red.
// ============================================================

// Extrae el contenido del primer tag <name>…</name> dentro de un bloque.
//
// A propósito NO usa `<name(?:\s[^>]*)?>([\s\S]*?)</name>` de punta a
// punta: esa forma es O(n²) ante un XML con muchas aperturas del mismo
// tag sin su cierre (el motor reintenta el match completo desde cada
// posición fallida) — un archivo de unos cientos de KB con ese patrón
// bloquea el event loop por segundos, y esta función la alcanzan
// proveedores autenticados subiendo su propio XML (routes/informes.js,
// lecturaDocumento.js, transporteProveedor.js). Acá se ubica la apertura
// con una regex simple (sin backtracking posible: no hay cuantificador
// anidado) y el cierre con `indexOf` plano — ambos O(n), sin importar
// cuántas aperturas huérfanas traiga el resto del documento.
function tag(xml, name) {
  const openRe = new RegExp(`<${name}(?:\\s[^>]*)?>`, 'i');
  const open = xml.match(openRe);
  if (!open) return null;
  const start = open.index + open[0].length;
  const closeIdx = xml.toLowerCase().indexOf(`</${name.toLowerCase()}>`, start);
  if (closeIdx === -1) return null;
  return xml.slice(start, closeIdx).trim();
}

// Extrae todos los bloques <name>…</name> — mismo criterio O(n) que tag()
// de arriba: cada iteración avanza `lastIndex` hasta DESPUÉS del cierre
// encontrado, así que ningún tramo del string se vuelve a escanear.
function tags(xml, name) {
  const out = [];
  const openRe = new RegExp(`<${name}(?:\\s[^>]*)?>`, 'gi');
  const closeTag = `</${name}>`;
  const xmlLower = xml.toLowerCase();
  const closeTagLower = closeTag.toLowerCase();
  let m;
  while ((m = openRe.exec(xml)) !== null) {
    const start = m.index + m[0].length;
    const closeIdx = xmlLower.indexOf(closeTagLower, start);
    if (closeIdx === -1) break;
    out.push(xml.slice(start, closeIdx));
    openRe.lastIndex = closeIdx + closeTag.length;
  }
  return out;
}

const TIPOS_DTE = {
  33: 'Factura electrónica',
  34: 'Factura no afecta o exenta',
  39: 'Boleta electrónica',
  41: 'Boleta exenta',
  43: 'Liquidación de factura',
  46: 'Factura de compra',
  52: 'Guía de despacho',
  56: 'Nota de débito',
  61: 'Nota de crédito',
  110: 'Factura de exportación',
};

// Valida el dígito verificador de un RUT (módulo 11).
export function rutValido(rut) {
  if (!rut) return false;
  const limpio = String(rut).replace(/[.\s]/g, '').toUpperCase();
  const m = limpio.match(/^(\d{1,9})-([\dK])$/);
  if (!m) return false;
  const [, cuerpo, dv] = m;
  let suma = 0, mult = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * mult;
    mult = mult === 7 ? 2 : mult + 1;
  }
  const resto = 11 - (suma % 11);
  const esperado = resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
  return dv === esperado;
}

/**
 * Parsea un XML de DTE y devuelve sus campos + verificaciones locales.
 * Devuelve null si el contenido no parece un DTE.
 */
export function parseDte(xmlText) {
  if (!xmlText || typeof xmlText !== 'string') return null;
  const xml = xmlText.replace(/^﻿/, '');
  if (!/<DTE[\s>]/i.test(xml) && !/<Documento[\s>]/i.test(xml)) return null;

  const enc = tag(xml, 'Encabezado') || xml;
  const idDoc = tag(enc, 'IdDoc') || enc;
  const emisor = tag(enc, 'Emisor') || '';
  const receptor = tag(enc, 'Receptor') || '';
  const totales = tag(enc, 'Totales') || '';
  // Solo presente en Guía de Despacho (tipo 52): quién transporta, en qué
  // patente, y el destino físico del despacho — que puede no ser la
  // dirección tributaria del receptor (<Receptor><DirRecep>) si la entrega
  // es en otra bodega/faena. En el resto de los DTE este bloque no existe
  // y todo lo de acá abajo queda null.
  const transporte = tag(enc, 'Transporte') || '';

  const tipoDte = Number(tag(idDoc, 'TipoDTE')) || null;
  const doc = {
    tipo_dte: tipoDte,
    tipo_nombre: TIPOS_DTE[tipoDte] || (tipoDte ? `DTE tipo ${tipoDte}` : 'Desconocido'),
    folio: tag(idDoc, 'Folio'),
    fecha_emision: tag(idDoc, 'FchEmis'),
    rut_emisor: tag(emisor, 'RUTEmisor'),
    razon_social_emisor: tag(emisor, 'RznSoc') || tag(emisor, 'RznSocEmisor'),
    giro_emisor: tag(emisor, 'GiroEmis') || tag(emisor, 'GiroEmisor'),
    rut_receptor: tag(receptor, 'RUTRecep'),
    razon_social_receptor: tag(receptor, 'RznSocRecep'),
    monto_neto: Number(tag(totales, 'MntNeto')) || 0,
    iva: Number(tag(totales, 'IVA')) || 0,
    monto_total: Number(tag(totales, 'MntTotal')) || 0,
    items: tags(xml, 'Detalle').map((d) => ({
      nombre: tag(d, 'NmbItem') || 'Ítem',
      descripcion: tag(d, 'DscItem'),
      cantidad: Number(tag(d, 'QtyItem')) || 1,
      unidad: tag(d, 'UnmdItem'),
      precio: Number(tag(d, 'PrcItem')) || 0,
      monto: Number(tag(d, 'MontoItem')) || 0,
    })),
    // Patente del vehículo de transporte (Guía de Despacho) — null en
    // cualquier otro tipo de DTE, que no trae este bloque.
    patente: tag(transporte, 'Patente'),
    direccion_origen: tag(transporte, 'DirOrigen') || tag(emisor, 'DirEmisor') || null,
    direccion_destino: [tag(transporte, 'DirDest'), tag(transporte, 'CmnaDest')]
      .filter(Boolean).join(', ') || tag(receptor, 'DirRecep') || null,
  };

  // Verificaciones locales (sin red SII).
  const sumaItems = doc.items.reduce((a, it) => a + it.monto, 0);
  const totalCalculado = doc.monto_neto + doc.iva;
  doc.verificaciones = {
    rut_emisor_valido: rutValido(doc.rut_emisor),
    rut_receptor_valido: rutValido(doc.rut_receptor),
    folio_presente: Boolean(doc.folio),
    fecha_valida: Boolean(doc.fecha_emision && !Number.isNaN(Date.parse(doc.fecha_emision))),
    // Neto+IVA ≈ total (tolerancia $2 por redondeos); si no hay neto/IVA no aplica.
    totales_consistentes: doc.monto_neto || doc.iva
      ? Math.abs(totalCalculado - doc.monto_total) <= 2
      : null,
    // Suma del detalle ≈ neto (cuando hay detalle y neto).
    detalle_consistente: doc.items.length && doc.monto_neto
      ? Math.abs(sumaItems - doc.monto_neto) <= 2
      : null,
    firma_presente: /<(TmstFirma|Signature|FRMT)[\s>]/i.test(xml),
  };
  const checks = Object.values(doc.verificaciones).filter((v) => v !== null);
  doc.verificacion_ok = checks.every(Boolean);
  return doc;
}
