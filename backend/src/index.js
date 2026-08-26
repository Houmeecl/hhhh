import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config.js';
import { runMigrations, runMigrationsCorredor } from './lib/migrate.js';
import { verificarConfigProduccion } from './lib/verificarProduccion.js';
import { estaSano } from './lib/health.js';
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
import activosRoutes from './routes/activos.js';
import motorRoutes from './routes/motor.js';
import cadenaRoutes from './routes/cadena.js';
import posRoutes, { adminRouter as posAdminRoutes } from './routes/pos.js';
import origenRoutes, { tarjetaRouter, firmaProveedorRouter, proveedorPanelRouter } from './routes/origen.js';
import { torreRouter } from './routes/torre.js';
import capacitacionRoutes from './routes/capacitacion.js';
import aplRoutes from './routes/apl.js';
import webauthnRoutes from './routes/webauthn.js';
import llaveArchivoRoutes from './routes/llaveArchivo.js';
import puertoRoutes from './routes/puerto.js';
import agenciaRoutes from './routes/agencia.js';
import trazadorRoutes from './routes/trazador.js';
import juegoRoutes from './routes/juego.js';
import repProveedorRoutes from './routes/repProveedor.js';
import expedientesRoutes from './routes/expedientes.js';
import documentosExpedienteRoutes from './routes/documentosExpediente.js';
import transporteProveedorRoutes from './routes/transporteProveedor.js';
import corredorApiRoutes from './routes/corredorApi.js';
import { adminRouter as cobrosAdminRoutes, publicRouter as pagarRoutes, webhookRouter as pagosWebhookRoutes } from './routes/cobros.js';
import { iniciarDolarAutomatico } from './services/tipoCambio.js';
import { iniciarPurgaAutomatica } from './services/retencion.js';
import { iniciarAlertasAutomaticas } from './services/alertas.js';

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: config.corsOrigin.split(',').map((s) => s.trim()), credentials: true }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (req, res) => {
  try {
    await estaSano();
    res.json({ ok: true, mock: config.simple.mock, env: config.env });
  } catch {
    res.status(503).json({ ok: false, error: 'BD no disponible' });
  }
});

app.use('/api', apiLimiter, publicRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/auth/webauthn', webauthnRoutes);
app.use('/api/auth/llave-archivo', llaveArchivoRoutes);
app.use('/api/admin/corredor', corredorRoutes);
app.use('/api/admin/capital', capitalRoutes);
app.use('/api/admin/informes', informesRoutes);
app.use('/api/admin/buscar', buscarRoutes);
app.use('/api', clienteRoutes);
app.use('/api/admin/valorizacion', valorizacionRoutes);
app.use('/api/admin/transporte', transporteRoutes);
app.use('/api/admin/accesos', accesosRoutes);
app.use('/api/admin/activos', activosRoutes);
app.use('/api/mandante', apiLimiter, mandanteRoutes);
app.use('/api/puerto', apiLimiter, puertoRoutes);
app.use('/api/agencia', apiLimiter, agenciaRoutes);
app.use('/api/trazador', apiLimiter, trazadorRoutes);
app.use('/api/admin/motor-propio', motorRoutes);
app.use('/api/admin/motor', motorRoutes);
app.use('/api/admin/cadena', cadenaRoutes);
app.use('/api/pos', apiLimiter, posRoutes);
app.use('/api/admin/pos', posAdminRoutes);
app.use('/api/admin/origen', origenRoutes);
app.use('/api/tarjeta', apiLimiter, tarjetaRouter);
app.use('/api/torre', apiLimiter, torreRouter);
app.use('/api/firma-proveedor', apiLimiter, firmaProveedorRouter);
app.use('/api/panel-proveedor', apiLimiter, proveedorPanelRouter);
app.use('/api/corredor', apiLimiter, corredorApiRoutes);
app.use('/api/panel-proveedor/rep', apiLimiter, repProveedorRoutes);
app.use('/api/panel-proveedor/transporte', apiLimiter, transporteProveedorRoutes);
app.use('/api/panel-proveedor/expedientes', apiLimiter, expedientesRoutes);
app.use('/api/panel-proveedor/documentos', apiLimiter, documentosExpedienteRoutes);
app.use('/api/admin/cobros', cobrosAdminRoutes);
app.use('/api/pagar', apiLimiter, pagarRoutes);
app.use('/api/pagos', pagosWebhookRoutes);
app.use('/api/admin/capacitacion', capacitacionRoutes);
app.use('/api/admin/apl', aplRoutes);
app.use('/api/juego', apiLimiter, juegoRoutes);
app.use('/api/admin', adminRoutes);

app.use('/api', (req, res) => res.status(404).json({ error: 'Recurso no encontrado' }));
app.use((err, req, res, next) => {
  const status = err.status || 500;
  console.error(`[error] ${req.method} ${req.originalUrl} → ${status}:`, err.stack || err.message);
  res.status(status).json({ error: status === 500 ? 'Error interno del servidor' : err.message });
});

async function start() {
  try {
    const { fatales, advertencias } = verificarConfigProduccion(config);
    for (const a of advertencias) console.warn(`[config] aviso: ${a}`);
    if (fatales.length) {
      for (const f of fatales) console.error(`[config] ${config.env === 'production' ? 'FATAL' : 'aviso (fatal en producción)'}: ${f}`);
      if (config.env === 'production') process.exit(1);
    }
    await runMigrations();
    const corredor = await runMigrationsCorredor();
    if (corredor.estado === 'apagado') console.log('[corredor] apagado en este entorno (sin DATABASE_URL_CORREDOR).');
    else if (corredor.estado === 'error') console.warn('[corredor] con problemas: sus rutas van a responder 503. El resto del backend sigue normal.');
    else console.log(`[corredor] base lista (${corredor.archivos} migraciones).`);
    if (config.env !== 'test') iniciarDolarAutomatico();
    if (config.env !== 'test') iniciarPurgaAutomatica();
    if (config.env !== 'test') iniciarAlertasAutomaticas();
    const server = app.listen(config.port, () => {
      console.log(`\n  sicr3p backend escuchando en http://localhost:${config.port}`);
      console.log(`  Modo motor: ${config.simple.mock ? 'MOCK (simulado)' : 'PRODUCCIÓN (API real)'}`);
      console.log(`  CORS origin: ${config.corsOrigin}\n`);
    });
    server.headersTimeout = 65_000;
    server.requestTimeout = 300_000;
  } catch (err) {
    console.error('[fatal] no se pudo iniciar el servidor:', err.message);
    process.exit(1);
  }
}

start();
