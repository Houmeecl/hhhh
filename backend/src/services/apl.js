// ============================================================
// Acuerdos de Producción Limpia (APL) — lógica del módulo.
//
// El módulo registra a qué APL adhirió un cliente y cómo van sus
// metas. Dos reglas de honestidad gobiernan todo:
//   1. sicr3p NO certifica cumplimiento: la evaluación final la hace
//      la auditoría del sistema APL. Acá solo se lleva el registro.
//   2. La evidencia que la plataforma "aporta" a una meta es la que
//      ya existe (documentos procesados, declaraciones REP,
//      constancias de cursos) — se resume tal cual está en la base,
//      sin proyecciones ni promesas.
// ============================================================

import { query } from '../lib/db.js';

export const ESTADOS_ACUERDO = ['adherido', 'en_implementacion', 'en_auditoria', 'certificado', 'cerrado'];
export const ESTADOS_META = ['pendiente', 'en_avance', 'cumplida', 'no_aplica'];
export const TIPOS_META = ['energia', 'residuos', 'agua', 'emisiones', 'capacitacion', 'gestion', 'otro'];
export const FUENTES_EVIDENCIA = ['informe_mensual', 'alcance3', 'rep_declaraciones', 'capacitacion', 'cadena_hash', 'otra'];

// Valida el payload de un acuerdo. Pura: devuelve { ok, error } y no
// lanza — las rutas traducen el error a un 400.
export function validarAcuerdo(body) {
  const { nombre, sector, fecha_adhesion, plazo_meses, estado, notas } = body && typeof body === 'object' ? body : {};
  if (!nombre || typeof nombre !== 'string' || !nombre.trim()) return { ok: false, error: 'Falta el nombre del APL.' };
  if (nombre.length > 300) return { ok: false, error: 'Nombre demasiado largo (máx. 300).' };
  if (sector != null && String(sector).length > 120) return { ok: false, error: 'Sector demasiado largo (máx. 120).' };
  if (notas != null && String(notas).length > 4000) return { ok: false, error: 'Notas demasiado largas (máx. 4000).' };
  if (estado != null && !ESTADOS_ACUERDO.includes(estado)) return { ok: false, error: `Estado inválido. Válidos: ${ESTADOS_ACUERDO.join(', ')}.` };
  if (plazo_meses != null && plazo_meses !== '' && (!Number.isInteger(Number(plazo_meses)) || Number(plazo_meses) <= 0 || Number(plazo_meses) > 120)) {
    return { ok: false, error: 'Plazo inválido: meses enteros entre 1 y 120.' };
  }
  if (fecha_adhesion != null && fecha_adhesion !== '' && Number.isNaN(Date.parse(fecha_adhesion))) {
    return { ok: false, error: 'Fecha de adhesión inválida.' };
  }
  return { ok: true };
}

export function validarMeta(body) {
  const { descripcion, numero, tipo, estado, fuente_evidencia, evidencia } = body && typeof body === 'object' ? body : {};
  if (!descripcion || typeof descripcion !== 'string' || !descripcion.trim()) return { ok: false, error: 'Falta la descripción de la meta.' };
  if (descripcion.length > 2000) return { ok: false, error: 'Descripción demasiado larga (máx. 2000).' };
  if (numero != null && String(numero).length > 60) return { ok: false, error: 'Numeración demasiado larga (máx. 60).' };
  if (tipo != null && !TIPOS_META.includes(tipo)) return { ok: false, error: `Tipo inválido. Válidos: ${TIPOS_META.join(', ')}.` };
  if (estado != null && !ESTADOS_META.includes(estado)) return { ok: false, error: `Estado inválido. Válidos: ${ESTADOS_META.join(', ')}.` };
  if (fuente_evidencia != null && fuente_evidencia !== '' && !FUENTES_EVIDENCIA.includes(fuente_evidencia)) {
    return { ok: false, error: `Fuente de evidencia inválida. Válidas: ${FUENTES_EVIDENCIA.join(', ')}.` };
  }
  if (evidencia != null && String(evidencia).length > 2000) return { ok: false, error: 'Evidencia demasiado larga (máx. 2000).' };
  return { ok: true };
}

// Resumen de la evidencia que la plataforma YA tiene para el RUT del
// cliente. Solo agregados contables — nada se interpreta ni se
// proyecta: cuántos documentos, cuánto CO2e calculado, cuántas
// declaraciones REP y en qué ventana de tiempo.
export async function evidenciaDisponible(rutCliente) {
  const { rows: [docs] } = await query(
    `SELECT COUNT(f.id)::int AS documentos,
            COALESCE(SUM(f.total_co2e), 0) AS co2e_total,
            MIN(s.created_at) AS desde,
            MAX(s.created_at) AS hasta
       FROM sesiones s
       LEFT JOIN facturas f ON f.sesion_id = s.id
      WHERE s.rut_cliente = $1`,
    [rutCliente]
  );
  const { rows: [rep] } = await query(
    `SELECT COUNT(d.id)::int AS declaraciones
       FROM declaraciones_embalaje d
       JOIN sesiones s ON s.id = d.sesion_id
      WHERE s.rut_cliente = $1`,
    [rutCliente]
  );
  return {
    documentos: docs.documentos,
    co2e_total_kg: Number(docs.co2e_total),
    declaraciones_rep: rep.declaraciones,
    // Sin documentos no hay ventana que mostrar: MIN/MAX venían de
    // sesiones vacías (LEFT JOIN) y confundían en el informe.
    desde: docs.documentos ? docs.desde : null,
    hasta: docs.documentos ? docs.hasta : null,
  };
}

// Conteo de metas por estado de un acuerdo — para las tarjetas del
// panel y el informe PDF.
export async function resumenMetas(acuerdoId) {
  const { rows } = await query(
    `SELECT estado, COUNT(*)::int AS n FROM apl_metas WHERE acuerdo_id = $1 GROUP BY estado`,
    [acuerdoId]
  );
  const base = Object.fromEntries(ESTADOS_META.map((e) => [e, 0]));
  for (const r of rows) base[r.estado] = r.n;
  base.total = rows.reduce((s, r) => s + r.n, 0);
  return base;
}
