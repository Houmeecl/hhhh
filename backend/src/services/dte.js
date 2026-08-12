// ============================================================
// Verificador local de DTE (Documento Tributario Electrónico, SII Chile).
// Parser sin dependencias: extrae los campos del XML para trazabilidad
// real (RUT emisor/receptor, folio, montos, detalle). No requiere red.
// ============================================================

// Extrae el contenido del primer tag <name>…</name> dentro de un bloque.
function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1].trim() : null;
}

// Extrae todos los bloques <name>…</name>.
function tags(xml, name) {
  const out = [];
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'gi');
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
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
