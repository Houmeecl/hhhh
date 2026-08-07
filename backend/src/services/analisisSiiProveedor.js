// ============================================================
// Análisis de las compras y ventas (RCV) de un proveedor, a partir de lo
// ya descargado en dte_proveedor. NO habla con el SII ni con BaseAPI: solo
// lee la BD, así que no necesita la clave y no cuesta cuota.
//
// Combina cuatro piezas que ya existen en sicr3p, sin inventar:
//  1. Resumen y concentración por contraparte (agregación simple).
//  2. Cruce de contrapartes por RUT: ¿esta contraparte ya está en sicr3p?
//     (clientes / proveedores). Solo devuelve un booleano por RUT — nunca
//     expone datos de esos terceros.
//  3. Conciliación real: cuando la contraparte es OTRO proveedor de
//     sicr3p que también conectó su SII, se compara el documento (folio +
//     tipo_dte) contra el RCV que esa empresa descargó del suyo — dos
//     fuentes SII independientes confirmándose entre sí. Nunca expone el
//     monto de la otra empresa, solo si coincide.
//  4. Estimación REFERENCIAL de emisiones con el motor propio (método por
//     gasto), estampada con la versión del motor. Nunca es una cifra
//     definitiva ni una "certificación".
// ============================================================
import { versionVigente } from './motorVersiones.js';
import { descargarComprasVentas } from './siiProveedor.js';
import { cargarCategorias, calcularFactura } from './motorPropio.js';

const TOP_CONTRAPARTES = 10;

// Nombres de los tipos de DTE que aparecen en el RCV, para que el desglose
// distinga facturas, notas, GUÍAS DE DESPACHO y boletas (estas últimas
// llegan como resumen agregado del período, no documento a documento).
export const NOMBRES_TIPO_DTE = {
  30: 'Factura', 32: 'Factura exenta', 33: 'Factura electrónica',
  34: 'Factura exenta electrónica', 35: 'Boleta', 38: 'Boleta exenta',
  39: 'Boleta electrónica', 41: 'Boleta exenta electrónica',
  45: 'Factura de compra', 46: 'Factura de compra electrónica',
  48: 'Comprobante de pago electrónico', 52: 'Guía de despacho electrónica',
  56: 'Nota de débito electrónica', 61: 'Nota de crédito electrónica',
  110: 'Factura de exportación', 111: 'Nota de débito de exportación',
  112: 'Nota de crédito de exportación',
};

// Agrupa filas por tipo de DTE: cuántos documentos y montos por tipo. Las
// notas de crédito y guías de despacho quedan visibles por separado para
// no leerlas como facturación.
function porTipo(filas) {
  const mapa = new Map();
  for (const f of filas) {
    const k = f.tipo_dte || '?';
    const prev = mapa.get(k) || { tipo_dte: k, nombre: NOMBRES_TIPO_DTE[Number(k)] || `Tipo ${k}`, n: 0, neto: 0, iva: 0, total: 0, resumen: true };
    prev.n += 1;
    prev.neto += Number(f.neto || 0);
    prev.iva += Number(f.iva || 0);
    prev.total += Number(f.total || 0);
    // Una fila 'resumen-NN' agrega N documentos del período en una sola:
    // el conteo por filas no aplica y la UI muestra "resumen" en su lugar.
    if (!String(f.folio || '').startsWith('resumen-')) prev.resumen = false;
    mapa.set(k, prev);
  }
  return [...mapa.values()].sort((a, b) => b.total - a.total);
}

// Suma neto/iva/total y cuenta documentos de un arreglo de filas.
function totales(filas) {
  return filas.reduce(
    (a, f) => ({
      n: a.n + 1,
      neto: a.neto + Number(f.neto || 0),
      iva: a.iva + Number(f.iva || 0),
      total: a.total + Number(f.total || 0),
    }),
    { n: 0, neto: 0, iva: 0, total: 0 }
  );
}

