// ============================================================
// Vista PÚBLICA y anonimizada de la cadena de hash. Cualquier
// visitante puede ver que la cadena existe y está íntegra, pero
// JAMÁS datos de clientes: nada de RUT, empresa, folio ni nombre
// de archivo. El mapper es puro para poder testear que no filtra.
// ============================================================

// Versión corta de un hash SHA-256 para mostrar (10 iniciales + 8 finales).
export function hashCorto(hash) {
  const h = String(hash || '');
  if (h.length <= 20) return h;
  return `${h.slice(0, 10)}…${h.slice(-8)}`;
}

// Mapea una fila de la cadena global (facturas o cadena_anclajes) a su
// versión pública. SOLO estas seis claves: eslabon, factura_id, fecha,
// hash_corto, t_co2e, tipo. Cualquier campo nuevo debe pasar por aquí
// a propósito (y por su test). Los anclajes de lote (migración 022) no
// tienen factura ni t CO2e: factura_id null, t_co2e 0, tipo 'anclaje'.
export function filaEslabonPublico(fila) {
  const esAnclaje = fila.tipo === 'anclaje';
  return {
    eslabon: Number(fila.eslabon),
    factura_id: esAnclaje ? null : fila.id,
    fecha: fila.created_at ? new Date(fila.created_at).toISOString().slice(0, 10) : null,
    hash_corto: hashCorto(fila.hash_cadena),
    t_co2e: Number(fila.total_co2e || 0),
    tipo: esAnclaje ? 'anclaje' : 'documento',
  };
}
