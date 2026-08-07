// ============================================================
// Análisis de las compras y ventas (RCV) de un proveedor, a partir de lo
// ya descargado en dte_proveedor. NO habla con el SII ni con BaseAPI: solo
// lee la BD, así que no necesita la clave y no cuesta cuota.
//
// Combina tres piezas que ya existen en sicr3p, sin inventar:
//  1. Resumen y concentración por contraparte (agregación simple).
//  2. Cruce de contrapartes por RUT: ¿esta contraparte ya está en sicr3p?
//     (clientes / proveedores). Es el valor diferencial. Solo devuelve un
//     booleano por RUT — nunca expone datos de esos terceros.
//  3. Estimación REFERENCIAL de emisiones con el motor propio (método por
//     gasto), estampada con la versión del motor. Nunca es una cifra
//     definitiva ni una "certificación".
// ============================================================
import { cargarCategorias, calcularFactura } from './motorPropio.js';
import { versionVigente } from './motorVersiones.js';

const TOP_CONTRAPARTES = 10;

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
    const prev = porRut.get(rut) || { rut: f.rut_contraparte, razon_social: f.razon_social, n: 0, total: 0 };
    prev.n += 1;
    prev.total += Number(f.total || 0);
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

// Estimación referencial de emisiones de las COMPRAS, por método de gasto:
// cada documento es un "ítem" cuyo texto (razón social) el motor clasifica
// y cuyo monto neto alimenta el factor por gasto. Devuelve null si el motor
// no está configurado — nunca rompe el análisis por eso.
async function estimacionEmisiones(query, compras) {
  if (compras.length === 0) return null;
  let categorias;
  try {
    categorias = await cargarCategorias(query);
  } catch {
    return null; // motor sin configurar: el resto del análisis igual sirve
  }
  const items = compras.map((f) => ({
    nombre: f.razon_social || 'Documento',
    descripcion: '',
    monto: Number(f.neto || 0),
    cantidad: 0,
    unidad: null,
  }));
  let calc;
  try {
    calc = calcularFactura(items, categorias, { origen: 'texto' }); // 'texto' => siempre por gasto
  } catch {
    return null;
  }
  const version = await versionVigente(query);
  return {
    total_co2e_tref: calc.total_co2e, // tCO2e referencial
    categoria_dominante: calc.categoria,
    metodo: 'gasto',
    referencial: true, // la UI lo rotula "referencial — validar"
    motor_version_id: version?.id ?? null,
  };
}

// Punto de entrada: arma el análisis completo de un período para un
// proveedor a partir de dte_proveedor.
export async function analizarPeriodo(query, proveedorId, periodo) {
  const { rows } = await query(
    `SELECT tipo, tipo_dte, folio, rut_contraparte, razon_social, neto, iva, total, fecha
       FROM dte_proveedor
      WHERE proveedor_id = $1 AND periodo = $2
      ORDER BY tipo, fecha NULLS LAST, folio`,
    [proveedorId, periodo]
  );
  const compras = rows.filter((r) => r.tipo === 'compra');
  const ventas = rows.filter((r) => r.tipo === 'venta');

  const marcados = await contrapartesEnSicr3p(
    query,
    rows.map((r) => r.rut_contraparte)
  );

  return {
    periodo,
    resumen: { compra: totales(compras), venta: totales(ventas) },
    concentracion: {
      compra: concentracion(compras, marcados),
      venta: concentracion(ventas, marcados),
    },
    emisiones: await estimacionEmisiones(query, compras),
    documentos: rows,
  };
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
