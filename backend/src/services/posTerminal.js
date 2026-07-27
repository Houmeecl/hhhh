import crypto from 'crypto';

// ============================================================
// Terminales POS de mostrador — helpers puros (sin BD).
// El terminal se autentica como dispositivo con serial + clave,
// patrón VecinoXpress/NotaryPro (pos_devices).
// ============================================================

// Alfabeto legible para teclear en tablet: sin caracteres ambiguos
// (se excluyen 0/O, 1/I/l y también L mayúscula por parecerse a I/1
// en varias tipografías de pantalla).
export const ALFABETO_CLAVE = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export const LARGO_CLAVE = 10;

// Serial corto y legible: AV- + 4 hex mayúsculas (ej: AV-3F0A).
// Se pega físicamente en el equipo; la unicidad la garantiza el
// UNIQUE de la tabla (la ruta reintenta si colisiona).
export function generarSerial() {
  return `AV-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

// Clave de dispositivo: 10 caracteres cripto-aleatorios del alfabeto
// sin ambiguos. Se usa crypto.randomInt para evitar sesgo de módulo.
export function generarClave() {
  let clave = '';
  for (let i = 0; i < LARGO_CLAVE; i++) {
    clave += ALFABETO_CLAVE[crypto.randomInt(ALFABETO_CLAVE.length)];
  }
  return clave;
}

// Valida el formato de serial AV-XXXX (4 hex mayúsculas).
export function serialValido(s) {
  return typeof s === 'string' && /^AV-[0-9A-F]{4}$/.test(s);
}

// Un trámite del POS puede procesar hasta 5 documentos (mismo tope que
// POST /api/sesiones). El terminal reporta cuántos fueron; cualquier
// valor inválido o fuera de rango cuenta como 1 — el contador jamás
// retrocede ni salta por un body malicioso.
export const MAX_DOCS_TRAMITE = 5;

export function clampDocumentos(valor) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(n, MAX_DOCS_TRAMITE);
}
