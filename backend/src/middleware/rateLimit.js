import rateLimit from 'express-rate-limit';

// Rate limiting específico para el login (mitiga fuerza bruta).
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Intenta nuevamente en unos minutos.' },
});

// Consultas públicas de situación tributaria (autocompletado del
// formulario de inscripción). Mucho más estricto que el límite general:
// cada consulta a BaseAPI consume cuota pagada, y este endpoint no puede
// convertirse en un proxy SII abierto a internet.
export const siiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas consultas de RUT. Intenta más tarde.' },
});

// Límite general de la API pública.
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
