import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';
import { Icon } from '../components/icons.jsx';
import { api, clienteAuth, authSuma } from '../api.js';

// Canjea el token del magic link. El mismo enlace de correo sirve para dos
// destinos — el backend arma la MISMA URL /acceso para ambos (ver
// POST /auth/magic en routes/auth.js) y solo la respuesta dice cuál es:
// un cliente normal (rol 'cliente') abre su historial; un jugador de
// "Sube y Suma" (rol 'jugador', el enlace traía un código de campaña)
// abre el juego con su propio almacén de sesión (authSuma).
export default function Acceso() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [error, setError] = useState(null);

  useEffect(() => {
    const token = params.get('token');
    if (!token) { setError('Falta el token de acceso.'); return; }
    api.verificarMagic(token)
      .then((r) => {
        if (r.rol === 'jugador') {
          authSuma.set(r.token);
          // Si el login partió desde un QR (ej. cartel de un punto limpio),
          // se vuelve a esa pantalla en vez del inicio del juego.
          const destino = sessionStorage.getItem('sicr3p_suma_destino');
          sessionStorage.removeItem('sicr3p_suma_destino');
          nav(destino && destino.startsWith('/suma/') ? destino : '/suma', { replace: true });
          return;
        }
        clienteAuth.set(r.token, r.email); nav('/mis-sesiones', { replace: true });
      })
      .catch((e) => setError(e.message));
  }, []);

  return (
    <PublicLayout>
      <div className="narrow-page" style={{ textAlign: 'center' }}>
        <div className="card card-pad">
          {!error ? (
            <><span className="spinner dark" /> Verificando tu enlace…</>
          ) : (
            <>
              <div style={{ color: '#b45309' }}><Icon.Alert size={40} /></div>
              <h2 style={{ margin: '10px 0 6px' }}>Enlace inválido o vencido</h2>
              <p className="muted" style={{ fontSize: 14 }}>{error}</p>
              <Link to="/ingresar" className="btn btn-primary">Pedir un enlace nuevo</Link>
            </>
          )}
        </div>
      </div>
    </PublicLayout>
  );
}
