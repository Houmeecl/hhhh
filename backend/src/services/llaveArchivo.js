// ============================================================
// Llave de archivo — helpers puros (generación e identificación).
// Ver migración 068 para el diseño de seguridad completo.
// ============================================================
import crypto from 'crypto';

// LA-XXXX (4 hex mayúsculas, 2 bytes) — identificador público, como
// las TV-/FP- de tarjetas de viaje y credenciales de proveedor.
export function generarSerialLlave() {
  return `LA-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

// Token opaco de alta entropía que vive DENTRO del archivo .sicr3p-llave.
export function generarToken() {
  return crypto.randomBytes(48).toString('hex');
}

// PIN de 6 dígitos, siempre aleatorio (sin atajo para SEED_DEMO): es la
// parte que un humano escribe, y por eso la única corta a propósito.
export function generarPin() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

// El token es de alta entropía (96 chars hex): sha256 alcanza y, a
// diferencia de bcrypt, no lo trunca a 72 bytes. Comparación en tiempo
// constante para no filtrar por timing cuánto del hash coincide.
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function tokenCoincide(token, hash) {
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(String(hash || ''), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
