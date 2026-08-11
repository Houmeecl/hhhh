import QRCode from 'qrcode';

// URL pública local de verificación de trazabilidad (servidor del propio dispositivo).
export function verifyUrl(baseUrl, facturaId) {
  return `${baseUrl.replace(/\/$/, '')}/verificar/${facturaId}`;
}

export function qrBuffer(baseUrl, facturaId) {
  return QRCode.toBuffer(verifyUrl(baseUrl, facturaId), {
    errorCorrectionLevel: 'M', margin: 1, width: 320,
    color: { dark: '#0f1f2e', light: '#ffffff' },
  });
}
