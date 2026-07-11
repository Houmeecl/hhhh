import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import { api, auth } from '../api.js';

export default function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetMsg, setResetMsg] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const { accessToken, refreshToken } = await api.login(email, password);
      auth.set(accessToken, refreshToken);
      nav('/admin');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function pedirReset() {
    if (!email) { setError('Ingresa tu correo para restablecer la contraseña.'); return; }
    try {
      await api.solicitarReset(email);
      setResetMsg('Si el correo existe, enviamos instrucciones para restablecer tu contraseña.');
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="login-wrap">
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Logo size={44} tagline />
        </div>
        <form className="login-card" onSubmit={submit}>
          <h2>Acceso</h2>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Usuario / Correo</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@sicr3p.cl" autoFocus />
          </div>
          <div className="field" style={{ marginBottom: 10 }}>
            <label>Contraseña</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña" />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <span className="muted" style={{ fontSize: 13, cursor: 'pointer' }} onClick={pedirReset}>¿Olvidaste tu contraseña?</span>
          </div>
          {error && <div className="badge badge-red" style={{ display: 'block', padding: '10px 14px', marginBottom: 14 }}>{error}</div>}
          {resetMsg && <div className="badge badge-green" style={{ display: 'block', padding: '10px 14px', marginBottom: 14 }}>{resetMsg}</div>}
          <button className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? <span className="spinner" /> : 'Iniciar sesión'}
          </button>
        </form>
        <p className="muted" style={{ textAlign: 'center', fontSize: 13, marginTop: 16 }}>
          Antofagasta, Chile · Panel de administración sicr3p
        </p>
      </div>
    </div>
  );
}