// Top contrapartes por monto total, con su participación (%) sobre el
// total del tipo. `marcados` = set de RUT (normalizados) que ya existen en
// sicr3p, para marcar en_sicr3p sin filtrar nada de esos terceros.
function concentracion(filas, marcados) {
  const porRut = new Map();
  let totalGlobal = 0;
  for (const f of filas) {
    const rut = f.rut_contraparte || 'sin-rut';
    totalGlobal += Number(f.total || 0);
    const prev = porRut.get(rut) || { rut: f.rut_contraparte, razon_social: f.razon_social, n: 0, total: 0, conciliados: 0 };
    prev.n += 1;
    prev.total += Number(f.total || 0);
    if (f.conciliado) prev.conciliados += 1;
    if (!prev.razon_social && f.razon_social) prev.razon_social = f.razon_social;
    porRut.set(rut, prev);
  }
  return [...porRut.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, TOP_CONTRAPARTES)
    .map((c) => ({
      ...c,
      participacion: totalGlobal > 0 ? Math.round((c.total / totalGlobal) * 1000) / 10 : 0,
      en_sicr3p: c.rut ? marcados.has(c.rut) : false,
    }));
}

// ¿Cuáles de estos RUT ya existen en sicr3p? Se consulta contra clientes y
// proveedores por RUT normalizado (mismo criterio de normalización que
// buscar.js). Devuelve un Set de RUT normalizados presentes.
async function contrapartesEnSicr3p(query, ruts) {
  const lista = [...new Set(ruts.filter(Boolean))];
  if (lista.length === 0) return new Set();
  const NORM = (col) => `regexp_replace(COALESCE(${col},''), '[^0-9kK]', '', 'g')`;
  const { rows } = await query(
    `SELECT ${NORM('rut')} AS rn FROM clientes    WHERE ${NORM('rut')} = ANY($1)
     UNION
     SELECT ${NORM('rut')} AS rn FROM proveedores WHERE ${NORM('rut')} = ANY($1)`,
    [lista]
  );
  return new Set(rows.map((r) => r.rn));
}

// Conciliación real (no solo "existe el RUT"): ¿el documento de este
// proveedor tiene su espejo en el RCV que OTRO proveedor de sicr3p ya
// descargó de su propio SII? Si A compró a B y ambos conectaron su SII,
// la compra de A (folio+tipo_dte, rut_contraparte = RUT de B) debe
// aparecer como venta de B (mismo folio+tipo_dte, rut_contraparte = RUT
// de A) — dos fuentes independientes (el SII de cada uno) confirmándose
// entre sí. No se filtra por período del otro lado: una compra de fin de
// mes puede caer en el período siguiente del SII de la contraparte.
// Nunca devuelve el monto de la otra empresa — solo si coincide o no; el
// nombre de la contraparte ya lo trae la propia fila (razon_social), no
// es información nueva.
async function conciliarConOtrosProveedores(query, proveedorId, rows) {
  if (rows.length === 0) return new Map();
  const { rows: propio } = await query(`SELECT rut FROM proveedores WHERE id = $1`, [proveedorId]);
  const miRut = propio[0]?.rut;
  if (!miRut) return new Map();

  const { rows: espejos } = await query(
    `SELECT d.tipo, d.tipo_dte, d.folio, d.rut_contraparte, d.total AS mi_total, o.total AS otro_total, p.nombre_empresa
       FROM dte_proveedor d
       JOIN dte_proveedor o
         ON o.proveedor_id <> d.proveedor_id
        AND o.rut_contraparte = $2
        AND o.tipo = CASE WHEN d.tipo = 'compra' THEN 'venta' ELSE 'compra' END
        AND o.tipo_dte = d.tipo_dte
        AND o.folio = d.folio
       JOIN proveedores p ON p.id = o.proveedor_id AND p.rut = d.rut_contraparte
      WHERE d.proveedor_id = $1`,
    [proveedorId, miRut]
  );

  const mapa = new Map();
  for (const e of espejos) {
    const clave = `${e.tipo}|${e.tipo_dte}|${e.folio}|${e.rut_contraparte}`;
    // El folio NO es global — es correlativo por RUT emisor (migración 071),
    // así que dos empresas SIN relación entre sí pueden compartir folio +
    // tipo_dte por coincidencia. El `p.rut = d.rut_contraparte` de arriba es
    // lo que evita conciliar contra un tercero ajeno: exige que la empresa
    // del documento espejo sea EXACTAMENTE la contraparte que este documento
    // declaró, no cualquier otro proveedor con folio igual.
    if (mapa.has(clave)) continue;
    mapa.set(clave, {
      conciliado: true,
      espejo_empresa: e.nombre_empresa,
      monto_coincide: Math.abs(Number(e.mi_total || 0) - Number(e.otro_total || 0)) <= 1,
    });
  }
  return mapa;
}

