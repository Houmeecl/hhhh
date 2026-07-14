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

async function request(path, { method = 'GET', body, formData, authed = false } = {}) {
  const headers = {};
  if (!formData) headers['Content-Type'] = 'application/json';
  if (authed && auth.access) headers['Authorization'] = `Bearer ${auth.access}`;

  let res = await fetch(`/api${path}`, {
    method,
    headers,
    body: formData ? body : body ? JSON.stringify(body) : undefined,
  });

  // Reintento con refresh si el token expiró.
  if (res.status === 401 && authed && auth.refresh) {
    const r = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: auth.refresh }),
    });
    if (r.ok) {
      const { accessToken } = await r.json();
      auth.set(accessToken);
      headers['Authorization'] = `Bearer ${accessToken}`;
      res = await fetch(`/api${path}`, {
        method, headers,
        body: formData ? body : body ? JSON.stringify(body) : undefined,
      });
    }
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Ocurrió un error');
  return data;
}

export const api = {
  // Público
  crearSesion: (formData) => request('/sesiones', { method: 'POST', body: formData, formData: true }),
  getSesion: (id) => request(`/sesiones/${id}`),
  verificar: (id) => request(`/verificar/${id}`),
  informeUrl: (id) => `/api/sesiones/${id}/informe.pdf`,
  etiquetaUrl: (id) => `/api/facturas/${id}/etiqueta.pdf`,
  qrUrl: (id) => `/api/facturas/${id}/qr.png`,

  // Auth
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  me: () => request('/auth/me', { authed: true }),
  activar: (token, password) => request('/auth/activar', { method: 'POST', body: { token, password } }),
  solicitarReset: (email) => request('/auth/solicitar-reset', { method: 'POST', body: { email } }),

  // Admin
  dashboard: () => request('/admin/dashboard', { authed: true }),
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
  crearUsuario: (b) => request('/admin/usuarios', { method: 'POST', body: b, authed: true }),
  editarUsuario: (id, b) => request(`/admin/usuarios/${id}`, { method: 'PUT', body: b, authed: true }),
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
};

async function abrirPdfAuth(url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${auth.access}` } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'No se pudo generar el PDF');
  }
  const blobUrl = URL.createObjectURL(await res.blob());
  window.open(blobUrl, '_blank');
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
}

// Formato chileno de números.
export const fmt = (n, dec = 4) =>
  (Number(n) || 0).toLocaleString('es-CL', { minimumFractionDigits: dec, maximumFractionDigits: dec });
export const fmtInt = (n) => (Number(n) || 0).toLocaleString('es-CL');
export const fmtFecha = (d) => (d ? new Date(d).toLocaleDateString('es-CL') : '—');
