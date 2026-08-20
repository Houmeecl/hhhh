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

async function pedir(ruta, { metodo = 'GET', body, conSesion = true, form = null } = {}) {
  // Con `form` va un FormData: el navegador pone el Content-Type con su
  // boundary, y ponerlo a mano rompe el multipart.
  const headers = form ? {} : { 'Content-Type': 'application/json' };
  if (conSesion && authCorredor.access) headers.Authorization = `Bearer ${authCorredor.access}`;

  const res = await fetch(`/api/corredor${ruta}`, {
    method: metodo,
    headers,
    body: form || (body === undefined ? undefined : JSON.stringify(body)),
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
  enlazarParcela: (cargaId, b) => pedir(`/cargas/${cargaId}/parcelas`, { metodo: 'POST', body: b }),
  soltarParcela: (cargaId, parcelaId) => pedir(`/cargas/${cargaId}/parcelas/${parcelaId}`, { metodo: 'DELETE' }),
  guardarProduccion: (cargaId, b) => pedir(`/cargas/${cargaId}/produccion`, { metodo: 'PUT', body: b }),

  // El tramo y su expediente documental.
  // '/catalogo/puntos': '/corredor/puntos' a secas es el catálogo PÚBLICO
  // del mapa de la torre, que sale de la base de sicr3p. Este trae los del
  // Corredor, que son los que valida el guardado del tramo.
  puntos: () => pedir('/catalogo/puntos'),
  reglasDeTramo: () => pedir('/tramos/documentos'),
  definirTramo: (cargaId, b) => pedir(`/cargas/${cargaId}/tramo`, { metodo: 'PUT', body: b }),
  documentos: (cargaId) => pedir(`/cargas/${cargaId}/documentos`),
  // El archivo viaja SOLO para que el servidor calcule su sha256; no se
  // guarda en ninguna parte. Ver POST /cargas/:id/documentos en el backend.
  sellarDocumento: (cargaId, { tipo_documento, archivo }) => {
    const fd = new FormData();
    fd.append('tipo_documento', tipo_documento);
    fd.append('archivo', archivo);
    return pedir(`/cargas/${cargaId}/documentos`, { metodo: 'POST', form: fd });
  },

  // El PDF no pasa por `pedir`: la respuesta es un binario, no JSON.
  async pasaporte(cargaId, codigo) {
    const res = await fetch(`/api/corredor/cargas/${cargaId}/pasaporte.pdf`, {
      headers: { Authorization: `Bearer ${authCorredor.access}` },
    });
    if (!res.ok) throw new Error('No se pudo generar el pasaporte.');
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `pasaporte-${codigo}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  },

  // Solo para el admin del Corredor (el backend lo gatea con
  // requireAdminCorredor; acá la pestaña ni se muestra).
  exportadores: () => pedir('/exportadores'),
  crearExportador: (b) => pedir('/exportadores', { metodo: 'POST', body: b }),
};
