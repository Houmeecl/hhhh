import { useState } from 'react';
import PublicLayout from '../components/PublicLayout.jsx';
import { Icon } from '../components/icons.jsx';
import { api } from '../api.js';

// Acceso de clientes sin contraseña: pide el enlace mágico por correo.
export default function Ingresar() {
  const [email, setEmail] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);

  async function enviar(e) {
    e.preventDefault();
    setError(null); setCargando(true);
    try {
      await api.solicitarMagic(email.trim());
      setEnviado(true);
    } catch (err) { setError(err.message); }
    finally { setCargando(false); }
  }

  return (
    <PublicLayout>
      <div style={{ maxWidth: 460, margin: '60px auto', padding: '0 20px' }}>
        <div className="card card-pad">
          {!enviado ? (
            <>
              <h1 style={{ marginTop: 0, fontSize: 26 }}>Ingresar</h1>
              <p className="muted" style={{ fontSize: 14 }}>
                Sin contraseñas: escribe el correo con el que procesaste tus facturas y te
                enviamos un <b>enlace de acceso</b> a tu historial.
              </p>
              <form onSubmit={enviar}>
                <div className="field">
                  <label>Correo</label>
                  <input type="email" required autoFocus value={email}
                    onChange={(e) => setEmail(e.target.value)} placeholder="tu@empresa.cl" />
                </div>
                {error && <div className="badge badge-red" style={{ display: 'block', padding: '10px 14px', margin: '10px 0' }}>{error}</div>}
                <button className="btn btn-primary" style={{ width: '100%', marginTop: 10 }} disabled={cargando}>
                  {cargando ? <span className="spinner" /> : 'Enviarme el enlace'}
                </button>
              </form>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <div style={{ color: 'var(--green-600)' }}><Icon.CheckCircle size={40} /></div>
              <h2 style={{ margin: '10px 0 6px' }}>Revisa tu correo</h2>
              <p className="muted" style={{ fontSize: 14 }}>
                Si <b>{email}</b> tiene historial en sicr3p, te llegará un enlace de acceso.
                Expira en 15 minutos y sirve una sola vez.
              </p>
              <button className="btn btn-outline btn-sm" onClick={() => setEnviado(false)}>Usar otro correo</button>
            </div>
          )}
        </div>
        <p className="muted" style={{ fontSize: 13, textAlign: 'center', marginTop: 14 }}>
          ¿Eres administrador de sicr3p? <a href="/admin/login">Panel de administración</a>
        </p>
      </div>
    </PublicLayout>
  );
}
