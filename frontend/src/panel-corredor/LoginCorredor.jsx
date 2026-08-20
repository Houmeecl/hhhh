import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import Icon from '../components/icons.jsx';
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
    <div className="login-wrap theme-corredor">
      <form className="card card-pad login-card cor-form" onSubmit={entrar}>
        <div className="cor-login-marca">
          <Logo size={28} />
          <div className="corredor-kicker">CORREDOR BIOCEÁNICO</div>
        </div>
        <h1 style={{ fontSize: 20, margin: '0 0 6px', textAlign: 'center' }}>Panel del exportador</h1>
        <p className="muted" style={{ fontSize: 13, textAlign: 'center', margin: '0 0 18px' }}>
          La evidencia que tu carga necesita para entrar a su mercado de destino.
        </p>

        <div className="field">
          <label htmlFor="cor-email">Correo</label>
          <input id="cor-email" type="email" value={email} autoComplete="username"
            onChange={(e) => { setEmail(e.target.value); setError(''); }} placeholder="contacto@empresa.com" />
        </div>
        <div className="field">
          <label htmlFor="cor-pass">Contraseña</label>
          <input id="cor-pass" type="password" value={password} autoComplete="current-password"
            onChange={(e) => { setPassword(e.target.value); setError(''); }} />
        </div>

        {error && (
          <div className="cor-aviso cor-aviso-alto" role="alert">
            <Icon.Alert size={16} />
            <div>{error}</div>
          </div>
        )}

        <button className="btn btn-primary" type="submit" style={{ width: '100%', marginTop: 4 }} disabled={cargando || !email || !password}>
          {cargando ? <span className="spinner" /> : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
