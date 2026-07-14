import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config.js';
import { runMigrations } from './lib/migrate.js';
import { apiLimiter } from './middleware/rateLimit.js';
import publicRoutes from './routes/public.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import corredorRoutes from './routes/corredor.js';
import capitalRoutes from './routes/capital.js';
import informesRoutes from './routes/informes.js';

const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(
  cors({
    origin: config.corsOrigin.split(',').map((s) => s.trim()),
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));

// Salud del servicio
app.get('/api/health', (req, res) => res.json({ ok: true, mock: config.simple.mock, env: config.env }));

// Rutas
app.use('/api', apiLimiter, publicRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/corredor', corredorRoutes);
app.use('/api/admin/capital', capitalRoutes);
app.use('/api/admin/informes', informesRoutes);

// 404
app.use('/api', (req, res) => res.status(404).json({ error: 'Recurso no encontrado' }));

// Manejador de errores centralizado
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  const status = err.status || 500;
  res.status(status).json({ error: status === 500 ? 'Error interno del servidor' : err.message });
});

async function start() {
  try {
    // Aplica migraciones al arrancar (idempotente).
    await runMigrations();
    app.listen(config.port, () => {
      console.log(`\n  sicr3p backend escuchando en http://localhost:${config.port}`);
      console.log(`  Modo motor: ${config.simple.mock ? 'MOCK (simulado)' : 'PRODUCCIÓN (API real)'}`);
      console.log(`  CORS origin: ${config.corsOrigin}\n`);
    });
  } catch (err) {
    console.error('[fatal] no se pudo iniciar el servidor:', err.message);
    process.exit(1);
  }
}

start();
