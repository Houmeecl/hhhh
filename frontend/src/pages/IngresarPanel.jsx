import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import { Icon } from '../components/icons.jsx';
import { api, auth, authAv, authPuerto, authMandante, authAgencia, authTrazador } from '../api.js';

// Login único para los seis paneles (sicrep, terreno, puerto, mandante,
// agencia, trazador): a diferencia de PanelLogin.jsx, esta pantalla NO
// manda `panel` en el body — el backend detecta el panel real de la
// cuenta (POST /auth/login sin panel no exige coincidencia, ver
// routes/auth.js) y esta pantalla redirige sola a donde corresponda, en
// vez de obligar a elegir de antemano una de las seis URLs de login.
const DESTINO_POR_PANEL = {
  sicrep: { authStore: auth, redirect: '/admin' },
  aduana_verde: { authStore: authAv, redirect: '/panel-verde' },
  puerto: { authStore: authPuerto, redirect: '/panel-puerto' },
  mandante: { authStore: authMandante, redirect: '/panel-mandante' },
  agencia: { authStore: authAgencia, redirect: '/panel-agencia' },
  trazador: { authStore: authTrazador, redirect: '/panel-trazador' },
};

export default function IngresarPanel() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const editar = (set) => (e) => { set(e.target.value); if (error) setError(''); };

  async function submit(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const { accessToken, refreshToken, user } = await api.login(email, password);
      const destino = DESTINO_POR_PANEL[user.panel];
      if (!destino) {
        // No debería pasar (el CHECK de la BD limita `usuarios.panel` a
        // estos seis valores), pero si algún día se agrega un panel acá
        // sin actualizar este mapa, mejor un error claro que una pantalla
        // en blanco.
        setError('Tu cuenta pertenece a un panel que esta pantalla todavía no reconoce.');
        return;
      }
      destino.authStore.set(accessToken, refreshToken);
      nav(destino.redirect);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <div style={{ width: '100%', maxWidth: 430 }} className="fade-up">
        <div style={{ textAlign: 'center', marginBottom: 24, position: 'relative', zIndex: 2 }}>
          <Logo size={48} tagline light />
        </div>

        <form className="login-card" onSubmit={submit}>
          <h2>Ingresar</h2>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            Un solo acceso para cualquier panel — con tu correo y clave te llevamos directo al tuyo.
          </p>

          <div className="field" style={{ marginBottom: 14 }}>
            <label htmlFor="ip-email">Correo</label>
            <input
              id="ip-email" type="email" autoComplete="username" required
              value={email} onChange={editar(setEmail)} placeholder="tu@empresa.cl" autoFocus
            />
          </div>

          <div className="field" style={{ marginBottom: 16 }}>
            <label htmlFor="ip-password">Contraseña</label>
            <input
              id="ip-password" type="password" autoComplete="current-password" required
              value={password} onChange={editar(setPassword)} placeholder="Contraseña"
            />
          </div>

          {error && (
            <div className="badge badge-red" role="alert" style={{ display: 'block', padding: '10px 14px', marginBottom: 14 }}>{error}</div>
          )}

          <button className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? <span className="spinner" /> : 'Iniciar sesión'}
          </button>
        </form>

        <div className="login-badges">
          <span className="b"><Icon.Shield size={14} /> Acceso seguro</span>
          <span className="b"><Icon.CheckCircle size={14} /> JWT + bcrypt</span>
          <span className="b"><Icon.Building size={14} /> Antofagasta, Chile</span>
        </div>
      </div>
    </div>
  );
}
