// Cliente HTTP. Todo pasa por el backend (/api). El frontend nunca ve claves.
const TOKEN_KEY = 'sicr3p_access';
const REFRESH_KEY = 'sicr3p_refresh';

export const auth = {
  get access() { return localStorage.getItem(TOKEN_KEY); },
  get refresh() { return localStorage.getItem(REFRESH_KEY); },
  set(access, refresh) {
    if (access) localStorage.setItem(TOKEN_KEY, access);
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(REFRESH_KEY); },
};

// Sesión del panel del mostrador presencial — storage separado del panel
// núcleo, para que ambas puedan estar logueadas a la vez en el mismo navegador.
const TOKEN_AV_KEY = 'sicr3p_av_access';
const REFRESH_AV_KEY = 'sicr3p_av_refresh';
export const authAv = {
  get access() { return localStorage.getItem(TOKEN_AV_KEY); },
  get refresh() { return localStorage.getItem(REFRESH_AV_KEY); },
  set(access, refresh) {
    if (access) localStorage.setItem(TOKEN_AV_KEY, access);
    if (refresh) localStorage.setItem(REFRESH_AV_KEY, refresh);
  },
  clear() { localStorage.removeItem(TOKEN_AV_KEY); localStorage.removeItem(REFRESH_AV_KEY); },
};

// Sesiones de los paneles exclusivos de Puerto y Mandante — mismo patrón
// que authAv (storage propio, para poder tener varias sesiones de panel
// abiertas a la vez en el mismo navegador).
function crearAlmacenSesion(prefijo) {
  const K = `sicr3p_${prefijo}_access`;
  const R = `sicr3p_${prefijo}_refresh`;
  return {
    get access() { return localStorage.getItem(K); },
    get refresh() { return localStorage.getItem(R); },
    set(access, refresh) {
      if (access) localStorage.setItem(K, access);
      if (refresh) localStorage.setItem(R, refresh);
    },
    clear() { localStorage.removeItem(K); localStorage.removeItem(R); },
  };
}
export const authPuerto = crearAlmacenSesion('puerto');
export const authMandante = crearAlmacenSesion('mandante');
export const authAgencia = crearAlmacenSesion('agencia');

// Sesión del cliente (magic link) — storage separado del admin.
const CLIENTE_KEY = 'sicr3p_cliente';
const CLIENTE_EMAIL_KEY = 'sicr3p_cliente_email';
export const clienteAuth = {
  get token() { return localStorage.getItem(CLIENTE_KEY); },
  get email() { return localStorage.getItem(CLIENTE_EMAIL_KEY); },
  set(token, email) {
    localStorage.setItem(CLIENTE_KEY, token);
    if (email) localStorage.setItem(CLIENTE_EMAIL_KEY, email);
  },
  clear() { localStorage.removeItem(CLIENTE_KEY); localStorage.removeItem(CLIENTE_EMAIL_KEY); },
};

async function request(path, { method = 'GET', body, formData, authed = false, authedAv = false, authedPuerto = false, authedMandante = false, authedAgencia = false, cliente = false } = {}) {
  const store = authedAv ? authAv : authedPuerto ? authPuerto : authedMandante ? authMandante : authedAgencia ? authAgencia : auth;
  const anyAuthed = authed || authedAv || authedPuerto || authedMandante || authedAgencia;
  const headers = {};
  if (!formData) headers['Content-Type'] = 'application/json';
  if (anyAuthed && store.access) headers['Authorization'] = `Bearer ${store.access}`;
  if (cliente && clienteAuth.token) headers['Authorization'] = `Bearer ${clienteAuth.token}`;

  let res = await fetch(`/api${path}`, {
    method,
    headers,
    body: formData ? body : body ? JSON.stringify(body) : undefined,
  });

  // Reintento con refresh si el token expiró.
  if (res.status === 401 && anyAuthed && store.refresh) {
    const r = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: store.refresh }),
    });
    if (r.ok) {
      const { accessToken } = await r.json();
      store.set(accessToken);
      headers['Authorization'] = `Bearer ${accessToken}`;
      res = await fetch(`/api${path}`, {
        method, headers,
        body: formData ? body : body ? JSON.stringify(body) : undefined,
      });
    }
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Ocurrió un error');
    err.data = data; // payload completo (ej. lista de documentos rechazados)
    throw err;
  }
  return data;
}

