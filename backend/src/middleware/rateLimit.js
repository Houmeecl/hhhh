import rateLimit from 'express-rate-limit';

// Rate limiting específico para el login (mitiga fuerza bruta).
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Intenta nuevamente en unos minutos.' },
});

// Consultas de situación tributaria (BaseAPI). Mucho más estricto que el
// límite general: cada consulta consume cuota pagada, y el endpoint
// público no puede convertirse en un proxy SII abierto a internet.
// Dos instancias separadas: el tráfico anónimo de /inscripcion no debe
// competir por cupo con el admin dando de alta clientes desde la misma IP.
const siiLimiterOpts = (max) => ({
  windowMs: 60 * 60 * 1000, // 1 hora
  max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas consultas de RUT. Intenta más tarde.' },
});
export const siiLimiter = rateLimit(siiLimiterOpts(10));
export const siiLimiterAdmin = rateLimit(siiLimiterOpts(30));

// Carga de documentos en el flujo público (POST /api/sesiones). Cada archivo
// puede gatillar hasta tres llamadas a la API de IA (capa de texto + dos
// pasadas de OCR), así que el límite general de 300 por cuarto de hora deja
// pasar más gasto del que nadie autorizó.
//
// El número es alto a propósito. Quien de verdad frena al abusador es la
// pre-validación del código de acceso en public.js (sin código válido no se
// llega a leer nada) y el presupuesto diario de analisisIA.js; este límite
// solo corta la ráfaga. Un tope bajo castigaría al cliente que paga —sube su
// mes en tandas de 5, y una empresa detrás de un NAT comparte la IP entre
// todos sus usuarios— sin molestar al que rota direcciones.
export const cargaLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados envíos seguidos. Intenta nuevamente en un rato.' },
});

// Formularios de captación (POST /api/interesados). 10 por hora por IP
// alcanza de sobra para cualquier humano (nadie deja su correo 10 veces)
// y corta la ráfaga de un script simple; al bot genérico lo frena antes
// el honeypot (services/interesados.js). Captcha queda para cuando haya
// abuso real, no antes: cada fricción extra en un formulario de lead es
// un lead menos.
export const leadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados envíos seguidos. Intenta nuevamente en un rato.' },
});

// Límite general de la API pública.
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
