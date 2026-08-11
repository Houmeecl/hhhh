import { useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import Logo from './Logo.jsx';
import { api } from '../api.js';

// Página de activación/reset de contraseña compartida por los siete paneles
// (sicrep, terreno, puerto, mandante, agencia, trazador, proveedor) — el token identifica
// la fila de `usuarios` y ya trae su panel correcto (services/cuentas.js
// arma el link con la ruta de este componente); lo único que cambia por
// panel es a qué login se vuelve tras definir la contraseña.
export default function ActivarCuenta({ loginPath, titulo = 'sicr3p' }) {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('La contraseña debe tener al menos 8 caracteres.'); return; }
    if (password !== confirm) { setError('Las contraseñas no coinciden.'); return; }
    try {
      await api.activar(token, password);
      setOk(true);
      setTimeout(() => nav(loginPath), 1800);
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="login-wrap">
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}><Logo size={40} tagline /></div>
        <form className="login-card" onSubmit={submit}>
          <h2>Activa tu cuenta</h2>
          {!token && <div className="badge badge-red" style={{ display: 'block', padding: 10, marginBottom: 12 }}>Falta el token de activación en el enlace.</div>}
          {ok ? (
            <div className="badge badge-green" style={{ display: 'block', padding: 14 }}>
              ¡Listo! Tu contraseña quedó definida. Redirigiendo al acceso…
            </div>
          ) : (
            <>
              <p className="muted" style={{ fontSize: 14, marginTop: 0 }}>Define tu contraseña para acceder a {titulo}.</p>
              <div className="field" style={{ marginBottom: 14 }}>
                <label>Nueva contraseña</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="field" style={{ marginBottom: 16 }}>
                <label>Repite la contraseña</label>
                <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
              {error && <div className="badge badge-red" style={{ display: 'block', padding: '10px 14px', marginBottom: 14 }}>{error}</div>}
              <button className="btn btn-primary" style={{ width: '100%' }} disabled={!token}>Activar mi cuenta</button>
            </>
          )}
          <p style={{ textAlign: 'center', marginTop: 16, fontSize: 13 }}><Link to={loginPath}>Volver al acceso</Link></p>
        </form>
      </div>
    </div>
  );
}