// Estimación referencial de emisiones de las COMPRAS: suma el co2e que se
// calculó POR DOCUMENTO al descargar (extrayendo el detalle de ítems del
// XML y corriendo el motor propio — método físico donde había unidades,
// gasto si no). Devuelve null si ningún documento tiene cálculo (motor sin
// configurar): el resto del análisis igual sirve.
async function estimacionEmisiones(query, compras) {
  const conCalculo = compras.filter((f) => f.co2e != null);
  if (conCalculo.length === 0) return null;
  const total = conCalculo.reduce((a, f) => a + Number(f.co2e || 0), 0);
  const nFisico = conCalculo.filter((f) => f.metodo === 'fisico').length;
  const version = await versionVigente(query);
  return {
    total_co2e_tref: Math.round(total * 10000) / 10000, // tCO2e referencial
    documentos_calculados: conCalculo.length,
    documentos_totales: compras.length,
    metodo_fisico: nFisico, // cuántos documentos se pudieron calcular por unidades reales
    metodo_gasto: conCalculo.length - nFisico,
    referencial: true, // la UI lo rotula "referencial — validar"
    motor_version_id: version?.id ?? null,
  };
}

// Punto de entrada: arma el análisis completo de un período para un
// proveedor a partir de dte_proveedor.
export async function analizarPeriodo(query, proveedorId, periodo) {
  const { rows } = await query(
    `SELECT tipo, tipo_dte, folio, rut_contraparte, razon_social, neto, iva, total, fecha, co2e, metodo
       FROM dte_proveedor
      WHERE proveedor_id = $1 AND periodo = $2
      ORDER BY tipo, fecha NULLS LAST, folio`,
    [proveedorId, periodo]
  );
  const conciliaciones = await conciliarConOtrosProveedores(query, proveedorId, rows);
  for (const r of rows) {
    const clave = `${r.tipo}|${r.tipo_dte}|${r.folio}|${r.rut_contraparte}`;
    const c = conciliaciones.get(clave);
    if (c) Object.assign(r, c);
  }

  const compras = rows.filter((r) => r.tipo === 'compra');
  const ventas = rows.filter((r) => r.tipo === 'venta');

  const marcados = await contrapartesEnSicr3p(
    query,
    rows.map((r) => r.rut_contraparte)
  );

  return {
    periodo,
    resumen: { compra: totales(compras), venta: totales(ventas) },
    por_tipo: { compra: porTipo(compras), venta: porTipo(ventas) },
    concentracion: {
      compra: concentracion(compras, marcados),
      venta: concentracion(ventas, marcados),
    },
    emisiones: await estimacionEmisiones(query, compras),
    documentos: rows,
  };
}

