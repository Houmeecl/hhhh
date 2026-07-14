// ============================================================
// Capital Natural — mapeador de documentos a movimientos ambientales.
// Modelo SEEA simplificado: cada documento capturado genera cargos
// en las cuentas ambientales activas (flujos del período).
// Los factores de conversión viven en cuentas_naturales.factores
// y son editables desde el panel admin.
// ============================================================

const round4 = (n) => Math.round(n * 10000) / 10000;

// Factores por defecto si la cuenta no define el suyo.
const DEFAULTS = {
  electricidad_kgco2e_kwh: 0.2421, // HuellaChile — SEN 2023
  agua_kgco2e_m3: 0.344,           // agua potable (referencia, editable)
  materiales_kgco2e_kg: 1.5,       // insumos genéricos (referencia, editable)
};

/**
 * Deriva los movimientos naturales de una factura ya analizada.
 * @param {object} factura  { categoria, total_co2e, numero_venta, archivo_original }
 * @param {Map<string,{activo:boolean,factores:object}>} cuentas  plan de cuentas indexado por código
 * @returns {Array<{cuenta_codigo:string,cantidad:number,unidad:string,glosa:string}>}
 */
export function derivarMovimientos(factura, cuentas) {
  const movs = [];
  if (!factura || !(cuentas instanceof Map)) return movs;

  const activa = (codigo) => Boolean(cuentas.get(codigo)?.activo);
  const factor = (codigo, key) => {
    const v = Number(cuentas.get(codigo)?.factores?.[key]);
    return v > 0 ? v : DEFAULTS[key];
  };

  const total = Number(factura.total_co2e || 0); // tCO2e
  const refDoc = factura.numero_venta || factura.archivo_original || 's/n';
  const glosa = (detalle) => `${detalle} — ${refDoc}`;

  // Toda emisión calculada carga la cuenta de carbono.
  if (activa('CO2E') && total > 0) {
    movs.push({
      cuenta_codigo: 'CO2E',
      cantidad: round4(total),
      unidad: 'tCO2e',
      glosa: glosa(factura.categoria || 'Documento'),
    });
  }

  // Cuentas físicas según la categoría del documento (cantidad estimada
  // a partir del CO2e y el factor de conversión de la cuenta).
  switch (factura.categoria) {
    case 'Energía eléctrica': {
      if (activa('ENER') && total > 0) {
        const kwh = (total * 1000) / factor('ENER', 'electricidad_kgco2e_kwh');
        movs.push({ cuenta_codigo: 'ENER', cantidad: round4(kwh), unidad: 'kWh', glosa: glosa('Consumo eléctrico') });
      }
      break;
    }
    case 'Agua': {
      if (activa('AGUA') && total > 0) {
        const m3 = (total * 1000) / factor('AGUA', 'agua_kgco2e_m3');
        movs.push({ cuenta_codigo: 'AGUA', cantidad: round4(m3), unidad: 'm3', glosa: glosa('Consumo de agua') });
      }
      break;
    }
    case 'Insumos y materiales': {
      if (activa('MATR') && total > 0) {
        // kgCO2e/kg equivale a tCO2e/t → toneladas de material.
        const t = total / factor('MATR', 'materiales_kgco2e_kg');
        movs.push({ cuenta_codigo: 'MATR', cantidad: round4(t), unidad: 't', glosa: glosa('Materiales e insumos') });
      }
      break;
    }
    default:
      // Combustibles, Transporte, Servicios y categorías desconocidas:
      // solo cargan CO2E (ya agregado arriba).
      break;
  }

  return movs;
}

/** Carga el plan de cuentas como Map (usable dentro de una transacción). */
export async function cargarCuentas(run) {
  const { rows } = await run(`SELECT codigo, activo, factores, unidad FROM cuentas_naturales`);
  return new Map(rows.map((r) => [r.codigo, r]));
}

/** Inserta los movimientos derivados de una factura, con la conexión dada. */
export async function registrarMovimientos({ client, factura, fecha, cuentas }) {
  const movs = derivarMovimientos(factura, cuentas);
  for (const m of movs) {
    await client.query(
      `INSERT INTO movimientos_naturales (cuenta_codigo, fecha, glosa, factura_id, cantidad, unidad, tipo, origen)
       VALUES ($1,$2,$3,$4,$5,$6,'cargo','documento')`,
      [m.cuenta_codigo, fecha || new Date(), m.glosa, factura.id || null, m.cantidad, m.unidad]
    );
  }
  return movs.length;
}
