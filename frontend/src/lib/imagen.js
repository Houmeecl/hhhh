// Comprime una foto a JPEG (lado mayor ≤1568 px): convierte el HEIC del
// iPhone a un formato que la IA acepta y acota el peso del upload y el
// costo de visión. Si el navegador no puede decodificarla, se envía tal
// cual y el backend decide. Compartida por el juego (Reciclar.jsx) y la
// estimación de embalaje REP por foto (EstimarEmbalajeFoto.jsx).
export async function comprimirImagen(file, nombre = 'foto.jpg') {
  try {
    const bitmap = await createImageBitmap(file);
    const escala = Math.min(1, 1568 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * escala);
    canvas.height = Math.round(bitmap.height * escala);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.8));
    if (!blob) return file;
    return new File([blob], nombre, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}
