// ============================================================
// Ley REP real desde el proveedor (Ley 20.920) — funciones PURAS.
//
// El productor obligado por la ley es la EMPRESA que pone productos
// envasados en el mercado. Acá se valida y calcula, siempre en el
// servidor, lo que la empresa declara desde su propio panel (sin POS):
//
//   1. Su catálogo de productos, cada uno con la composición del envase
//      de UNA unidad (mismos 7 materiales y misma fórmula de
//      reciclabilidad que services/rep.js — no hay dos fórmulas).
//   2. Sus ventas: una factura (evidencia) "pegada" a productos del
//      catálogo con sus unidades. Los items se guardan como SNAPSHOT:
//      congelan nombre, componentes y pesos del producto al momento de
//      la venta — editar el producto después no reescribe la historia.
//   3. El resumen: kilos de envases puestos en el mercado por MATERIAL
//      y período — la base real de la declaración en RETC/SGR. sicr3p
//      prepara ese insumo; la declaración formal la hace la empresa.
// ============================================================

import { MATERIALES_REP } from './rep.js';

export const MAX_ITEMS_VENTA = 50;
export const MAX_UNIDADES = 1e6;

const NOMBRE_MATERIAL = new Map(MATERIALES_REP.map((m) => [m.codigo, m.nombre]));

// Valida los items de una venta: [{producto_id, unidades}].
// `productosPorId` es un Map(id → fila de productos_proveedor) con SOLO
// los productos del proveedor autenticado — un id ajeno simplemente no
// está en el Map, así que "no existe" también cubre "no es tuyo".
// Devuelve { ok: true } o { ok: false, error }.
export function validarItemsVenta(items, productosPorId) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'Pega la factura a al menos un producto (producto + unidades).' };
  }
  if (items.length > MAX_ITEMS_VENTA) {
    return { ok: false, error: `Máximo ${MAX_ITEMS_VENTA} productos por factura.` };
  }
  const vistos = new Set();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const n = i + 1;
    if (!it || typeof it !== 'object' || Array.isArray(it)) {
      return { ok: false, error: `Producto ${n}: formato inválido.` };
    }
    const p = productosPorId.get(it.producto_id);
    if (!p) {
      return { ok: false, error: `Producto ${n}: no existe en tu catálogo.` };
    }
    if (!p.activo) {
      return { ok: false, error: `Producto ${n} (${p.nombre}): está desactivado — actívalo o quítalo de la factura.` };
    }
    if (vistos.has(it.producto_id)) {
      return { ok: false, error: `Producto ${n} (${p.nombre}): está repetido — suma las unidades en una sola línea.` };
    }
    vistos.add(it.producto_id);
    const u = Number(it.unidades);
    if (typeof it.unidades === 'boolean' || !Number.isInteger(u) || u < 1) {
      return { ok: false, error: `Producto ${n} (${p.nombre}): las unidades deben ser un entero mayor o igual a 1.` };
    }
    if (u > MAX_UNIDADES) {
      return { ok: false, error: `Producto ${n} (${p.nombre}): las unidades superan el máximo permitido.` };
    }
  }
  return { ok: true };
}

// Congela los items de la venta con los datos del producto DE HOY.
// Todo lo que el resumen necesita después vive en el snapshot: la fila
// de ventas_rep se puede leer sola aunque el producto cambie o se borre.
export function snapshotItemsVenta(items, productosPorId) {
  return items.map((it) => {
    const p = productosPorId.get(it.producto_id);
    return {
      producto_id: p.id,
      nombre: p.nombre,
      codigo: p.codigo || null,
      unidades: Number(it.unidades),
      peso_total_gr: Number(p.peso_total_gr),
      peso_reciclable_gr: Number(p.peso_reciclable_gr),
      componentes: p.componentes,
    };
  });
}

const round3 = (n) => Math.round(n * 1000) / 1000;

// Totales de UNA venta a partir de su snapshot: kilos de envases puestos
// en el mercado y cuántos de esos kilos son reciclables.
export function totalesVenta(snapshot) {
  let gr = 0;
  let grRec = 0;
  for (const it of snapshot) {
    gr += it.peso_total_gr * it.unidades;
    grRec += it.peso_reciclable_gr * it.unidades;
  }
  return { kg_envases: round3(gr / 1000), kg_reciclables: round3(grRec / 1000) };
}

// Resumen por MATERIAL sobre un conjunto de ventas (sus snapshots):
// la declaración RETC se hace por material, así que este es el número
// que la empresa necesita. También totales por período (AAAA-MM).
// Devuelve:
//   { por_material: [{material, nombre, kg, kg_reciclables}...],  (solo materiales con kilos, orden catálogo)
//     por_periodo:  [{periodo, kg_envases, kg_reciclables, n_ventas}...],  (desc)
//     total: {kg_envases, kg_reciclables, n_ventas, n_unidades} }
export function resumenRep(ventas) {
  const mat = new Map();   // codigo → {kg, kgRec}
  const per = new Map();   // periodo → {kg, kgRec, n}
  let kg = 0;
  let kgRec = 0;
  let unidades = 0;

  for (const v of ventas) {
    kg += Number(v.kg_envases);
    kgRec += Number(v.kg_reciclables);
    const p = per.get(v.periodo) || { kg: 0, kgRec: 0, n: 0 };
    p.kg += Number(v.kg_envases);
    p.kgRec += Number(v.kg_reciclables);
    p.n += 1;
    per.set(v.periodo, p);

    for (const it of v.items || []) {
      unidades += it.unidades;
      for (const c of it.componentes || []) {
        // peso_gr del componente es unitario del envase; cantidad del
        // componente (ej. 2 tapas) multiplica dentro de la unidad, y las
        // unidades vendidas multiplican todo. Misma semántica que
        // calcularReciclabilidad (services/rep.js).
        const cant = c.cantidad === undefined || c.cantidad === null || c.cantidad === '' ? 1 : Number(c.cantidad) || 0;
        const grComp = (Number(c.peso_gr) || 0) * cant * it.unidades;
        if (grComp <= 0) continue;
        const m = mat.get(c.material) || { kg: 0, kgRec: 0 };
        m.kg += grComp / 1000;
        if (c.reciclable) m.kgRec += grComp / 1000;
        mat.set(c.material, m);
      }
    }
  }

  return {
    por_material: MATERIALES_REP
      .filter((m) => mat.has(m.codigo))
      .map((m) => ({
        material: m.codigo,
        nombre: NOMBRE_MATERIAL.get(m.codigo),
        kg: round3(mat.get(m.codigo).kg),
        kg_reciclables: round3(mat.get(m.codigo).kgRec),
      })),
    por_periodo: [...per.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([periodo, p]) => ({
        periodo, kg_envases: round3(p.kg), kg_reciclables: round3(p.kgRec), n_ventas: p.n,
      })),
    total: {
      kg_envases: round3(kg),
      kg_reciclables: round3(kgRec),
      n_ventas: ventas.length,
      n_unidades: unidades,
    },
  };
}
