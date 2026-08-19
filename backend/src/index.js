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
import transporteProveedorRoutes from './routes/transporteProveedor.js';
import { adminRouter as cobrosAdminRoutes, publicRouter as pagarRoutes, webhookRouter as pagosWebhookRoutes } from './routes/cobros.js';
import { iniciarDolarAutomatico } from './services/tipoCambio.js';
import { iniciarPurgaAutomatica } from './services/retencion.js';
import { iniciarAlertasAutomaticas } from './services/alertas.js';

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

// Salud del servicio. Antes respondía ok:true sin tocar la base: si Postgres
// caía después del arranque, el auto-deploy (deploy/actualizar.sh) seguía
// viendo verde, no disparaba rollback, y el monitoreo externo veía el
// servicio sano con el 100% de las peticiones reales en 500. El SELECT 1
// con plazo corto obliga a que "sano" signifique "puede hablar con la BD".
app.get('/api/health', async (req, res) => {
  try {
    await estaSano();
    res.json({ ok: true, mock: config.simple.mock, env: config.env });
  } catch {
    res.status(503).json({ ok: false, error: 'BD no disponible' });
  }
});

// Rutas
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
// Ley REP del propio proveedor (productos + ventas): router aparte para no
// seguir engordando origen.js — misma autenticación de panel 'proveedor'.
app.use('/api/panel-proveedor/rep', apiLimiter, repProveedorRoutes);
// Transporte de personal (Cat. 7) del propio proveedor: router aparte,
// mismo criterio que rep — no seguir engordando origen.js.
app.use('/api/panel-proveedor/transporte', apiLimiter, transporteProveedorRoutes);
// Expedientes de evidencia (migración 105): la venta como carpeta, con sus
// documentos relacionados y sus brechas. Mismo criterio de router aparte y
// misma autenticación de panel 'proveedor'.
app.use('/api/panel-proveedor/expedientes', apiLimiter, expedientesRoutes);
app.use('/api/admin/cobros', cobrosAdminRoutes);
// Página pública de pago. Va con apiLimiter como todo lo público: el
// token es largo, pero el endpoint igual es adivinable y no hay motivo
// para dejarlo sin freno.
app.use('/api/pagar', apiLimiter, pagarRoutes);
// El webhook de la pasarela va SIN apiLimiter: lo llama el servidor de
// Flow desde su propia IP y, si un pico de pagos agotara la cuota, se
// quedarían sin entregar accesos ya pagados. Que el aviso sea inofensivo
// no depende del límite sino de que no se le crea: el estado se pregunta
// de vuelta a Flow firmando la consulta (services/pagos.js).
app.use('/api/pagos', pagosWebhookRoutes);
app.use('/api/admin/capacitacion', capacitacionRoutes);
app.use('/api/admin/apl', aplRoutes);
app.use('/api/juego', apiLimiter, juegoRoutes);
// '/api/admin' (genérico) se monta AL FINAL de los /api/admin/* — Express
// hace match de app.use por prefijo en orden de registro, así que si fuera
// primero, requireHomePanel('sicrep') de este router interceptaría TODAS
// las rutas /api/admin/pos/* (panel del mostrador presencial) antes de que lleguen a
// su propio router con requireHomePanel('aduana_verde').
app.use('/api/admin', adminRoutes);

// 404
app.use('/api', (req, res) => res.status(404).json({ error: 'Recurso no encontrado' }));

// Manejador de errores centralizado. Antes solo logueaba err.message: sin
// stack ni ruta, un 500 en producción no daba pistas de dónde investigar —
// había que reproducirlo a mano. El cliente sigue recibiendo el mismo
// mensaje genérico (nunca el stack ni el detalle interno).
app.use((err, req, res, next) => {
  const status = err.status || 500;
  console.error(`[error] ${req.method} ${req.originalUrl} → ${status}:`, err.stack || err.message);
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

    // El Corredor Bioceánico vive en OTRA BASE (ver lib/dbCorredor.js), y
    // su migración NO es fatal a propósito. Este bloque está dentro del
    // try que hace process.exit(1): si `sicr3p_corredor` no existe todavía
    // en el servidor, o una migración suya falla, dejar caer el backend
    // sacaría de línea a todas las empresas que solo usan la contabilidad
    // de carbono — por un producto que ellas no usan. Se avisa fuerte y
    // las rutas del Corredor responden 503 hasta que se arregle.
    const corredor = await runMigrationsCorredor();
    if (corredor.estado === 'apagado') {
      console.log('[corredor] apagado en este entorno (sin DATABASE_URL_CORREDOR).');
    } else if (corredor.estado === 'error') {
      console.warn('[corredor] con problemas: sus rutas van a responder 503. El resto del backend sigue normal.');
    } else {
      console.log(`[corredor] base lista (${corredor.archivos} migraciones).`);
    }
    // Dólar observado automático: solo actúa si el admin activó el modo
    // auto en config_pos (si no, cada tick es un SELECT y nada más).
    if (config.env !== 'test') iniciarDolarAutomatico();
    // Purga de datos personales vencidos (Ley 21.719). Ver
    // services/retencion.js: no toca nada encadenado por hash.
    if (config.env !== 'test') iniciarPurgaAutomatica();
    // Recordatorio de vencimiento de contrato (7/3/1 día antes + vencido).
    // Ver services/alertas.js.
    if (config.env !== 'test') iniciarAlertasAutomaticas();
    const server = app.listen(config.port, () => {
      console.log(`\n  sicr3p backend escuchando en http://localhost:${config.port}`);
      console.log(`  Modo motor: ${config.simple.mock ? 'MOCK (simulado)' : 'PRODUCCIÓN (API real)'}`);
      console.log(`  CORS origin: ${config.corsOrigin}\n`);
    });
    // Sin esto, un cliente que envía los headers HTTP byte a byte (slowloris)
    // puede sostener una conexión indefinidamente y agotar el pool de
    // conexiones del servidor. 65 s es amplio para cualquier cliente real —
    // los headers llegan de un tirón sin importar qué tan lento sea el
    // upload del cuerpo (documentos de hasta 15 MB × 5 archivos).
    server.headersTimeout = 65_000;
    // Plazo total para recibir la petición completa (headers + cuerpo).
    // Generoso a propósito: cubre subir 5 documentos de 15 MB cada uno desde
    // una conexión móvil lenta sin cortar un upload real a mitad de camino.
    server.requestTimeout = 300_000;
  } catch (err) {
    console.error('[fatal] no se pudo iniciar el servidor:', err.message);
    process.exit(1);
  }
}

start();
