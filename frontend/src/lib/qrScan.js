import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

// ============================================================
// Escaneo de QR con la cámara del teléfono — usado por TarjetaViaje.jsx
// para que el portador autocomplete el punto de control en vez de
// tipearlo. Cámara trasera (facingMode 'environment'), sin librería de
// gestión de cámara: el stream se abre/cierra acá mismo.
//
// Decodificación: si el navegador trae BarcodeDetector nativo (Chrome/
// Edge Android) se usa directo sobre el <video> — más rápido, cero JS de
// decodificación. Si no (Safari iOS aún no lo soporta de forma estable),
// se cae a jsQR sobre un frame dibujado en un <canvas> oculto.
//
// Nunca bloquea: cualquier error (permiso denegado, cámara inexistente,
// navegador sin soporte) se reporta vía onError y el llamador debe caer
// al flujo manual — ver TarjetaViaje.jsx.
// ============================================================

function tieneBarcodeDetectorQr() {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window;
}

export function useEscanerQR({ activo, onDetect, onError }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const detectadoRef = useRef(false);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    if (!activo) return;
    detectadoRef.current = false;
    let cancelado = false;

    async function iniciar() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (cancelado) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setListo(true);

        if (tieneBarcodeDetectorQr()) {
          escanearConBarcodeDetector(video);
        } else {
          escanearConJsQR(video);
        }
      } catch (err) {
        if (!cancelado) onError?.(err);
      }
    }

    async function escanearConBarcodeDetector(video) {
      let detector;
      try {
        // eslint-disable-next-line no-undef
        detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      } catch {
        return escanearConJsQR(video); // constructor existe pero falla: mismo fallback
      }
      const paso = async () => {
        if (cancelado || detectadoRef.current) return;
        try {
          const codigos = await detector.detect(video);
          if (codigos.length && codigos[0].rawValue) {
            detectadoRef.current = true;
            onDetect?.(codigos[0].rawValue);
            return;
          }
        } catch { /* frame ilegible, se reintenta en el próximo */ }
        rafRef.current = requestAnimationFrame(paso);
      };
      rafRef.current = requestAnimationFrame(paso);
    }

    function escanearConJsQR(video) {
      const canvas = canvasRef.current || document.createElement('canvas');
      canvasRef.current = canvas;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const paso = () => {
        if (cancelado || detectadoRef.current) return;
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const codigo = jsQR(frame.data, frame.width, frame.height);
          if (codigo?.data) {
            detectadoRef.current = true;
            onDetect?.(codigo.data);
            return;
          }
        }
        rafRef.current = requestAnimationFrame(paso);
      };
      rafRef.current = requestAnimationFrame(paso);
    }

    iniciar();

    return () => {
      cancelado = true;
      setListo(false);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [activo]);

  return { videoRef, listo };
}

// Extrae el id del punto de una URL /pc/{id} o de un texto crudo — la
// pantalla del punto de control (frontend/src/pages/PuntoControl.jsx) es
// lo que codifica el cartel físico, pero si el QR trae solo el slug
// (ej. reimpreso a mano) también se reconoce.
export function idPuntoDesdeQr(texto) {
  const t = String(texto || '').trim();
  const m = t.match(/\/pc\/([a-z0-9-]+)/i);
  if (m) return m[1].toLowerCase();
  if (/^[a-z0-9-]+$/i.test(t)) return t.toLowerCase();
  return null;
}
