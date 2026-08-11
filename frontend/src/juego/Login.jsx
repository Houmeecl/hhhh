import { useState } from 'react';
import Logo from '../components/Logo.jsx';
import { Icon } from '../components/icons.jsx';
import { api } from '../api.js';

// ============================================================
// "Sube y Suma" — acceso sin contraseña: correo + código de invitación de
// tu empresa. Mismo mecanismo de magic link que /ingresar (soy cliente),
// solo que este enlace trae `codigo` y crea un jugador persistente en vez
// de una sesión efímera (ver auth.js).
// ============================================================
export default function LoginSuma() {
  const [email, setEmail] = useState('');
  const [codigo, setCodigo] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(''); setCargando(true);
    try {
      await api.jugadorSolicitarMagic(email.trim(), codigo.trim());
      setEnviado(true);
    } catch (err) { setError(err.message); }
    finally { setCargando(false); }
  }

  return (
    <div className="login-wrap">
      <div style={{ width: '100%', maxWidth: 420 }} className="fade-up">
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Logo size={44} tagline light />
        </div>
        <div className="login-card">
          <h2 style={{ marginTop: 0, fontSize: 20 }}>Sube y Suma</h2>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            Escanea las boletas y facturas de tu equipo, suma puntos y sigue tu progreso.
            Necesitas el código de invitación que te dio tu empresa.
          </p>

          {!enviado ? (
            <form onSubmit={submit}>
              <div className="field" style={{ marginBottom: 14 }}>
                <label htmlFor="suma-email">Correo</label>
                <input
                  id="suma-email" type="email" autoComplete="username" required autoFocus
                  value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@empresa.cl"
                />
              </div>
              <div className="field" style={{ marginBottom: 14 }}>
                <label htmlFor="suma-codigo">Código de invitación</label>
                <input
                  id="suma-codigo" required value={codigo}
                  onChange={(e) => setCodigo(e.target.value.toUpperCase())}
                  placeholder="SICR3P-XXXXXX"
                  style={{ textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}
                />
              </div>
              {error && (
                <div className="badge badge-red" role="alert" style={{ display: 'block', padding: '10px 14px', marginBottom: 14 }}>{error}</div>
              )}
              <button className="btn btn-primary" style={{ width: '100%' }} disabled={cargando}>
                {cargando ? <span className="spinner" /> : 'Enviarme el enlace'}
              </button>
            </form>
          ) : (
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <div style={{ color: 'var(--green)' }}><Icon.CheckCircle size={40} /></div>
              <h2 style={{ margin: '10px 0 6px' }}>Revisa tu correo</h2>
              <p className="muted" style={{ fontSize: 14 }}>
                Si <b>{email}</b> y el código son correctos, te llegará un enlace de acceso.
                Expira en 15 minutos y sirve una sola vez.
              </p>
              <button className="btn btn-outline btn-sm" onClick={() => setEnviado(false)}>Usar otro correo o código</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
