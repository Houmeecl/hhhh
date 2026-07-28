import { useState } from 'react';
import Logo from './Logo.jsx';
import { Icon } from './icons.jsx';

// Candado de "primer inicio de sesión" para los 6 paneles: mientras
// user.must_reset_password sea true el shell no monta ni la navegación
// ni el contenido, solo esta pantalla — la contraseña temporal que
// entregó quien creó la cuenta no puede quedar vigente.
export default function CambiarPasswordObligatorio({ cambiar, onCambiada, subtitulo }) {
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (nueva.length < 10) { setError('La nueva contraseña debe tener al menos 10 caracteres.'); return; }
    if (nueva !== confirmar) { setError('Las contraseñas no coinciden.'); return; }
    setLoading(true);
    try {
      await cambiar(actual, nueva);
      await onCambiada();
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
          {subtitulo && (
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--green)', marginTop: 6 }}>{subtitulo}</div>
          )}
        </div>

        <form className="login-card" onSubmit={submit}>
          <h2>Define tu contraseña</h2>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            Tu cuenta tiene una contraseña temporal — para continuar, define la tuya.
          </p>

          <div className="field" style={{ marginBottom: 14 }}>
            <label htmlFor="cpo-actual">Contraseña temporal</label>
            <input
              id="cpo-actual" type="password" autoComplete="current-password" required
              value={actual} onChange={(e) => setActual(e.target.value)} placeholder="La que recibiste"
            />
          </div>

          <div className="field" style={{ marginBottom: 14 }}>
            <label htmlFor="cpo-nueva">Nueva contraseña (mín. 10 caracteres)</label>
            <input
              id="cpo-nueva" type="password" autoComplete="new-password" required
              value={nueva} onChange={(e) => setNueva(e.target.value)} placeholder="Nueva contraseña"
            />
          </div>

          <div className="field" style={{ marginBottom: 16 }}>
            <label htmlFor="cpo-confirmar">Confirmar nueva contraseña</label>
            <input
              id="cpo-confirmar" type="password" autoComplete="new-password" required
              value={confirmar} onChange={(e) => setConfirmar(e.target.value)} placeholder="Repite la nueva contraseña"
            />
          </div>

          {error && (
            <div className="badge badge-red" role="alert" style={{ display: 'block', padding: '10px 14px', marginBottom: 14 }}>{error}</div>
          )}

          <button className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? <span className="spinner" /> : 'Cambiar contraseña'}
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
