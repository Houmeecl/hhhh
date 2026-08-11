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

// URL pública del Pasaporte de Origen de un lote mineral.
export function loteUrl(codigo) {
  return `${config.publicAppUrl}/lote/${codigo}`;
}

// URL pública de la tarjeta de viaje (credencial virtual con QR).
export function tarjetaUrl(serial) {
  return `${config.publicAppUrl}/v/${serial}`;
}

// URL pública de verificación de una constancia de capacitación.
export function constanciaUrl(serial) {
  return `${config.publicAppUrl}/constancia/${serial}`;
}

// URL pública de verificación de un canje de constancia de "Sube y Suma".
export function constanciaJuegoUrl(serial) {
  return `${config.publicAppUrl}/suma/constancia/${serial}`;
}

// URL de la pantalla Reciclar de "Sube y Suma" con el punto limpio
// pre-seleccionado — es lo que codifica el cartel QR del punto.
export function reciclarUrl(token) {
  return `${config.publicAppUrl}/suma/reciclar?punto=${encodeURIComponent(token)}`;
}

// URL pública de la credencial de firma del proveedor (atestación).
export function firmaProveedorUrl(serial) {
  return `${config.publicAppUrl}/f/${serial}`;
}

// URL del cartel QR de un punto de control del Corredor Bioceánico — lo
// que el portador de la Tarjeta de Viaje escanea en el punto físico para
// autocompletar el paso en vez de tipearlo (frontend/src/lib/corredor.js).
export function puntoControlUrl(puntoId) {
  return `${config.publicAppUrl}/pc/${puntoId}`;
}

// Buffer PNG de un QR para cualquier URL propia (pasaporte, verificar).
// `width` opcional: 320 para embeber en PDF/pantalla, más grande (ej.
// 1024) para carteles imprimibles como el del punto limpio.
export async function qrBufferDe(url, width = 320) {
  return QRCode.toBuffer(url, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width,
    color: { dark: '#0f1f2e', light: '#ffffff' },
  });
}
