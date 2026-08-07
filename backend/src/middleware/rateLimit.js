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

// Carga de documentos en el flujo público (POST /api/sesiones), que no pide
// login: cada archivo puede gatillar hasta tres llamadas a la API de IA
// (capa de texto + dos pasadas de OCR), así que el límite general de 300 por
// cuarto de hora deja pasar más gasto del que nadie autorizó. Mismo criterio
// que siiLimiter: lo que cuesta plata por request va con su propio tope.
// El freno de gasto en pesos lo pone el presupuesto diario de analisisIA.js;
// esto acota la ráfaga, que es lo que un limitador sí sabe hacer.
export const cargaLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 15,
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
