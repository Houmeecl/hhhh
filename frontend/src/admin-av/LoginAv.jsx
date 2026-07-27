import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import { Icon } from '../components/icons.jsx';
import { api, authAv } from '../api.js';

// Login propio del panel del mostrador presencial de sicr3p — mismo
// endpoint /auth/login que el panel núcleo, pero mandando
// panel:'aduana_verde' (el backend rechaza con 403 si la cuenta no
// pertenece a este panel) y guardando la sesión en el almacén separado
// authAv (frontend/src/api.js), no en auth.
export default function LoginAv() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const { accessToken, refreshToken } = await api.login(email, password, 'aduana_verde');
      authAv.set(accessToken, refreshToken);
      nav('/panel-verde');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap theme-av">
      <div style={{ width: '100%', maxWidth: 430 }} className="fade-up">
        <div style={{ textAlign: 'center', marginBottom: 24, position: 'relative', zIndex: 2 }}>
          <Logo size={48} light />
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--green)', marginTop: 4 }}>Panel del mostrador presencial</div>
        </div>
        <form className="login-card" onSubmit={submit}>
          <h2>Acceso — Panel mostrador</h2>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Usuario / Correo</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="operador@sicr3p.cl" autoFocus />
          </div>
          <div className="field" style={{ marginBottom: 10 }}>
            <label>Contraseña</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña" />
          </div>
          {error && <div className="badge badge-red" style={{ display: 'block', padding: '10px 14px', marginBottom: 14 }}>{error}</div>}
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
