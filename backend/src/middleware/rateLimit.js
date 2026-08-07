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

// Límite general de la API pública.
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