export const api = {
  // Público
  crearSesion: (formData) => request('/sesiones', { method: 'POST', body: formData, formData: true }),
  getSesion: (id) => request(`/sesiones/${id}`),
  verificar: (id) => request(`/verificar/${id}`),
  pasaporte: (id) => request(`/pasaporte/${id}`),
  lotePublico: (codigo) => request(`/lote/${codigo}`),
  expedienteLoteUrl: (codigo) => `/api/lote/${codigo}/expediente.pdf`,

  // --- Tarjeta de viaje (pública / portador) ---
  tarjetaResolver: (serial) => request(`/v/${serial}`),
  tarjetaAuth: (b) => request('/tarjeta/auth', { method: 'POST', body: b }),
  // --- Firma del proveedor (pública / firmante) — atestación, NO firma
  // electrónica legal (Ley N° 19.799). Ver origen.js/firmaProveedorRouter. ---
  firmaResolver: (serial) => request(`/f/${serial}`),
  firmaAuth: (b) => request('/firma-proveedor/auth', { method: 'POST', body: b }),
  firmaFirmar: async (token, b) => {
    const res = await fetch('/api/firma-proveedor/firmar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(b),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error al firmar');
    return data;
  },
  // --- Torre de control (mapa público + operador con credencial pos) ---
  loteMensajes: (codigo) => request(`/lote/${codigo}/mensajes`),
  posAuth: (b) => request('/pos/auth', { method: 'POST', body: b }),
  torreFlota: async (token) => {
    const res = await fetch('/api/torre/flota', { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error al cargar la flota');
    return data;
  },
  torreMensaje: async (token, b) => {
    const res = await fetch('/api/torre/mensaje', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(b),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error al enviar la instrucción');
    return data;
  },
  tarjetaPaso: async (token, b) => {
    const res = await fetch('/api/tarjeta/paso', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(b),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error al registrar el paso');
    return data;
  },

  // --- Pasaporte de Origen (admin) ---
  origenCatalogo: () => request('/admin/origen/catalogo', { authed: true }),
  origenLotes: (qs = '') => request(`/admin/origen/lotes${qs}`, { authed: true }),
  origenLote: (id) => request(`/admin/origen/lotes/${id}`, { authed: true }),
  origenCrearLote: (b) => request('/admin/origen/lotes', { method: 'POST', body: b, authed: true }),
  origenEditarLote: (id, b) => request(`/admin/origen/lotes/${id}`, { method: 'PATCH', body: b, authed: true }),
  origenAgregarEslabon: (id, b) => request(`/admin/origen/lotes/${id}/eslabones`, { method: 'POST', body: b, authed: true }),
  origenDeclarar: (id, codigo, b) => request(`/admin/origen/lotes/${id}/declaraciones/${codigo}`, { method: 'PUT', body: b, authed: true }),
  origenCerrar: (id) => request(`/admin/origen/lotes/${id}/cerrar`, { method: 'POST', authed: true }),
  origenVerificar: (id) => request(`/admin/origen/lotes/${id}/verificar`, { authed: true }),
  origenTarjetas: (loteId) => request(`/admin/origen/lotes/${loteId}/tarjetas`, { authed: true }),
  origenEmitirTarjeta: (loteId, b) => request(`/admin/origen/lotes/${loteId}/tarjetas`, { method: 'POST', body: b, authed: true }),
  origenEditarTarjeta: (id, b) => request(`/admin/origen/tarjetas/${id}`, { method: 'PUT', body: b, authed: true }),
  origenDemoTorre: () => request('/admin/origen/demo-torre', { method: 'POST', authed: true }),
  abrirCredencialTarjeta: (loteId, tarjetaId) =>
    abrirPdfAuth(`/api/admin/origen/lotes/${loteId}/tarjetas/${tarjetaId}/credencial.pdf`),
  origenCredencialesProveedor: (loteId) => request(`/admin/origen/lotes/${loteId}/credenciales-proveedor`, { authed: true }),
  origenEmitirCredencialProveedor: (loteId, b) =>
    request(`/admin/origen/lotes/${loteId}/credenciales-proveedor`, { method: 'POST', body: b, authed: true }),
  origenEditarCredencialProveedor: (id, b) =>
    request(`/admin/origen/credenciales-proveedor/${id}`, { method: 'PUT', body: b, authed: true }),
  abrirCredencialProveedor: (loteId, credencialId) =>
    abrirPdfAuth(`/api/admin/origen/lotes/${loteId}/credenciales-proveedor/${credencialId}/credencial.pdf`),
  // Documentos del expediente — Carga Bioceánica (migración 043).
  origenDocumentos: (loteId) => request(`/admin/origen/lotes/${loteId}/documentos`, { authed: true }),
  origenSubirDocumento: (loteId, formData) =>
    request(`/admin/origen/lotes/${loteId}/documentos`, { method: 'POST', body: formData, formData: true, authed: true }),
  origenRevisionDocumentos: () => request('/admin/origen/revision-documentos', { authed: true }),
  origenResolverRevision: (id, b) => request(`/admin/origen/revision-documentos/${id}`, { method: 'PUT', body: b, authed: true }),
  guardarEmbalaje: (sesionId, componentes) => request(`/sesiones/${sesionId}/embalaje`, { method: 'POST', body: { componentes } }),
  // Tarifa oficial de compensación (pública) y registro de la compensación
  // del trámite (pago simulado — sin pasarela). El servidor recalcula el
  // monto con SU tarifa; el frontend solo muestra lo que devuelve.
  posConfig: () => request('/pos/config'),
  registrarCompensacion: (sesionId, body) => request(`/sesiones/${sesionId}/compensacion`, { method: 'POST', body }),
  enviarComprobanteCorreo: (sesionId) => request(`/sesiones/${sesionId}/comprobante-correo`, { method: 'POST', body: {} }),
  // Calculadora pública de los landings (factores del motor propio + tarifa)
  // y cadena de hash pública para verificación abierta.
  calculadora: () => request('/publico/calculadora'),
  cadenaPublica: () => request('/publico/cadena'),
  informeUrl: (id) => `/api/sesiones/${id}/informe.pdf`,
  carpetaUrl: (id, mandante) =>
    `/api/sesiones/${id}/carpeta.pdf${mandante ? `?mandante=${encodeURIComponent(mandante)}` : ''}`,
  etiquetaUrl: (id) => `/api/facturas/${id}/etiqueta.pdf`,
  qrUrl: (id) => `/api/facturas/${id}/qr.png`,

  // Auth
  login: (email, password, panel) => request('/auth/login', { method: 'POST', body: { email, password, panel } }),
  me: () => request('/auth/me', { authed: true }),
  meAv: () => request('/auth/me', { authedAv: true }),
  mePuerto: () => request('/auth/me', { authedPuerto: true }),
  meMandante: () => request('/auth/me', { authedMandante: true }),
  meAgencia: () => request('/auth/me', { authedAgencia: true }),
  activar: (token, password) => request('/auth/activar', { method: 'POST', body: { token, password } }),
  solicitarReset: (email) => request('/auth/solicitar-reset', { method: 'POST', body: { email } }),

  // Admin
  dashboard: () => request('/admin/dashboard', { authed: true }),
  cadenaEstado: () => request('/admin/cadena/estado', { authed: true }),
  cadenaVerificar: () => request('/admin/cadena/verificar', { authed: true }),
  clientes: () => request('/admin/clientes', { authed: true }),
  crearCliente: (b) => request('/admin/clientes', { method: 'POST', body: b, authed: true }),
  editarCliente: (id, b) => request(`/admin/clientes/${id}`, { method: 'PUT', body: b, authed: true }),
  eliminarCliente: (id) => request(`/admin/clientes/${id}`, { method: 'DELETE', authed: true }),
  crearCuenta: (id, b) => request(`/admin/clientes/${id}/crear-cuenta`, { method: 'POST', body: b, authed: true }),
  alertasContratos: () => request('/admin/contratos/alertas', { authed: true }),
  sesiones: (qs = '') => request(`/admin/sesiones${qs}`, { authed: true }),
  sesionAdmin: (id) => request(`/admin/sesiones/${id}`, { authed: true }),
  metricas: () => request('/admin/metricas', { authed: true }),
  prospectos: () => request('/admin/prospectos', { authed: true }),
  crearProspecto: (b) => request('/admin/prospectos', { method: 'POST', body: b, authed: true }),
  editarProspecto: (id, b) => request(`/admin/prospectos/${id}`, { method: 'PUT', body: b, authed: true }),
  eliminarProspecto: (id) => request(`/admin/prospectos/${id}`, { method: 'DELETE', authed: true }),
  simpleApi: () => request('/admin/simple-api', { authed: true }),
  usuarios: () => request('/admin/usuarios', { authed: true }),
  cambiarPassword: (actual, nueva) => request('/admin/perfil/password', { method: 'PUT', body: { actual, nueva }, authed: true }),
  crearUsuario: (b) => request('/admin/usuarios', { method: 'POST', body: b, authed: true }),
  editarUsuario: (id, b) => request(`/admin/usuarios/${id}`, { method: 'PUT', body: b, authed: true }),
  reenviarActivacion: (id) => request(`/admin/usuarios/${id}/reenviar-activacion`, { method: 'POST', authed: true }),
  actividad: () => request('/admin/actividad', { authed: true }),

  // Corredor Bioceánico
  corredorMetodologias: () => request('/admin/corredor/metodologias', { authed: true }),
  guardarMetodologia: (pais, b) => request(`/admin/corredor/metodologias/${pais}`, { method: 'PUT', body: b, authed: true }),
  corredorDocumentos: () => request('/admin/corredor/documentos', { authed: true }),
  subirDocumentoCorredor: (formData) => request('/admin/corredor/documentos', { method: 'POST', body: formData, formData: true, authed: true }),

  // Capital Natural
  capitalCuentas: () => request('/admin/capital/cuentas', { authed: true }),
  guardarCuentaNatural: (codigo, b) => request(`/admin/capital/cuentas/${codigo}`, { method: 'PUT', body: b, authed: true }),
  capitalActivos: () => request('/admin/capital/activos', { authed: true }),
  crearActivoNatural: (b) => request('/admin/capital/activos', { method: 'POST', body: b, authed: true }),
  editarActivoNatural: (id, b) => request(`/admin/capital/activos/${id}`, { method: 'PUT', body: b, authed: true }),
  eliminarActivoNatural: (id) => request(`/admin/capital/activos/${id}`, { method: 'DELETE', authed: true }),
  capitalLibro: (qs = '') => request(`/admin/capital/libro${qs}`, { authed: true }),
  crearMovimientoNatural: (b) => request('/admin/capital/movimientos', { method: 'POST', body: b, authed: true }),
  capitalBalance: (qs = '') => request(`/admin/capital/balance${qs}`, { authed: true }),
  // Los PDF de admin requieren Authorization: se bajan como blob y se abren en una pestaña.
  abrirBalanceNaturalPdf: (qs = '') => abrirPdfAuth(`/api/admin/capital/balance.pdf${qs}`),

  // Trazabilidad (Etapa 2)
  informeMensual: (qs) => request(`/admin/informes/mensual${qs}`, { authed: true }),
  abrirInformeMensualPdf: (qs) => abrirPdfAuth(`/api/admin/informes/mensual.pdf${qs}`),
  cadena: (qs) => request(`/admin/informes/cadena${qs}`, { authed: true }),
  verificarDte: (formData) => request('/admin/informes/dte/verificar', { method: 'POST', body: formData, formData: true, authed: true }),

  // Búsqueda unificada con cruces
  buscar: (q) => request(`/admin/buscar?q=${encodeURIComponent(q)}`, { authed: true }),

  // Código de acceso con créditos (mini sitio de prueba)
  codigoEstado: (codigo) => request(`/codigos/${encodeURIComponent(codigo)}`),

  // Valorización FIFO/PMP
  inventario: (qs) => request(`/admin/valorizacion/inventario${qs}`, { authed: true }),
  crearMovInventario: (b) => request('/admin/valorizacion/movimientos', { method: 'POST', body: b, authed: true }),

  // Transporte Cat. 7
  transporteModos: () => request('/admin/transporte/modos', { authed: true }),
  guardarModoTransporte: (codigo, b) => request(`/admin/transporte/modos/${codigo}`, { method: 'PUT', body: b, authed: true }),
  transporteViajes: (qs = '') => request(`/admin/transporte/viajes${qs}`, { authed: true }),
  crearViaje: (b) => request('/admin/transporte/viajes', { method: 'POST', body: b, authed: true }),
  eliminarViaje: (id) => request(`/admin/transporte/viajes/${id}`, { method: 'DELETE', authed: true }),

  // Accesos externos: mandantes + códigos
  mandantes: () => request('/admin/accesos/mandantes', { authed: true }),
  crearMandante: (b) => request('/admin/accesos/mandantes', { method: 'POST', body: b, authed: true }),
  editarMandante: (id, b) => request(`/admin/accesos/mandantes/${id}`, { method: 'PUT', body: b, authed: true }),
  proveedoresMandante: (id) => request(`/admin/accesos/mandantes/${id}/proveedores`, { authed: true }),
  agregarProveedorMandante: (id, rut_proveedor) => request(`/admin/accesos/mandantes/${id}/proveedores`, { method: 'POST', body: { rut_proveedor }, authed: true }),
  quitarProveedorMandante: (id, proveedorId) => request(`/admin/accesos/mandantes/${id}/proveedores/${proveedorId}`, { method: 'DELETE', authed: true }),
  crearCuentaMandante: (id, b) => request(`/admin/accesos/mandantes/${id}/crear-cuenta`, { method: 'POST', body: b, authed: true }),
  puertos: () => request('/admin/accesos/puertos', { authed: true }),
  crearPuerto: (b) => request('/admin/accesos/puertos', { method: 'POST', body: b, authed: true }),
  editarPuerto: (id, b) => request(`/admin/accesos/puertos/${id}`, { method: 'PUT', body: b, authed: true }),
  crearCuentaPuerto: (id, b) => request(`/admin/accesos/puertos/${id}/crear-cuenta`, { method: 'POST', body: b, authed: true }),
  agencias: () => request('/admin/accesos/agencias', { authed: true }),
  crearAgencia: (b) => request('/admin/accesos/agencias', { method: 'POST', body: b, authed: true }),
  editarAgencia: (id, b) => request(`/admin/accesos/agencias/${id}`, { method: 'PUT', body: b, authed: true }),
  crearCuentaAgencia: (id, b) => request(`/admin/accesos/agencias/${id}/crear-cuenta`, { method: 'POST', body: b, authed: true }),
  codigos: () => request('/admin/accesos/codigos', { authed: true }),
  crearCodigos: (b) => request('/admin/accesos/codigos', { method: 'POST', body: b, authed: true }),
  editarCodigo: (id, b) => request(`/admin/accesos/codigos/${id}`, { method: 'PUT', body: b, authed: true }),

  // Panel del mostrador presencial (authedAv: sesión propia, separada del panel núcleo)
  editarPosConfig: (b) => request('/admin/pos/config', { method: 'PUT', body: b, authedAv: true }),
  compensacionesResumen: () => request('/admin/pos/compensaciones/resumen', { authedAv: true }),
  compensacionesAv: (qs = '') => request(`/admin/pos/compensaciones${qs}`, { authedAv: true }),
  embalajeAv: (qs = '') => request(`/admin/pos/embalaje${qs}`, { authedAv: true }),
  embalajeResumenAv: () => request('/admin/pos/embalaje/resumen', { authedAv: true }),

  // Motor propio de cálculo
  motorCategorias: () => request('/admin/motor-propio/categorias', { authed: true }),
  guardarCategoriaMotor: (codigo, b) => request(`/admin/motor-propio/categorias/${codigo}`, { method: 'PUT', body: b, authed: true }),
  motorEstadisticas: () => request('/admin/motor-propio/estadisticas', { authed: true }),
  motorFuentes: () => request('/admin/motor-propio/fuentes', { authed: true }),
  guardarFuenteMotor: (id, b) => request(`/admin/motor-propio/fuentes/${id}`, { method: 'PUT', body: b, authed: true }),

  // Acceso de clientes (magic link)
  solicitarMagic: (email) => request('/auth/magic', { method: 'POST', body: { email } }),
  verificarMagic: (token) => request('/auth/magic/verificar', { method: 'POST', body: { token } }),
  misSesiones: () => request('/mis-sesiones', { cliente: true }),

  // Capacitación interna — compartida por /admin y /panel-verde (el flag
  // `av` elige el almacén de token correcto, sin tocar request()).
  cursos: (av = false) => request('/admin/capacitacion/cursos', { [av ? 'authedAv' : 'authed']: true }),
  curso: (slug, av = false) => request(`/admin/capacitacion/cursos/${slug}`, { [av ? 'authedAv' : 'authed']: true }),
  inscribirCurso: (slug, av = false) =>
    request(`/admin/capacitacion/cursos/${slug}/inscribir`, { method: 'POST', [av ? 'authedAv' : 'authed']: true }),
  completarLeccion: (slug, leccionId, av = false) =>
    request(`/admin/capacitacion/cursos/${slug}/lecciones/${leccionId}/completar`, { method: 'POST', [av ? 'authedAv' : 'authed']: true }),
  quizCurso: (slug, av = false) => request(`/admin/capacitacion/cursos/${slug}/quiz`, { [av ? 'authedAv' : 'authed']: true }),
  responderQuiz: (slug, respuestas, av = false) =>
    request(`/admin/capacitacion/cursos/${slug}/quiz/responder`, { method: 'POST', body: { respuestas }, [av ? 'authedAv' : 'authed']: true }),
  constanciaUrl: (serial) => `/api/capacitacion/constancias/${serial}.pdf`,
  constanciaQrUrl: (serial) => `/api/capacitacion/constancias/${serial}/qr.png`,
  constanciaPublica: (serial) => request(`/capacitacion/constancias/${serial}`),

  // --- Panel exclusivo del puerto (/panel-puerto) — misma API que la
  // integración X-Api-Key, autenticada con la sesión propia authedPuerto.
  puertoTransitos: () => request('/puerto/transitos', { authedPuerto: true }),
  puertoTransito: (codigo) => request(`/puerto/transitos/${encodeURIComponent(codigo)}`, { authedPuerto: true }),

  // --- Panel exclusivo de la agencia de aduana (/panel-agencia) — misma
  // API que la integración X-Api-Key, autenticada con la sesión propia
  // authedAgencia. A diferencia de puerto (solo lectura), SÍ escribe: sube
  // documentos del expediente (pantalla de captura tablet/PC).
  agenciaExpedientes: () => request('/agencia/expedientes', { authedAgencia: true }),
  agenciaExpediente: (codigo) => request(`/agencia/expedientes/${encodeURIComponent(codigo)}`, { authedAgencia: true }),
  agenciaSubirDocumento: (codigo, formData) =>
    request(`/agencia/expedientes/${encodeURIComponent(codigo)}/documentos`, { method: 'POST', body: formData, formData: true, authedAgencia: true }),
  abrirExpedienteAgenciaPdf: (codigo) =>
    abrirPdfAuth(`/api/agencia/expedientes/${encodeURIComponent(codigo)}/expediente.pdf`, authAgencia),

  // --- Panel exclusivo del mandante (/panel-mandante) — misma API que la
  // integración X-Api-Key, autenticada con la sesión propia authedMandante.
  mandanteProveedores: () => request('/mandante/proveedores', { authedMandante: true }),
  mandanteProveedorResumen: (rut, qs = '') => request(`/mandante/proveedor/${encodeURIComponent(rut)}/resumen${qs}`, { authedMandante: true }),
  mandanteExportarAlcance3Csv: (qs = '') => descargarAuth(`/api/mandante/export/alcance3?formato=csv${qs}`, authMandante, `alcance3${qs.replace(/[?&]/g, '_')}.csv`),
  mandanteExportarCbamCsv: () => descargarAuth('/api/mandante/export/cbam?formato=csv', authMandante, 'cbam.csv'),
  mandanteExportarCbamPdf: () => abrirPdfAuth('/api/mandante/export/cbam.pdf', authMandante),
};

async function abrirPdfAuth(url, store = auth) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${store.access}` } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'No se pudo generar el PDF');
  }
  const blobUrl = URL.createObjectURL(await res.blob());
  window.open(blobUrl, '_blank');
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
}

// Descarga autenticada de un archivo (CSV/PDF) que no es JSON — el
// servidor exige Authorization: Bearer, que un <a href> normal no puede
// mandar. Se trae como blob y se dispara la descarga con un <a> temporal.
async function descargarAuth(url, store, filename) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${store.access}` } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'No se pudo generar el archivo');
  }
  const blobUrl = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
}

// Formato chileno de números.
export const fmt = (n, dec = 4) =>
  (Number(n) || 0).toLocaleString('es-CL', { minimumFractionDigits: dec, maximumFractionDigits: dec });
export const fmtInt = (n) => (Number(n) || 0).toLocaleString('es-CL');
export const fmtFecha = (d) => (d ? new Date(d).toLocaleDateString('es-CL') : '—');
