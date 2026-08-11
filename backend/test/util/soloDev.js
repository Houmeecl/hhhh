// ============================================================
// La suite también corre en el VPS como parte del deploy (CI propio de
// deploy/actualizar.sh), donde backend/.env apunta a la BD DE PRODUCCIÓN.
// Los tests de integración crean y borran filas: jamás deben tocar esa
// base. Importar config (y no leer process.env directo) garantiza que
// dotenv ya corrió cuando se evalúa la condición.
// ============================================================
import { config } from '../../src/config.js';

export const EN_PRODUCCION = config.env === 'production';

// Segundo argumento de test(): `{ skip: SALTO_PROD }` — en desarrollo es
// `false` (el test corre normal); en producción es el motivo del salto.
export const SALTO_PROD = EN_PRODUCCION
  ? 'NODE_ENV=production: los tests de integración no corren contra la BD de producción'
  : false;
