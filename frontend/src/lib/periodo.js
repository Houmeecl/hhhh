// Período tributario 'AAAA-MM'. El input type="month" cae a texto libre en
// navegadores sin soporte (ej. Firefox de escritorio), así que lo que
// escriba la persona se normaliza antes de enviar y se valida acá mismo —
// el error de formato se muestra al tiro, sin gastar una llamada al SII.
export function normalizarPeriodo(p) {
  const s = String(p || '').trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})$/); // 2026-6, 2026/06
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{4})$/); // 06/2026, 6-2026
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.]\d{1,2}/); // fecha completa → su mes
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  return s;
}

export const periodoValido = (p) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(p || ''));
