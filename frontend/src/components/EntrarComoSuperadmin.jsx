import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { authAv, authPuerto, authMandante, authAgencia, authTrazador, authProveedor } from '../api.js';

// Puente de la vista de superadmin: AdminApp abre una pestaña nueva a
// /impersonar/:panel#t=<token> con el token de vista que emitió POST
// /api/admin/entrar-a-panel (5 min, sin refresh). Acá se guarda ese token
// en el almacén de sesión del panel correspondiente y se redirige a su
// raíz — desde ahí el panel funciona igual que con un login normal, hasta
// que el token vence y su propia app rebota al login.
//
// El token viaja en el FRAGMENTO (#), nunca en el query string: el
// fragmento no se manda al servidor, así que no queda en el access.log de
// nginx (que sirve index.html para esta ruta) ni en el header Referer de
// la navegación siguiente. Además se borra de la barra de direcciones con
// replaceState apenas se lee.
const DESTINOS = {
  aduana_verde: { store: authAv, ruta: '/panel-verde', nombre: 'terreno' },
  puerto: { store: authPuerto, ruta: '/panel-puerto', nombre: 'Puerto' },
  mandante: { store: authMandante, ruta: '/panel-mandante', nombre: 'Mandante' },
  agencia: { store: authAgencia, ruta: '/panel-agencia', nombre: 'Agencia' },
  trazador: { store: authTrazador, ruta: '/panel-trazador', nombre: 'Trazador' },
  proveedor: { store: authProveedor, ruta: '/panel-proveedor', nombre: 'Proveedor' },
};

export default function EntrarComoSuperadmin() {
  const { panel } = useParams();
  const [error, setError] = useState('');

  useEffect(() => {
    const destino = DESTINOS[panel];
    const token = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('t');
    if (!destino) { setError('Panel desconocido.'); return; }
    if (!token) { setError('Falta el token de vista. Vuelve al panel sicrep y entra de nuevo.'); return; }
    // Sacar el token de la barra de direcciones antes de navegar.
    window.history.replaceState(null, '', window.location.pathname);
    // Se pisa cualquier sesión previa de ese panel en este navegador; el
    // refresh se limpia explícito para que al vencer el token (5 min) el
    // panel rebote al login en vez de renovar una sesión vieja.
    destino.store.clear();
    destino.store.set(token, null);
    window.location.replace(destino.ruta);
  }, [panel]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: 80 }}>
      {error ? (
        <>
          <p style={{ color: 'var(--rojo, #b3261e)' }}>{error}</p>
          <Link to="/admin">Volver al panel</Link>
        </>
      ) : (
        <span className="spinner" />
      )}
    </div>
  );
}
