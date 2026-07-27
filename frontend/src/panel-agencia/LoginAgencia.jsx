import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import { Icon } from '../components/icons.jsx';
import { api, authAgencia } from '../api.js';

// Login propio del panel de Agencia de Aduana — mismo endpoint /auth/login
// que el resto de los paneles, mandando panel:'agencia' (el backend
// rechaza con 403 si la cuenta no pertenece a este panel) y guardando la
// sesión en el almacén separado authAgencia (frontend/src/api.js). La
// agencia sigue realizando la tramitación oficial; sicr3p es su
// infraestructura documental/de trazabilidad — nunca se presenta como
// agencia de aduanas.
export default function LoginAgencia() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const { accessToken, refreshToken } = await api.login(email, password, 'agencia');
      authAgencia.set(accessToken, refreshToken);
      nav('/panel-agencia');
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
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--green)', marginTop: 4 }}>Panel de Agencia de Aduana</div>
        </div>
        <form className="login-card" onSubmit={submit}>
          <h2>Acceso — Agencia</h2>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            Consulta y captura los documentos de los expedientes de tu agencia en el Corredor Bioceánico.
            sicr3p es la infraestructura documental y de trazabilidad; la tramitación oficial la realiza tu agencia.
          </p>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Correo</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="operador@agencia.cl" autoFocus />
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
