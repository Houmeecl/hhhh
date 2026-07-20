import QRCode from 'qrcode';
import { config } from '../config.js';

// URL pública de verificación de trazabilidad de una factura.
export function verifyUrl(facturaId) {
  return `${config.publicAppUrl}/verificar/${facturaId}`;
}

// Devuelve un data URL PNG del QR que apunta a /verificar/{id}.
export async function qrDataUrl(facturaId) {
  return QRCode.toDataURL(verifyUrl(facturaId), {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 320,
    color: { dark: '#0f1f2e', light: '#ffffff' },
  });
}

// Devuelve un Buffer PNG del QR (para embeber en PDF).
export async function qrBuffer(facturaId) {
  return QRCode.toBuffer(verifyUrl(facturaId), {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 320,
    color: { dark: '#0f1f2e', light: '#ffffff' },
  });
}

// URL pública del Pasaporte Digital de Producto de una factura.
export function pasaporteUrl(facturaId) {
  return `${config.publicAppUrl}/pasaporte/${facturaId}`;
}

// Buffer PNG de un QR para cualquier URL propia (pasaporte, verificar).
export async function qrBufferDe(url) {
  return QRCode.toBuffer(url, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 320,
    color: { dark: '#0f1f2e', light: '#ffffff' },
  });
}
