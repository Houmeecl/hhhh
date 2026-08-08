// ============================================================
// Capital Natural — mapeador de documentos a movimientos ambientales.
// Modelo SEEA simplificado: cada documento capturado genera cargos
// en las cuentas ambientales activas (flujos del período).
// Los factores de conversión viven en cuentas_naturales.factores
// y son editables desde el panel admin.
//
// Cada cuenta (AGUA, ENER, CO2E, MATR, SUEL, BIOD) tiene su PROPIA
// mini-cadena de hash (migración 029) — mismo patrón que los lotes de
// pasaporte de origen: un conjunto acotado y autocontenido, con su
// propio génesis, en vez de mezclarse con la cadena global de facturas.
// ============================================================

import crypto from 'crypto';
import { siguienteEslabon } from './cadenaHash.js';

const round4 = (n) => Math.round(n * 10000) / 10000;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

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

  // Las cuentas FÍSICAS solo se cargan si la categoría es una clasificación
  // del documento, no el catch-all del motor.
  //
  // Cuando ninguna palabra clave calza, `clasificarConSenal` devuelve
  // 'servicios' — que no toca cuentas físicas, así que hoy no pasa nada. Pero
  // si un admin desactiva 'servicios' desde el panel (lo que ya se hizo con
  // 'transporte' en la migración 075), el catch-all pasa a ser la primera
  // categoría activa por orden de código: hoy, `agua`. Desde ese momento cada
  // documento que el motor no supo clasificar registraría METROS CÚBICOS DE
  // AGUA QUE NADIE CONSUMIÓ, en un libro sellado por cadena de hash — o sea,
  // un dato inventado y además inmutable, que es lo peor de las dos cosas.
  //
  // El CO2E de arriba sí se carga igual: ese número se calculó de verdad
  // (por gasto), aunque no se sepa de qué fue el gasto.
  //
  // `categoria_origen` es NULL en los documentos anteriores a la migración
  // 077: de esos no consta de dónde salió la categoría y se dejan como
  // estaban, porque no hay forma de saberlo hacia atrás.
  if (factura.categoria_origen === 'sin_coincidencia') return movs;

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

const round0 = (n) => Math.round(n);

/**
 * Valoriza un activo natural: si tiene valor_clp cargado a mano, ese manda
 * (trazable, "manual"). Si no, y la cuenta tiene un precio unitario citado
 * Y la unidad del activo coincide con la unidad de esa cuenta (o el activo
 * no especifica unidad propia), se calcula automático (extension × precio).
 * Un activo en otra unidad (ej. "l/s" de un derecho de agua vs. "m3" de la
 * cuenta) no se mezcla — mejor sin dato que un número incorrecto.
 * @returns {{valor_clp_efectivo: number|null, valor_origen: 'manual'|'automatico'|null}}
 */
export function valorizarActivo({ valor_clp, extension, unidad, cuenta_unidad, precio_clp_unidad }) {
  if (valor_clp != null) return { valor_clp_efectivo: Number(valor_clp), valor_origen: 'manual' };
  const precio = Number(precio_clp_unidad);
  const unidadCompatible = !unidad || !cuenta_unidad
    || String(unidad).trim().toLowerCase() === String(cuenta_unidad).trim().toLowerCase();
  if (precio > 0 && unidadCompatible) {
    return { valor_clp_efectivo: round0(Number(extension || 0) * precio), valor_origen: 'automatico' };
  }
  return { valor_clp_efectivo: null, valor_origen: null };
}

/** Carga el plan de cuentas como Map (usable dentro de una transacción). */
export async function cargarCuentas(run) {
  const { rows } = await run(`SELECT codigo, activo, factores, unidad FROM cuentas_naturales`);
  return new Map(rows.map((r) => [r.codigo, r]));
}

// Hash canónico de UN movimiento (determinista). No incluye el orden de
// inserción ni ids autogenerados — solo el contenido verificable.
export function hashMovimientoNatural({ cuenta_codigo, fecha, glosa, cantidad, unidad, tipo, origen, factura_id }) {
  const canonico = [
    cuenta_codigo || '',
    fecha ? new Date(fecha).toISOString().slice(0, 10) : '',
    glosa || '', Number(cantidad || 0).toFixed(4), unidad || '', tipo || '', origen || '', factura_id || '',
  ].join('|');
  return sha256(canonico);
}

// Anexa UN movimiento ya calculado a la mini-cadena de SU cuenta (lock
// FOR UPDATE de esa fila de cuentas_naturales — serializa movimientos
// concurrentes de la misma cuenta, igual que cadena_estado con facturas).
export async function anexarMovimiento(client, { cuenta_codigo, fecha, glosa, cantidad, unidad, tipo, origen, factura_id }) {
  const { rows: cRows } = await client.query(
    `SELECT ultimo_hash, n_eslabones FROM cuentas_naturales WHERE codigo = $1 FOR UPDATE`,
    [cuenta_codigo]
  );
  const estado = cRows[0];
  const hDoc = hashMovimientoNatural({ cuenta_codigo, fecha, glosa, cantidad, unidad, tipo, origen, factura_id });
  const { hash_cadena: hCad, eslabon } = siguienteEslabon(estado, hDoc);
  const { rows } = await client.query(
    `INSERT INTO movimientos_naturales
       (cuenta_codigo, fecha, glosa, factura_id, cantidad, unidad, tipo, origen,
        hash_documento, hash_anterior, hash_cadena, eslabon)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [cuenta_codigo, fecha || new Date(), glosa, factura_id || null, cantidad, unidad, tipo || 'cargo', origen || 'documento',
     hDoc, estado.ultimo_hash, hCad, eslabon]
  );
  await client.query(`UPDATE cuentas_naturales SET ultimo_hash = $2, n_eslabones = $3 WHERE codigo = $1`, [cuenta_codigo, hCad, eslabon]);
  return rows[0];
}

/** Inserta los movimientos derivados de una factura, con la conexión dada. */
export async function registrarMovimientos({ client, factura, fecha, cuentas }) {
  // Orden fijo (alfabético por código de cuenta): si una factura toca 2+
  // cuentas, todas las sesiones concurrentes las bloquean en el mismo
  // orden y no hay riesgo de deadlock entre ellas.
  const movs = derivarMovimientos(factura, cuentas).slice().sort((a, b) => a.cuenta_codigo.localeCompare(b.cuenta_codigo));
  for (const m of movs) {
    await anexarMovimiento(client, {
      cuenta_codigo: m.cuenta_codigo, fecha: fecha || new Date(), glosa: m.glosa,
      cantidad: m.cantidad, unidad: m.unidad, tipo: 'cargo', origen: 'documento', factura_id: factura.id || null,
    });
  }
  return movs.length;
}
