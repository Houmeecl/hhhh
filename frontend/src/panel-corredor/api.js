// ============================================================
// Cliente HTTP del Corredor — SEPARADO del de sicr3p.
//
// POR QUÉ NO SE REUSA `src/api.js`. Su `request()` reintenta ante un 401
// contra `/api/auth/refresh`, que es el endpoint de sicr3p. Un token del
// Corredor mandado ahí sería mezclar justo lo que se separó: otra base,
// otro secreto de firma, otro producto. Además su lista de banderas
// (`authed`, `authedPuerto`, `authedMandante`…) ya lleva ocho, y sumar la
// novena empeora un archivo que no es de este producto.
//
// Acá no hay refresh: el backend del Corredor emite solo token de acceso.
// Cuando expira, se vuelve al login. Es menos cómodo y es honesto — un
// refresh que no existe en el servidor no se puede simular en el cliente.
// ============================================================

const CLAVE = 'sicr3p_corredor_access';

export const authCorredor = {
  get access() { return localStorage.getItem(CLAVE); },
  set(token) { if (token) localStorage.setItem(CLAVE, token); },
  clear() { localStorage.removeItem(CLAVE); },
};

async function pedir(ruta, { metodo = 'GET', body, conSesion = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (conSesion && authCorredor.access) headers.Authorization = `Bearer ${authCorredor.access}`;

  const res = await fetch(`/api/corredor${ruta}`, {
    method: metodo,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Ocurrió un error');
    err.status = res.status;
    err.data = data;   // trae `codigo` y, en el 503, qué variable falta
    throw err;
  }
  return data;
}

export const apiCorredor = {
  login: (email, password) => pedir('/auth/login', { metodo: 'POST', body: { email, password }, conSesion: false }),
  me: () => pedir('/me'),
  cambiarPassword: (password) => pedir('/auth/cambiar-password', { metodo: 'POST', body: { password } }),

  parcelas: () => pedir('/parcelas'),
  crearParcela: (b) => pedir('/parcelas', { metodo: 'POST', body: b }),

  cargas: () => pedir('/cargas'),
  carga: (id) => pedir(`/cargas/${id}`),
  crearCarga: (b) => pedir('/cargas', { metodo: 'POST', body: b }),

  crearExportador: (b) => pedir('/exportadores', { metodo: 'POST', body: b }),
};
