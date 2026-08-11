// ============================================================
// CSV mínimo (RFC 4180) sin dependencia nueva. Escapa comas, comillas
// y saltos de línea — necesario porque nombres/descripciones libres
// (glosas del motor, razones sociales) pueden traerlos.
// ============================================================

export function csvEscape(valor) {
  const s = valor === null || valor === undefined ? '' : String(valor);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function filasACsv(headers, filas) {
  const lineas = [headers.map(csvEscape).join(',')];
  for (const fila of filas) lineas.push(headers.map((h) => csvEscape(fila[h])).join(','));
  return lineas.join('\r\n') + '\r\n';
}
