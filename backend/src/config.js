import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Carga backend/.env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const bool = (v, def = false) =>
  v === undefined ? def : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  publicAppUrl: process.env.PUBLIC_APP_URL || 'http://localhost:5173',

  databaseUrl: process.env.DATABASE_URL,

  simple: {
    mock: bool(process.env.MOCK_SIMPLE, true),
    base: process.env.SIMPLE_API_BASE || 'https://app.itssimple.com/public/v1',
    key: process.env.SIMPLE_API_KEY || '',
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev_access_secret_change_me',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret_change_me',
    accessTtl: process.env.JWT_ACCESS_TTL || '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL || '7d',
  },
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),

  resend: {
    apiKey: process.env.RESEND_API_KEY || '',
    from: process.env.MAIL_FROM || 'sicr3p <no-responder@sicrep.cl>',
  },

  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@sicrep.cl',
    password: process.env.ADMIN_PASSWORD || '',
  },

  // Export de datos escaneados a BigQuery (apagado por defecto).
  // Se activa con BIGQUERY_EXPORT=true + una cuenta de servicio de GCP.
  bigquery: {
    enabled: bool(process.env.BIGQUERY_EXPORT, false),
    projectId: process.env.BQ_PROJECT_ID || '',
    dataset: process.env.BQ_DATASET || 'sicr3p',
    // Ruta al JSON de la cuenta de servicio (rol: BigQuery Data Editor).
    keyFile: process.env.BQ_KEY_FILE || process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
  },

  // Límite duro de facturas por envío en el flujo público
  maxFilesPerSession: 5,

  // Sembrar datos de demostración (clientes/prospectos ficticios).
  // SOLO para entornos de prueba; en producción debe quedar en false.
  seedDemo: bool(process.env.SEED_DEMO, false),
};
