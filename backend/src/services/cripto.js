// ============================================================
// Cifrado simétrico en reposo (AES-256-GCM) para secretos que hay que
// poder recuperar en claro — hoy: la clave tributaria del SII que el
// proveedor autoriza guardar para no reescribirla en cada descarga.
//
// Reglas de oro:
//  - La llave vive SOLO en env (SII_CRED_KEY), nunca en la BD. Si se filtra
//    la base de datos, los blobs quedan cifrados e inservibles.
//  - GCM añade un tag de autenticación: descifrar un blob manipulado falla
//    en vez de devolver basura.
//  - En producción SII_CRED_KEY es obligatoria (verificarProduccion.js).
//    En desarrollo cae a una llave fija bien marcada, solo para no bloquear
//    el flujo local — jamás protege nada real.
// ============================================================
import crypto from 'crypto';
import { config } from '../config.js';

const LLAVE_DEV = 'dev_sii_cred_key_change_me_please_0000000000';

// Deriva 32 bytes deterministas de lo que venga en env: acepta hex de 64
// caracteres tal cual, y cualquier otra cosa la pasa por scrypt (así una
// passphrase corta también sirve, sin exigir un formato exacto al operador).
function derivarLlave(secreto) {
  if (/^[0-9a-fA-F]{64}$/.test(secreto)) return Buffer.from(secreto, 'hex');
  // Sal fija: la derivación debe ser reproducible entre reinicios para poder
  // descifrar lo ya guardado. La seguridad la aporta el secreto, no la sal.
  return crypto.scryptSync(secreto, 'sicr3p:sii-cred:v1', 32);
}

function llave() {
  const secreto = config.cripto.siiKey || (config.env === 'production' ? '' : LLAVE_DEV);
  if (!secreto) throw new Error('SII_CRED_KEY no configurada: no se pueden cifrar credenciales.');
  return derivarLlave(secreto);
}

// ¿Se puede cifrar/descifrar? En prod, solo con SII_CRED_KEY puesta; en dev,
// siempre (llave fija). Sirve para apagar la funcionalidad con elegancia si
// falta la llave, en vez de reventar a mitad de un handler.
export function cifradoDisponible() {
  return Boolean(config.cripto.siiKey) || config.env !== 'production';
}

// Devuelve un string "iv:tag:ciphertext" en base64, listo para guardar en
// una columna TEXT.
export function cifrar(textoPlano) {
  const key = llave();
  const iv = crypto.randomBytes(12); // 96 bits, recomendado para GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(textoPlano), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

// Inverso de cifrar(). Lanza si el blob fue manipulado o la llave no cuadra.
export function descifrar(blob) {
  const key = llave();
  const [ivB64, tagB64, ctB64] = String(blob).split(':');
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('Blob cifrado con formato inválido.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}
