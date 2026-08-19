import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import { apiCorredor, authCorredor } from './api.js';

// Login propio del Corredor. No reusa components/PanelLogin.jsx porque
// ese llama a `api.login()` de sicr3p: otra base, otro secreto de firma,
// otro producto. Lo que sí comparte es el aspecto, para que se vea de la
// misma casa.
export default function LoginCorredor() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  async function entrar(e) {
    e.preventDefault();
    setCargando(true); setError('');
    try {
      const r = await apiCorredor.login(email.trim(), password);
      authCorredor.set(r.access);
      nav('/panel-corredor');
    } catch (err) {
      // El 503 del Corredor apagado no es culpa de quien intenta entrar:
      // decirle "correo o contraseña incorrectos" lo mandaría a probar
      // credenciales para siempre.
      setError(err.status === 503
        ? 'El Corredor todavía no está habilitado en este servidor. Avísale al equipo de sicr3p.'
        : err.message);
    } finally { setCargando(false); }
  }

  return (
    <div className="login-wrap">
      <form className="card card-pad login-card" onSubmit={entrar}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <Logo size={28} />
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--corredor-accent, #28A745)', marginTop: 6, letterSpacing: '.04em' }}>
            CORREDOR BIOCEÁNICO
          </div>
        </div>
        <h1 style={{ fontSize: 20, margin: '0 0 6px', textAlign: 'center' }}>Panel del exportador</h1>
        <p className="muted" style={{ fontSize: 13, textAlign: 'center', marginTop: 0 }}>
          La evidencia que tu carga necesita para entrar a su mercado de destino.
        </p>

        <div className="field">
          <label>Correo</label>
          <input type="email" value={email} autoComplete="username"
            onChange={(e) => { setEmail(e.target.value); setError(''); }} placeholder="contacto@empresa.com" />
        </div>
        <div className="field" style={{ marginBottom: 14 }}>
          <label>Contraseña</label>
          <input type="password" value={password} autoComplete="current-password"
            onChange={(e) => { setPassword(e.target.value); setError(''); }} />
        </div>

        {error && <div className="badge badge-red" style={{ display: 'block', padding: 10, marginBottom: 12 }}>{error}</div>}

        <button className="btn btn-primary" type="submit" style={{ width: '100%' }} disabled={cargando || !email || !password}>
          {cargando ? <span className="spinner" /> : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
