import crypto from 'crypto';

// ============================================================
// Candado del dispositivo: la clave SII se guarda "bajo código".
//   - verificador: scrypt(clave, salt)  -> para comprobar el login
//   - cifrado en reposo: AES-256-GCM(clave) con clave derivada de scrypt
// La clave en texto plano NUNCA se persiste ni se registra.
// ============================================================

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

function scrypt(pass, salt) {
  return crypto.scryptSync(String(pass), salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024,
  });
}

// Verificador para el login (formato: scrypt$saltHex$hashHex).
export function hashClave(clave) {
  const salt = crypto.randomBytes(16);
  const hash = scrypt(clave, salt);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyClave(clave, stored) {
  try {
    const [alg, saltHex, hashHex] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = scrypt(clave, salt);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// Cifra un texto (p.ej. la propia clave SII o notas) con AES-256-GCM.
// La llave se deriva de `secreto` (la clave del dueño) + salt propio.
export function encrypt(texto, secreto) {
  const salt = crypto.randomBytes(16);
  const key = scrypt(secreto, salt);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(texto), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [salt, iv, tag, enc].map((b) => b.toString('hex')).join('$');
}

export function decrypt(blob, secreto) {
  const [saltHex, ivHex, tagHex, encHex] = String(blob).split('$');
  const key = scrypt(secreto, Buffer.from(saltHex, 'hex'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8');
}

export const randomId = () => crypto.randomUUID();
export const randomSecret = () => crypto.randomBytes(48).toString('hex');
