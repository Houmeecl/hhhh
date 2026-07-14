import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';
import { Icon } from '../components/icons.jsx';
import { api, clienteAuth } from '../api.js';

// Canjea el token del magic link y abre el historial del cliente.
export default function Acceso() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [error, setError] = useState(null);

  useEffect(() => {
    const token = params.get('token');
    if (!token) { setError('Falta el token de acceso.'); return; }
    api.verificarMagic(token)
      .then((r) => { clienteAuth.set(r.token, r.email); nav('/mis-sesiones', { replace: true }); })
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
