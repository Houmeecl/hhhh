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

// Mapea una fila de `facturas` a su versión pública. SOLO estas cinco
// claves: eslabon, factura_id, fecha, hash_corto, t_co2e. Cualquier
// campo nuevo debe pasar por aquí a propósito (y por su test).
export function filaEslabonPublico(factura) {
  return {
    eslabon: Number(factura.eslabon),
    factura_id: factura.id,
    fecha: factura.created_at ? new Date(factura.created_at).toISOString().slice(0, 10) : null,
    hash_corto: hashCorto(factura.hash_cadena),
    t_co2e: Number(factura.total_co2e || 0),
  };
}
