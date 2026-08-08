// ============================================================
// Reclasificación por un operador — asiento de ajuste encadenado.
//
// El documento calculado está SELLADO: `facturas.hash_documento` incluye la
// categoría y el CO2e, y cada factura se encadena a la anterior. Cambiarle la
// categoría le cambia el factor y por lo tanto el número, así que editar la
// fila rompería la cadena desde ese punto — y esa cadena es lo que verifica
// el QR público. No se reescribe: se anexa un asiento aparte, con su propia
// cadena (migración 079), igual que Capital Natural y las declaraciones de
// embalaje.
//
// Append-only de verdad: no hay UPDATE ni DELETE. Corregir un ajuste
// equivocado es anexar otro; vale el de mayor `eslabon` y los anteriores
// quedan legibles.
// ============================================================

import crypto from 'crypto';
import { siguienteEslabon, verificarCadenaCompleta } from './cadenaHash.js';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const round4 = (n) => Math.round(n * 10000) / 10000;

// Los dos estados que un operador PUEDE reclasificar. El resto no entra a la
// bandeja: una categoría que el motor dedujo de la glosa no se "corrige" a
// mano —para eso está el panel del motor, que edita las palabras clave y
// versiona el cambio para todos los documentos, no para uno—, y un documento
// sin procedencia registrada (NULL, anterior a la migración 077 o del motor
// externo) no se reinterpreta hacia atrás.
export const ESTADOS_REVISABLES = ['sin_coincidencia', 'sin_categoria'];

/**
 * CO2e de la factura bajo otra categoría.
 *
 * Los documentos de la bandeja se calcularon SIEMPRE por método de gasto:
 * `motorPropio.calcularItem` lo fuerza cuando no hubo coincidencia, justamente
 * para que el factor físico de una categoría no se le aplique a un ítem que no
 * fue clasificado en ella. El método de gasto es lineal en el monto
 * (co2e = monto/1e6 × factor), así que cambiar de categoría es cambiar de
 * factor: co2e_nuevo = co2e_original × (factor_nuevo / factor_original).
 *
 * NO se recalcula desde el monto porque `line_items` no lo guarda (solo
 * descripción, cantidad y CO2e), y NO se aplica método físico: el operador
 * está clasificando por la glosa, no midiendo el consumo.
 *
 * @returns {{co2e: number}} o lanza si no hay con qué calcular.
 */
export function recalcularPorGasto({ co2eOriginal, factorOriginal, factorNuevo }) {
  const co2e0 = Number(co2eOriginal || 0);
  const fNuevo = Number(factorNuevo);
  if (!(fNuevo > 0)) {
    throw Object.assign(new Error('La categoría elegida no tiene factor de gasto vigente.'), { entrada: true });
  }
  // Una nota de crédito (todos los ítems descartados) vale 0 en cualquier
  // categoría: no hay proporción que aplicar y tampoco hace falta.
  if (co2e0 === 0) return { co2e: 0 };

  const f0 = Number(factorOriginal);
  if (!(f0 > 0)) {
    // Sin el factor con que se calculó el número original no se puede deducir
    // el monto, y sin monto no hay recálculo posible. Antes que inventar una
    // cifra, se rechaza: es exactamente el defecto que esta ronda vino a
    // cerrar.
    throw Object.assign(
      new Error('No consta el factor con que se calculó este documento: no se puede recalcular sin inventar el monto.'),
      { entrada: true }
    );
  }
  return { co2e: round4(co2e0 * (fNuevo / f0)) };
}

// Hash canónico de UN ajuste. Determinista: mismo orden de campos siempre, sin
// depender de JSON.stringify. No incluye ids autogenerados ni el instante de
// inserción — solo el contenido que se firma.
export function hashAjuste({ factura_id, categoria_codigo, categoria, co2e_ajustado, co2e_original, usuario_id, motivo }) {
  const canonico = [
    factura_id || '', categoria_codigo || '', categoria || '',
    Number(co2e_ajustado || 0).toFixed(4), Number(co2e_original || 0).toFixed(4),
    usuario_id || '', motivo || '',
  ].join('|');
  return sha256(canonico);
}

/**
 * Anexa un ajuste a la cadena. Toma FOR UPDATE la fila única de
 * `cadena_ajustes_estado`, que serializa a los operadores concurrentes igual
 * que `cadena_estado` con las facturas.
 */
export async function anexarAjuste(client, ajuste) {
  const { rows: eRows } = await client.query(
    `SELECT ultimo_hash, n_eslabones FROM cadena_ajustes_estado WHERE id = 1 FOR UPDATE`
  );
  const estado = eRows[0];
  const hDoc = hashAjuste(ajuste);
  const { hash_cadena: hCad, eslabon } = siguienteEslabon(estado, hDoc);
  const { rows } = await client.query(
    `INSERT INTO ajustes_clasificacion
       (factura_id, categoria_codigo, categoria, co2e_ajustado, co2e_original,
        usuario_id, motivo, hash_documento, hash_anterior, hash_cadena, eslabon)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [ajuste.factura_id, ajuste.categoria_codigo, ajuste.categoria,
     ajuste.co2e_ajustado, ajuste.co2e_original, ajuste.usuario_id, ajuste.motivo,
     hDoc, estado.ultimo_hash, hCad, eslabon]
  );
  await client.query(
    `UPDATE cadena_ajustes_estado SET ultimo_hash = $1, n_eslabones = $2, updated_at = now() WHERE id = 1`,
    [hCad, eslabon]
  );
  return rows[0];
}

/** Verifica la cadena de ajustes completa, aparte de la cadena de facturas. */
export async function verificarCadenaAjustes(run) {
  const { rows } = await run(
    `SELECT id, hash_documento, hash_anterior, hash_cadena, eslabon
       FROM ajustes_clasificacion ORDER BY eslabon ASC`
  );
  const estructural = verificarCadenaCompleta(rows);
  if (!estructural.valido) return { ...estructural, total_eslabones: rows.length };
  return { valido: true, total_eslabones: rows.length };
}
