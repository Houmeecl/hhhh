// ============================================================
// Valorización de inventario — FIFO y PMP (precio medio ponderado).
// Función pura sobre una lista de movimientos ordenados en el tiempo:
//   { descripcion, tipo: 'entrada'|'salida', cantidad,
//     precio_unitario (CLP), co2e_unitario (tCO2e/u) }
// Devuelve, por ítem: stock, valor CLP, CO2e incorporado del stock
// y costo (CLP/CO2e) de las salidas del período.
// ============================================================

const r2 = (n) => Math.round(n * 100) / 100;
const r6 = (n) => Math.round(n * 1000000) / 1000000;

function nuevoItem() {
  return {
    capas: [],            // FIFO: [{ cantidad, precio, co2e }]
    stock: 0,
    pmpPrecio: 0,         // PMP: promedio vigente
    pmpCo2e: 0,
    costoSalidasClp: 0,
    costoSalidasCo2e: 0,
    salidasSinStock: 0,   // cantidad pedida por sobre el stock (se informa, no se descuenta)
  };
}

/**
 * @param {Array} movimientos  ordenados cronológicamente
 * @param {'fifo'|'pmp'} metodo
 * @returns {{ items: Array, totales: object }}
 */
export function valorizar(movimientos, metodo = 'fifo') {
  const porItem = new Map();

  for (const m of movimientos || []) {
    const key = m.descripcion;
    if (!porItem.has(key)) porItem.set(key, nuevoItem());
    const it = porItem.get(key);
    const cant = Number(m.cantidad) || 0;
    if (cant <= 0) continue;

    if (m.tipo === 'entrada') {
      const precio = Number(m.precio_unitario) || 0;
      const co2e = Number(m.co2e_unitario) || 0;
      if (metodo === 'pmp') {
        // Promedio ponderado recalculado en cada entrada.
        const total = it.stock + cant;
        it.pmpPrecio = total > 0 ? (it.stock * it.pmpPrecio + cant * precio) / total : 0;
        it.pmpCo2e = total > 0 ? (it.stock * it.pmpCo2e + cant * co2e) / total : 0;
      }
      it.capas.push({ cantidad: cant, precio, co2e });
      it.stock += cant;
    } else {
      // Salida: consume hasta donde alcance el stock.
      let restante = Math.min(cant, it.stock);
      if (cant > it.stock) it.salidasSinStock += cant - it.stock;

      if (metodo === 'pmp') {
        it.costoSalidasClp += restante * it.pmpPrecio;
        it.costoSalidasCo2e += restante * it.pmpCo2e;
        it.stock -= restante;
        // Las capas se consumen igual (para mantener consistencia del stock físico).
        let porConsumir = restante;
        while (porConsumir > 0 && it.capas.length) {
          const capa = it.capas[0];
          const usa = Math.min(porConsumir, capa.cantidad);
          capa.cantidad -= usa;
          porConsumir -= usa;
          if (capa.cantidad <= 0) it.capas.shift();
        }
      } else {
        // FIFO: consume las capas más antiguas primero, a su costo.
        while (restante > 0 && it.capas.length) {
          const capa = it.capas[0];
          const usa = Math.min(restante, capa.cantidad);
          it.costoSalidasClp += usa * capa.precio;
          it.costoSalidasCo2e += usa * capa.co2e;
          capa.cantidad -= usa;
          it.stock -= usa;
          restante -= usa;
          if (capa.cantidad <= 0) it.capas.shift();
        }
      }
    }
  }

  const items = [...porItem.entries()].map(([descripcion, it]) => {
    let valorClp, co2eStock, unitario;
    if (metodo === 'pmp') {
      valorClp = it.stock * it.pmpPrecio;
      co2eStock = it.stock * it.pmpCo2e;
      unitario = it.pmpPrecio;
    } else {
      valorClp = it.capas.reduce((a, c) => a + c.cantidad * c.precio, 0);
      co2eStock = it.capas.reduce((a, c) => a + c.cantidad * c.co2e, 0);
      unitario = it.stock > 0 ? valorClp / it.stock : 0;
    }
    return {
      descripcion,
      stock: r2(it.stock),
      precio_unitario: r2(unitario),
      valor_clp: r2(valorClp),
      co2e_stock: r6(co2eStock),
      costo_salidas_clp: r2(it.costoSalidasClp),
      costo_salidas_co2e: r6(it.costoSalidasCo2e),
      capas: metodo === 'fifo' ? it.capas.map((c) => ({ cantidad: r2(c.cantidad), precio: r2(c.precio) })) : undefined,
      salidas_sin_stock: it.salidasSinStock > 0 ? r2(it.salidasSinStock) : undefined,
    };
  }).sort((a, b) => b.valor_clp - a.valor_clp);

  const totales = {
    valor_clp: r2(items.reduce((a, i) => a + i.valor_clp, 0)),
    co2e_stock: r6(items.reduce((a, i) => a + i.co2e_stock, 0)),
    costo_salidas_clp: r2(items.reduce((a, i) => a + i.costo_salidas_clp, 0)),
    costo_salidas_co2e: r6(items.reduce((a, i) => a + i.costo_salidas_co2e, 0)),
    n_items: items.length,
  };
  return { metodo, items, totales };
}
