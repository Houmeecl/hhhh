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

// Inversa de normalizarRut: 76222089K → 76.222.089-K. Los RUT se guardan
// normalizados (así se cruzan), pero un documento que se le entrega a una
// empresa, a un mandante o a una autoridad tiene que mostrarlos como se
// escriben en Chile. Si el valor no tiene la forma de un RUT se devuelve tal
// cual, para no inventar puntuación sobre un dato que no se entiende.
export function formatearRut(rut) {
  const crudo = String(rut || '');
  // La forma se valida sobre el valor CRUDO, no sobre el normalizado:
  // normalizarRut borra las letras distintas de K antes de mirar, así que un
  // identificador extranjero como 'ABC123' se habría convertido en '12-3'.
  // Se aceptan las dos escrituras que existen en la BD: normalizada
  // (76222089K) y con puntuación chilena (76.222.089-K).
  if (!/^\d{1,3}(\.?\d{3})*-?[\dkK]$/.test(crudo.trim())) return crudo;
  const limpio = normalizarRut(crudo);
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);
  return `${cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv}`;
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
