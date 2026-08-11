// ============================================================
// Traduce los DTE que entrega Clay a la forma que consume el motor de
// cálculo. Funciones PURAS: no tocan la BD ni la red — el orquestador
// (routes/admin.js) trae los datos y persiste.
//
// Para qué existe: el flujo de siempre es "el cliente entrega sus
// documentos, uno por uno". Cuando son cientos de facturas de un período,
// eso no escala. Clay los tiene ya sincronizados desde el SII, así que se
// arman de una vez.
//
// TRES DECISIONES METODOLÓGICAS, explícitas porque cambian el resultado:
//
// 1. Se importan las COMPRAS (`is_received=true`), no las ventas. Lo que la
//    empresa compró son sus emisiones aguas arriba. Lo que vendió es
//    emisión de su cliente, no suya — contarlo sería doble conteo.
//
// 2. Se excluyen notas de crédito (61) y guías de despacho (52). Una nota
//    de crédito reduce un documento anterior y el motor no netea; una guía
//    de despacho acompaña mercadería que ya viene facturada aparte.
//    Incluirlas inflaría el total.
//
// 3. El método será POR GASTO, no físico, y no es una limitación de este
//    código: el detalle de línea de Clay trae `quantity`, `unit_price` y
//    `total_price`, pero NO la unidad de medida. Sin unidad no hay factor
//    físico que aplicar. Un XML DTE cargado directo sí trae unidad y sí
//    habilita el método físico. O sea: importar desde Clay da MÁS
//    documentos con MENOR precisión de método que cargar el XML. Es un
//    intercambio real y hay que decirlo, no esconderlo.
// ============================================================

// Códigos SII que no entran al cálculo de compras. Ver decisión 2.
export const SII_EXCLUIDOS = [61, 52];

// Marca que queda en `facturas.motor` (migración 044).
export const MOTOR_CLAY = 'propio_clay';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const rutCompleto = (parte) => {
  if (!parte?.rut) return null;
  return parte.dv ? `${parte.rut}-${parte.dv}` : String(parte.rut);
};

// Un DTE de Clay → los campos que `facturas` necesita.
export function datosDeDte(dte = {}) {
  return {
    clay_id: dte.id || null,
    numero_venta: dte.number ? `F-${dte.number}` : null,
    rut_emisor: rutCompleto(dte.issuer),
    rut_receptor: rutCompleto(dte.receiver),
    fecha: dte.issue_date ? String(dte.issue_date).slice(0, 10) : null,
    sii_code: dte.sii_code ?? null,
    tipo: dte.type || null,
    // Neto, no total: el IVA es un impuesto, no consumo. El motor calcula
    // por gasto sobre el valor del bien o servicio.
    neto: num(dte.total?.net),
    total: num(dte.total?.total),
  };
}

// Decide si un documento entra al cálculo. Devuelve el motivo cuando no,
// para poder informarlo en vez de descartar en silencio.
export function admiteDte(dte = {}) {
  const codigo = Number(dte.sii_code);
  if (SII_EXCLUIDOS.includes(codigo)) {
    return { admite: false, motivo: codigo === 61 ? 'nota de crédito' : 'guía de despacho' };
  }
  if (dte.is_received === false) return { admite: false, motivo: 'documento emitido (venta)' };
  if (num(dte.total?.net) <= 0 && num(dte.total?.total) <= 0) {
    return { admite: false, motivo: 'sin monto' };
  }
  return { admite: true, motivo: null };
}

// Líneas de Clay → ítems del motor. `unidad: null` siempre: Clay no
// entrega unidad de medida (ver decisión 3), y pasar una inventada sería
// habilitar un método físico sin sustento.
export function itemsDeLineas(lineas = []) {
  return lineas
    .map((l) => ({
      descripcion: l.description || l.item_name || 'Ítem sin descripción',
      cantidad: num(l.quantity) || null,
      monto: num(l.total_price),
      unidad: null,
    }))
    .filter((it) => it.monto > 0);
}

// Cuando Clay no devuelve el detalle de líneas de un documento, se calcula
// igual con un ítem único por el neto. Es exactamente lo que ya hace el
// parser de texto al colapsar una factura que no pudo desglosar: menos
// resolución, mismo total, nada inventado.
export function itemUnico(dte) {
  const d = datosDeDte(dte);
  const monto = d.neto > 0 ? d.neto : d.total;
  if (monto <= 0) return [];
  return [{
    descripcion: d.tipo ? `${d.tipo} ${d.numero_venta || ''}`.trim() : (d.numero_venta || 'Documento'),
    cantidad: null,
    monto,
    unidad: null,
  }];
}

// Arma la lista de ítems de un documento: detalle si lo hay, ítem único si
// no. `lineasPorDocumento` es un Map de clay_id → líneas.
export function itemsDeDte(dte, lineasPorDocumento) {
  const lineas = lineasPorDocumento?.get?.(dte?.id) || [];
  const items = itemsDeLineas(lineas);
  return items.length ? items : itemUnico(dte);
}

// Reparte las líneas que devuelve /v2/obligations/products entre sus
// documentos. La especificación no fija el nombre del campo que las
// vincula, así que se aceptan las variantes plausibles y las que no traen
// ninguno quedan fuera — antes que asignarlas al documento equivocado.
export function agruparLineas(lineas = []) {
  const mapa = new Map();
  for (const l of lineas) {
    const id = l?.transaction_id || l?.dte_id || l?.document_id || l?.id;
    if (!id) continue;
    if (!mapa.has(id)) mapa.set(id, []);
    mapa.get(id).push(l);
  }
  return mapa;
}

// Resumen de una importación, para informar sin tener que recorrer de nuevo.
export function resumirImportacion({ admitidos = [], omitidos = [] }) {
  const porMotivo = {};
  for (const o of omitidos) porMotivo[o.motivo] = (porMotivo[o.motivo] || 0) + 1;
  return {
    documentos: admitidos.length,
    omitidos: omitidos.length,
    omitidos_por_motivo: porMotivo,
    // Se declara siempre, para que quede en el informe y no en la memoria
    // de quien lo corrió.
    nota_metodo: 'Los DTE de Clay no traen unidad de medida, así que el cálculo es por gasto. '
      + 'Cargar el XML del documento habilita además el método físico.',
  };
}
