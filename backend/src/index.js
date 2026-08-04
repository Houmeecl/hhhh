import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config.js';
import { runMigrations } from './lib/migrate.js';
import { verificarConfigProduccion } from './lib/verificarProduccion.js';
import { apiLimiter } from './middleware/rateLimit.js';
import publicRoutes from './routes/public.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import corredorRoutes from './routes/corredor.js';
import capitalRoutes from './routes/capital.js';
import informesRoutes from './routes/informes.js';
import buscarRoutes from './routes/buscar.js';
import clienteRoutes from './routes/cliente.js';
import valorizacionRoutes from './routes/valorizacion.js';
import transporteRoutes from './routes/transporte.js';
import mandanteRoutes from './routes/mandante.js';
import accesosRoutes from './routes/accesos.js';
import motorRoutes from './routes/motor.js';
import cadenaRoutes from './routes/cadena.js';
import posRoutes, { adminRouter as posAdminRoutes } from './routes/pos.js';
import origenRoutes, { tarjetaRouter, firmaProveedorRouter, proveedorPanelRouter } from './routes/origen.js';
import { torreRouter } from './routes/torre.js';
import capacitacionRoutes from './routes/capacitacion.js';
import aplRoutes from './routes/apl.js';
import webauthnRoutes from './routes/webauthn.js';
import puertoRoutes from './routes/puerto.js';
import agenciaRoutes from './routes/agencia.js';
import trazadorRoutes from './routes/trazador.js';
import { iniciarDolarAutomatico } from './services/tipoCambio.js';
import { iniciarPurgaAutomatica } from './services/retencion.js';

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
app.use('/api/auth/webauthn', webauthnRoutes);
app.use('/api/admin/corredor', corredorRoutes);
app.use('/api/admin/capital', capitalRoutes);
app.use('/api/admin/informes', informesRoutes);
app.use('/api/admin/buscar', buscarRoutes);
app.use('/api', clienteRoutes);
app.use('/api/admin/valorizacion', valorizacionRoutes);
app.use('/api/admin/transporte', transporteRoutes);
app.use('/api/admin/accesos', accesosRoutes);
app.use('/api/mandante', apiLimiter, mandanteRoutes);
app.use('/api/puerto', apiLimiter, puertoRoutes);
app.use('/api/agencia', apiLimiter, agenciaRoutes);
app.use('/api/trazador', apiLimiter, trazadorRoutes);
// Prefijo canónico del motor de cálculo: es el único que usa el frontend
// actual (ver frontend/src/api.js, funciones motor*). No confundir con la
// ruta React /admin/motor del panel ("Motor externo"), que es navegación
// de UI, no API.
app.use('/api/admin/motor-propio', motorRoutes);
// Alias de compatibilidad del mismo router: versiones anteriores del
// panel consumían /api/admin/motor/*. Ningún código de este repo lo usa
// hoy; se mantiene solo por si quedan consumidores externos desplegados.
app.use('/api/admin/motor', motorRoutes);
app.use('/api/admin/cadena', cadenaRoutes);
app.use('/api/pos', apiLimiter, posRoutes);
app.use('/api/admin/pos', posAdminRoutes);
app.use('/api/admin/origen', origenRoutes);
app.use('/api/tarjeta', apiLimiter, tarjetaRouter);
app.use('/api/torre', apiLimiter, torreRouter);
app.use('/api/firma-proveedor', apiLimiter, firmaProveedorRouter);
app.use('/api/panel-proveedor', apiLimiter, proveedorPanelRouter);
app.use('/api/admin/capacitacion', capacitacionRoutes);
app.use('/api/admin/apl', aplRoutes);
// '/api/admin' (genérico) se monta AL FINAL de los /api/admin/* — Express
// hace match de app.use por prefijo en orden de registro, así que si fuera
// primero, requireHomePanel('sicrep') de este router interceptaría TODAS
// las rutas /api/admin/pos/* (panel del mostrador presencial) antes de que lleguen a
// su propio router con requireHomePanel('aduana_verde').
app.use('/api/admin', adminRoutes);

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
    // En producción, una configuración insegura (secretos de desarrollo,
    // SEED_DEMO prendido) aborta el arranque; en desarrollo solo se avisa.
    const { fatales, advertencias } = verificarConfigProduccion(config);
    for (const a of advertencias) console.warn(`[config] aviso: ${a}`);
    if (fatales.length) {
      for (const f of fatales) console.error(`[config] ${config.env === 'production' ? 'FATAL' : 'aviso (fatal en producción)'}: ${f}`);
      if (config.env === 'production') process.exit(1);
    }
    // Aplica migraciones al arrancar (idempotente).
    await runMigrations();
    // Dólar observado automático: solo actúa si el admin activó el modo
    // auto en config_pos (si no, cada tick es un SELECT y nada más).
    if (config.env !== 'test') iniciarDolarAutomatico();
    // Purga de datos personales vencidos (Ley 21.719). Ver
    // services/retencion.js: no toca nada encadenado por hash.
    if (config.env !== 'test') iniciarPurgaAutomatica();
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
