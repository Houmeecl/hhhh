import crypto from 'crypto';

// ============================================================
// Helpers puros de la API de mandantes (testeables sin DB),
// usados por routes/mandante.js y routes/accesos.js.
// ============================================================

// Hash de la API key (nunca se guarda ni se compara en texto plano).
export function hashApiKey(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex');
}

// RUT normalizado (sin puntos ni guión, K mayúscula) para cruces por RUT.
export function normalizarRut(rut) {
  return String(rut || '').replace(/[^0-9kK]/g, '').toUpperCase();
}
