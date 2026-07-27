import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import { Icon } from '../components/icons.jsx';
import { api, authMandante } from '../api.js';

// Login propio del panel de Mandante — mismo endpoint /auth/login que el
// resto de los paneles, mandando panel:'mandante' (el backend rechaza con
// 403 si la cuenta no pertenece a este panel) y guardando la sesión en
// el almacén separado authMandante (frontend/src/api.js).
export default function LoginMandante() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const { accessToken, refreshToken } = await api.login(email, password, 'mandante');
      authMandante.set(accessToken, refreshToken);
      nav('/panel-mandante');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <div style={{ width: '100%', maxWidth: 430 }} className="fade-up">
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Logo size={48} />
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--green)', marginTop: 4 }}>Panel de Mandante</div>
        </div>
        <form className="login-card" onSubmit={submit}>
          <h2>Acceso — Mandante</h2>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            Consulta la trazabilidad y el CO2e que tus proveedores te han emitido.
          </p>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Correo</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contacto@empresa.cl" autoFocus />
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
        </div>
      </div>
    </div>
  );
}
