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
 * NO se escala el total del documento. La categoría de una factura es la del
 * ítem DOMINANTE (`motorPropio.calcularFactura`), no la de todos sus ítems:
 * una factura mixta puede tener el dominante en el catch-all —y por eso entra
 * a la bandeja— y otro ítem que sí calzó una palabra clave, calculado por
 * método FÍSICO con su propio factor. Escalar el total reescalaba también ese
 * ítem. Medido: 19,024 tCO2e (9,024 físicos de una fuga de refrigerante +
 * 10 por gasto) daban 91,3 al reclasificar, cuando lo correcto son 57,0. Un
 * 60% inventado.
 *
 * Entonces: se reescalan SOLO los ítems que se calcularon por gasto CON EL
 * FACTOR DE LA CATEGORÍA ORIGINAL del documento. El resto queda como está,
 * porque su número no depende de la categoría que el operador está corrigiendo.
 *
 * `items` viene de `line_items` con `metodo` (migración 035) y
 * `categoria_codigo` (migración 080).
 *
 * @returns {{co2e: number, reescalado: number, intacto: number}}
 */
export function recalcularPorGasto({ items, categoriaOriginal, factorOriginal, factorNuevo }) {
  const fNuevo = Number(factorNuevo);
  if (!(fNuevo > 0)) {
    throw Object.assign(new Error('La categoría elegida no tiene factor de gasto vigente.'), { entrada: true });
  }
  const lista = Array.isArray(items) ? items : [];

  // Una nota de crédito (todos los ítems descartados) no tiene ítems y vale 0
  // en cualquier categoría: no hay proporción que aplicar y tampoco falta.
  if (lista.length === 0) return { co2e: 0, reescalado: 0, intacto: 0 };

  // Sin `categoria_codigo` no consta con qué factor se calculó cada ítem, y
  // reescalar sobre esa suposición es exactamente el número inventado que
  // este proyecto viene cerrando. Se rechaza. Afecta a los documentos
  // anteriores a la migración 080, que no se reinterpretan hacia atrás.
  if (lista.some((it) => it.categoria_codigo == null)) {
    throw Object.assign(
      new Error('Este documento no registra la categoría de cada ítem (anterior a la migración 080): no se puede recalcular sin suponer.'),
      { entrada: true }
    );
  }

  const reescalables = lista.filter((it) => it.metodo !== 'fisico' && it.categoria_codigo === categoriaOriginal);
  const resto = lista.filter((it) => !reescalables.includes(it));
  const sumaReescalable = reescalables.reduce((a, it) => a + Number(it.co2e || 0), 0);
  const sumaResto = resto.reduce((a, it) => a + Number(it.co2e || 0), 0);

  if (sumaReescalable === 0) return { co2e: round4(sumaResto), reescalado: 0, intacto: resto.length };

  const f0 = Number(factorOriginal);
  if (!(f0 > 0)) {
    // Sin el factor con que se calculó el número original no se puede deducir
    // el monto, y sin monto no hay recálculo posible.
    throw Object.assign(
      new Error('No consta el factor con que se calculó este documento: no se puede recalcular sin inventar el monto.'),
      { entrada: true }
    );
  }
  return {
    co2e: round4(sumaReescalable * (fNuevo / f0) + sumaResto),
    reescalado: reescalables.length,
    intacto: resto.length,
  };
}

// Hash canónico de UN ajuste. Determinista: mismo orden de campos siempre, sin
// depender de JSON.stringify. No incluye ids autogenerados ni el instante de
// inserción — solo el contenido que se firma.
export function hashAjuste({ factura_id, factura_id_firmada, categoria_codigo, categoria, co2e_ajustado, co2e_original, usuario_id, motivo }) {
  const canonico = [
    // `factura_id_firmada` y no `factura_id`: el segundo pasa a NULL cuando el
    // documento se purga por retención, y entonces el hash dejaría de cuadrar
    // por una purga legítima. Se firma la copia inmutable.
    factura_id_firmada || factura_id || '', categoria_codigo || '', categoria || '',
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
  // Se firma el id como texto, congelado: ver hashAjuste().
  const conFirma = { ...ajuste, factura_id_firmada: String(ajuste.factura_id || '') };
  const hDoc = hashAjuste(conFirma);
  const { hash_cadena: hCad, eslabon } = siguienteEslabon(estado, hDoc);
  const { rows } = await client.query(
    `INSERT INTO ajustes_clasificacion
       (factura_id, factura_id_firmada, categoria_codigo, categoria, co2e_ajustado, co2e_original,
        usuario_id, motivo, hash_documento, hash_anterior, hash_cadena, eslabon)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    // El id va dos veces por separado (uuid y texto): reusar el mismo
    // parámetro para ambas columnas deja a Postgres sin poder deducir el tipo.
    [ajuste.factura_id, conFirma.factura_id_firmada, ajuste.categoria_codigo, ajuste.categoria,
     ajuste.co2e_ajustado, ajuste.co2e_original, ajuste.usuario_id, ajuste.motivo,
     hDoc, estado.ultimo_hash, hCad, eslabon]
  );
  await client.query(
    `UPDATE cadena_ajustes_estado SET ultimo_hash = $1, n_eslabones = $2, updated_at = now() WHERE id = 1`,
    [hCad, eslabon]
  );
  return rows[0];
}

/**
 * Verifica la cadena de ajustes completa, aparte de la de facturas.
 *
 * DOS comprobaciones, no una:
 *  1. El ENLACE — que cada `hash_cadena` salga de su `hash_anterior` más su
 *     `hash_documento` (`verificarCadenaCompleta`).
 *  2. El CONTENIDO — que `hash_documento` siga siendo el hash de los campos
 *     que se firmaron. Sin esto, un UPDATE que cambie la categoría, el CO2e o
 *     el motivo sin tocar ninguna columna de hash pasa la verificación: el
 *     enlace sigue cuadrando porque nadie recomputó qué encadena. Probado —
 *     reescribir co2e_ajustado a 999 daba `valido: true`.
 *
 * Esto importa más acá que en la cadena de facturas: el asiento es
 * precisamente "lo que una persona firmó".
 */
export async function verificarCadenaAjustes(run) {
  const { rows } = await run(
    `SELECT id, factura_id, factura_id_firmada, categoria_codigo, categoria,
            co2e_ajustado, co2e_original, usuario_id, motivo,
            hash_documento, hash_anterior, hash_cadena, eslabon
       FROM ajustes_clasificacion ORDER BY eslabon ASC`
  );
  const estructural = verificarCadenaCompleta(rows);
  if (!estructural.valido) return { ...estructural, total_eslabones: rows.length };

  for (const a of rows) {
    if (hashAjuste(a) !== a.hash_documento) {
      return {
        valido: false, rompe_en: a.id, total_eslabones: rows.length,
        motivo: 'el contenido del asiento no coincide con su hash_documento',
      };
    }
  }
  return { valido: true, total_eslabones: rows.length };
}
