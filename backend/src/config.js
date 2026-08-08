import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Carga backend/.env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const bool = (v, def = false) =>
  v === undefined ? def : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());

// Monto en pesos desde el entorno. Distingue tres casos que `Number(v) || def`
// confunde, y los tres pasan de verdad:
//  · sin definir o vacío  → el default (dotenv entrega '' para `VAR=`, no
//    undefined, así que una línea sin valor caía en 0);
//  · escrito en es-CL     → '20.000' es veinte mil, no veinte. Se acepta solo
//    el patrón inequívoco de miles (grupos exactos de 3); un decimal de
//    verdad ('20.5') no calza y se lee como número normal;
//  · basura               → se avisa y se usa el default, en vez de apagar
//    el gasto en silencio.
export const montoClp = (raw, def, nombre) => {
  const s = String(raw ?? '').trim();
  if (s === '') return def;
  const n = Number(/^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : s);
  if (!Number.isFinite(n) || n < 0) {
    console.warn(`[config] ${nombre}="${s}" no es un monto válido; se usa ${def}.`);
    return def;
  }
  return n;
};

// El tope de gasto diario de la IA se lee ANTES del objeto config porque
// `analisisIA.enabled` depende de él: con tope en 0 la IA no puede llamarse
// nunca, así que declararla "activa" en el panel sería mentir.
const presupuestoIaClp = montoClp(
  process.env.ANALISIS_IA_PRESUPUESTO_DIARIO_CLP, 20000, 'ANALISIS_IA_PRESUPUESTO_DIARIO_CLP'
);

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  publicAppUrl: process.env.PUBLIC_APP_URL || 'http://localhost:5173',

  databaseUrl: process.env.DATABASE_URL,

  // El cobro de compensación es 100% simulado hoy: no hay pasarela conectada
  // ni socio ambiental formalizado (VirtualPos, Kontax — ver ETAPA3.md). Con
  // esto en false el paso se oculta del flujo de carga y sus métricas dejan
  // de presentarse como un KPI de dinero recaudado, que es lo que eran: pagos
  // simulados sumados y mostrados junto a cifras reales sin distinción.
  compensacionHabilitada: bool(process.env.COMPENSACION_HABILITADA, false),

  simple: {
    // Default `false`: el modo simulado se pide explícitamente, no se hereda.
    // En producción además es fatal (lib/verificarProduccion.js).
    mock: bool(process.env.MOCK_SIMPLE, false),
    base: process.env.SIMPLE_API_BASE || 'https://app.itssimple.com/public/v1',
    key: process.env.SIMPLE_API_KEY || '',
  },

  // Análisis de documentos con IA (Anthropic Claude) — camino principal de
  // lectura de texto/OCR en lecturaDocumento.js, con el motor de reglas
  // (regex) como respaldo automático si no hay clave, la llamada falla, el
  // plazo se agota, o la respuesta no valida contra el esquema esperado.
  // La IA SOLO extrae y clasifica: el cálculo de CO2e sigue siendo 100%
  // del motor propio determinista — nunca lo calcula la IA.
  analisisIA: {
    // Con el tope en 0 la IA no puede llamarse nunca: se apaga acá, para que
    // el panel muestre "Inactivo" en vez de un "Activo" que no lo es.
    enabled: bool(process.env.ANALISIS_IA, true)
      && Boolean(process.env.ANTHROPIC_API_KEY)
      && presupuestoIaClp > 0,
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    modelo: process.env.ANALISIS_IA_MODELO || 'claude-sonnet-5',
    timeoutMs: parseInt(process.env.ANALISIS_IA_TIMEOUT_MS || '15000', 10),
    // Referenciales (ajustar según tarifa vigente de Anthropic). OJO: ya no
    // son solo un indicador de panel — desde el tope diario, estos dos
    // números DECIDEN cuándo se corta el gasto de la IA. Subirlos hace que
    // el presupuesto se agote antes; bajarlos, después.
    costoInputClp1k: Number(process.env.ANALISIS_IA_COSTO_INPUT_CLP_1K) || 3,
    costoOutputClp1k: Number(process.env.ANALISIS_IA_COSTO_OUTPUT_CLP_1K) || 15,
    // Tope de gasto por día calendario (America/Santiago), estimado con los
    // costos de arriba sobre lo ya registrado en analisis_ia_uso. Existe
    // porque POST /api/sesiones lo puede disparar cualquiera con un código
    // de acceso —incluso uno inválido, ver la pre-validación en public.js—
    // y cada archivo puede costar hasta tres llamadas.
    //
    // Al superarlo la IA se salta y el documento se lee con el parser de
    // reglas. Para casi todos los documentos eso es degradación silenciosa;
    // para los que SOLO la IA sabía leer no lo es (ver el comentario de
    // analisisIA.js): terminan rechazados con el motor externo apagado, o
    // se van al motor externo si está encendido. Por eso el tope se elige
    // como un freno de daño, no como una cuota de operación.
    //
    // 0 = la IA queda apagada del todo (`enabled` de arriba). Para operar
    // sin tope hay que poner un número alto a propósito.
    presupuestoDiarioClp: presupuestoIaClp,
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev_access_secret_change_me',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret_change_me',
    accessTtl: process.env.JWT_ACCESS_TTL || '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL || '7d',
  },
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),

  // Cifrado simétrico en reposo de secretos que SÍ hay que poder recuperar
  // en claro (no un hash) — hoy: la clave tributaria del SII que el
  // proveedor autoriza guardar. La llave vive SOLO acá (env), nunca en la
  // BD: si se filtra la base, las claves quedan cifradas e inútiles. En
  // producción verificarProduccion.js exige SII_CRED_KEY; en desarrollo cae
  // a una llave fija para no bloquear el flujo local.
  cripto: {
    siiKey: process.env.SII_CRED_KEY || '',
  },

  // Login con llave USB FIDO2 (WebAuthn) — ver migración 061 y
  // routes/webauthn.js. OJO: el rpID queda atado al dominio para
  // siempre — si en producción cambia el dominio del panel, todas las
  // llaves ya registradas se invalidan y hay que re-registrarlas.
  webauthn: {
    rpID: process.env.WEBAUTHN_RP_ID || new URL(process.env.PUBLIC_APP_URL || 'http://localhost:5173').hostname,
    rpName: 'sicr3p',
    origin: process.env.PUBLIC_APP_URL || 'http://localhost:5173',
    challengeTtlMs: 2 * 60 * 1000,
  },

  // Consultas al SII vía BaseAPI (api.baseapi.cl) — SOLO el endpoint de
  // situación tributaria por RUT, que es dato público y no requiere la
  // clave tributaria de nadie. La key vive únicamente en backend/.env;
  // sin key el módulo queda apagado y el autocompletado simplemente no
  // aparece. El frontend jamás habla con BaseAPI directo.
  baseapi: {
    enabled: Boolean(process.env.BASEAPI_API_KEY),
    key: process.env.BASEAPI_API_KEY || '',
    base: process.env.BASEAPI_BASE || 'https://api.baseapi.cl/api/v1',
    timeoutMs: parseInt(process.env.BASEAPI_TIMEOUT_MS || '15000', 10),
  },

  // Descarga del RCV/DTE del contribuyente (clave por request). El proveedor
  // es intercambiable sin tocar rutas ni el cálculo: 'baseapi' (por defecto,
  // trae el XML del DTE recibido → habilita método físico en compras),
  // 'simpleapi' o 'apigateway' (mismo contrato rut+clave → JSON, pero sin
  // detalle de ítems: sus compras se calculan por gasto). Cada uno usa su
  // propia API Key; sin key ese adaptador queda apagado.
  sii: {
    proveedor: (process.env.SII_PROVEEDOR || 'baseapi').toLowerCase(),
    simpleapi: {
      enabled: Boolean(process.env.SIMPLEAPI_KEY),
      key: process.env.SIMPLEAPI_KEY || '',
      base: process.env.SIMPLEAPI_BASE || 'https://servicios.simpleapi.cl/api',
      timeoutMs: parseInt(process.env.SIMPLEAPI_TIMEOUT_MS || '20000', 10),
    },
    apigateway: {
      enabled: Boolean(process.env.APIGATEWAY_API_KEY),
      key: process.env.APIGATEWAY_API_KEY || '',
      base: process.env.APIGATEWAY_BASE || 'https://app.apigateway.cl/api/v2',
      timeoutMs: parseInt(process.env.APIGATEWAY_TIMEOUT_MS || '20000', 10),
    },
  },

  resend: {
    apiKey: process.env.RESEND_API_KEY || '',
    from: process.env.MAIL_FROM || 'sicr3p <no-responder@sicrep.cl>',
  },

  // Envío por SMTP propio (servidor Poste.io en el VPS). Si está configurado,
  // el mailer lo usa ANTES que Resend: el correo sale firmado con el DKIM de
  // sicr3p.cl y pasa SPF (la IP del VPS está autorizada), mejor entregabilidad
  // para el dominio propio. `secure` = true en 465 (TLS implícito), false en
  // 587 (STARTTLS). Sin SMTP_HOST/USER/PASS queda apagado y cae a Resend.
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    // El backend habla con su PROPIO servidor de correo en el mismo VPS. Si
    // ese servidor (Poste.io) presenta un certificado autofirmado, poner
    // SMTP_TLS_INSECURE=true acepta esa conexión local — es seguro porque no
    // sale a internet. Por defecto queda estricto (rechaza autofirmados).
    tlsInsecure: bool(process.env.SMTP_TLS_INSECURE, false),
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
