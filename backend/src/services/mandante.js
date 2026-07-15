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

// Rangos de IPv4 privados/locales — bloqueo básico de SSRF para webhooks
// configurados por el propio mandante. No resuelve DNS (no protege de DNS
// rebinding); es una barrera simple contra apuntar el webhook a la red interna.
const IPV4_PRIVADA = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[0-1])\./, /^169\.254\./, /^0\./];

export function webhookUrlValida(url) {
  if (!url) return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (!['http:', 'https:'].includes(u.protocol)) return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host === '::1' || host === '') return false;
  if (IPV4_PRIVADA.some((re) => re.test(host))) return false;
  return true;
}

// Notifica una URL externa (best-effort, no bloqueante, nunca lanza).
export async function dispararWebhook({ url, payload }) {
  if (!webhookUrlValida(url)) return { ok: false, error: 'URL inválida' };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'sicr3p-webhook/1.0' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