// Descarga compras/ventas del SII para un proveedor, calcula el CO2e por
// documento de compra (motor propio) y hace el UPSERT idempotente en
// dte_proveedor. Devuelve { documentos, analisis }. NO guarda la clave: eso
// es decisión del llamador (el panel proveedor sí la guarda; el admin no).
// Lo usan el panel del proveedor y la sección admin "SII", para no duplicar.
//   rutSii/password: credenciales que autentican en el SII (por-request).
//   rutEmpresa: RUT de la empresa a consultar (sale de la fila proveedores).
export async function descargarYCalcular({ query, withTx, proveedorId, rutEmpresa, rutSii, password, periodo }, opts = {}) {
  // `opts` ({ fetcher, cfg }) llega a baseapiSii: inyectable para tests sin red.
  const descarga = await descargarComprasVentas({ rut: rutSii, password, rutEmpresa, periodo }, opts);

  // CO2e por documento de compra: detalle de ítems (XML) → motor propio.
  // Si el motor no está configurado, co2e queda null y el análisis igual sirve.
  let categorias = null;
  try { categorias = await cargarCategorias(query); } catch { categorias = null; }
  const co2ePorCompra = descarga.compra.map((f) => {
    if (!categorias) return { co2e: null, metodo: null };
    try {
      const calc = calcularFactura(f.items, categorias, { origen: f.origen_calculo });
      const metodo = calc.items.some((it) => it.metodo === 'fisico') ? 'fisico' : 'gasto';
      return { co2e: calc.total_co2e, metodo };
    } catch { return { co2e: null, metodo: null }; }
  });

  let guardados = 0;
  await withTx(async (client) => {
    for (let i = 0; i < descarga.compra.length; i++) {
      const f = descarga.compra[i];
      const { co2e, metodo } = co2ePorCompra[i];
      await client.query(
        `INSERT INTO dte_proveedor
           (proveedor_id, periodo, tipo, tipo_dte, folio, rut_contraparte, razon_social, neto, iva, total, fecha, co2e, metodo)
         VALUES ($1,$2,'compra',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (proveedor_id, periodo, tipo, COALESCE(tipo_dte, ''), folio, COALESCE(rut_contraparte, ''))
         DO UPDATE SET razon_social = EXCLUDED.razon_social, neto = EXCLUDED.neto, iva = EXCLUDED.iva,
                       total = EXCLUDED.total, fecha = EXCLUDED.fecha, co2e = EXCLUDED.co2e,
                       metodo = EXCLUDED.metodo, descargado_at = now()`,
        [proveedorId, periodo, f.tipo_dte, f.folio, f.rut_contraparte, f.razon_social,
         f.neto, f.iva, f.total, f.fecha, co2e, metodo]
      );
      guardados += 1;
    }
    for (const f of descarga.venta) {
      await client.query(
        `INSERT INTO dte_proveedor
           (proveedor_id, periodo, tipo, tipo_dte, folio, rut_contraparte, razon_social, neto, iva, total, fecha)
         VALUES ($1,$2,'venta',$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (proveedor_id, periodo, tipo, COALESCE(tipo_dte, ''), folio, COALESCE(rut_contraparte, ''))
         DO UPDATE SET razon_social = EXCLUDED.razon_social, neto = EXCLUDED.neto, iva = EXCLUDED.iva,
                       total = EXCLUDED.total, fecha = EXCLUDED.fecha, descargado_at = now()`,
        [proveedorId, periodo, f.tipo_dte, f.folio, f.rut_contraparte, f.razon_social,
         f.neto, f.iva, f.total, f.fecha]
      );
      guardados += 1;
    }
  });

  return { documentos: guardados, analisis: await analizarPeriodo(query, proveedorId, periodo) };
}

// Lista de períodos ya descargados por un proveedor (para el selector).
export async function periodosDescargados(query, proveedorId) {
  const { rows } = await query(
    `SELECT periodo, COUNT(*)::int AS n_docs, MAX(descargado_at) AS descargado_at
       FROM dte_proveedor WHERE proveedor_id = $1
      GROUP BY periodo ORDER BY periodo DESC`,
    [proveedorId]
  );
  return rows;
}
