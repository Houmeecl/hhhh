import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { startAuthentication } from '@simplewebauthn/browser';
import Logo from '../components/Logo.jsx';
import { Icon } from '../components/icons.jsx';
import { api, auth, authAv, authPuerto, authMandante, authAgencia, authTrazador, authProveedor } from '../api.js';

// ============================================================
// Acceso ÚNICO del sitio (/ingresar): una sola puerta para todas las
// áreas, con dos modos.
//
//  · Paneles: correo + contraseña (o llave USB FIDO2). NO se manda
//    `panel` en el body — el backend detecta el panel real de la cuenta
//    (POST /auth/login sin panel no exige coincidencia, ver
//    routes/auth.js) y esta pantalla redirige sola al panel que
//    corresponda: admin, terreno, puerto, mandante, agencia, trazador
//    o proveedor. Incluye "¿olvidaste tu contraseña?" (el backend arma
//    el enlace según el panel real, así que tampoco necesita saberlo).
//  · Clientes: el enlace mágico por correo de siempre (sin contraseña)
//    para ver el historial de sesiones.
//
// Los logins por panel (/admin/login, /panel-puerto/login, …) siguen
// existiendo como enlaces directos y destino de los correos de
// activación/reset; esta página es la única que se publicita.
// ============================================================
const DESTINO_POR_PANEL = {
  sicrep: { authStore: auth, redirect: '/admin' },
  aduana_verde: { authStore: authAv, redirect: '/panel-verde' },
  puerto: { authStore: authPuerto, redirect: '/panel-puerto' },
  mandante: { authStore: authMandante, redirect: '/panel-mandante' },
  agencia: { authStore: authAgencia, redirect: '/panel-agencia' },
  trazador: { authStore: authTrazador, redirect: '/panel-trazador' },
  proveedor: { authStore: authProveedor, redirect: '/panel-proveedor' },
};

export default function AccesoUnico() {
  const nav = useNavigate();
  const [modo, setModo] = useState('paneles'); // 'paneles' | 'clientes'

  // --- estado del modo Paneles ---
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingLlave, setLoadingLlave] = useState(false);

  // --- estado del modo Clientes (magic link) ---
  const [emailCliente, setEmailCliente] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [errorCliente, setErrorCliente] = useState('');
  const [cargandoCliente, setCargandoCliente] = useState(false);

  const editar = (set) => (e) => { set(e.target.value); if (error) setError(''); if (aviso) setAviso(''); };

  // Compartido por ambos caminos de login (clave y llave USB): el
  // servidor ya detectó el panel real de la cuenta.
  function entrarCon({ accessToken, refreshToken, user }) {
    const destino = DESTINO_POR_PANEL[user.panel];
    if (!destino) {
      // No debería pasar (el CHECK de la BD limita `usuarios.panel` a
      // estos siete valores), pero mejor un error claro que una
      // pantalla en blanco.
      setError('Tu cuenta pertenece a un panel que esta pantalla todavía no reconoce.');
      return;
    }
    destino.authStore.set(accessToken, refreshToken);
    nav(destino.redirect);
  }

  async function submit(e) {
    e.preventDefault();
    setError(''); setAviso(''); setLoading(true);
    try {
      entrarCon(await api.login(email, password));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Llave USB FIDO2 con sensor de huella (se registra desde el panel
  // admin). La huella se valida DENTRO de la llave: este sitio solo
  // recibe la firma.
  async function entrarConLlave() {
    if (!email) { setError('Escribe tu correo para entrar con la llave USB.'); return; }
    setError(''); setAviso(''); setLoadingLlave(true);
    try {
      const opciones = await api.webauthnLoginOpciones(email);
      const respuesta = await startAuthentication({ optionsJSON: opciones });
      entrarCon(await api.webauthnLoginVerificar(email, respuesta));
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        setError('No se detectó la llave o se canceló la operación. Conecta la llave y toca el sensor cuando el navegador lo pida.');
      } else {
        setError(err.message);
      }
    } finally {
      setLoadingLlave(false);
    }
  }

  // El backend arma el enlace de restablecimiento según el panel real
  // de la cuenta (RUTA_ACTIVAR), así que funciona sin conocer el panel.
  async function pedirReset() {
    if (!email) { setError('Ingresa tu correo para restablecer la contraseña.'); return; }
    setError('');
    try {
      await api.solicitarReset(email);
      // Respuesta deliberadamente ambigua: no revela si el correo existe.
      setAviso('Si el correo existe, enviamos instrucciones para restablecer tu contraseña.');
    } catch (err) { setError(err.message); }
  }

  async function enviarMagic(e) {
    e.preventDefault();
    setErrorCliente(''); setCargandoCliente(true);
    try {
      await api.solicitarMagic(emailCliente.trim());
      setEnviado(true);
    } catch (err) { setErrorCliente(err.message); }
    finally { setCargandoCliente(false); }
  }

  const tabStyle = (activo) => ({
    flex: 1, padding: '10px 0', fontSize: 14, fontWeight: 600, cursor: 'pointer',
    background: 'none', border: 'none',
    color: activo ? 'var(--green)' : '#94a3b8',
    borderBottom: activo ? '2px solid var(--green)' : '2px solid transparent',
  });

  return (
    <div className="login-wrap">
      <div style={{ width: '100%', maxWidth: 430 }} className="fade-up">
        <div style={{ textAlign: 'center', marginBottom: 24, position: 'relative', zIndex: 2 }}>
          <Logo size={48} tagline light />
        </div>

        <div className="login-card" style={{ paddingTop: 10 }}>
          {/* Selector de modo: una sola puerta, dos tipos de cuenta. */}
          <div style={{ display: 'flex', marginBottom: 18 }}>
            <button type="button" style={tabStyle(modo === 'paneles')} onClick={() => setModo('paneles')}>
              Paneles
            </button>
            <button type="button" style={tabStyle(modo === 'clientes')} onClick={() => setModo('clientes')}>
              Soy cliente
            </button>
          </div>

          {modo === 'paneles' && (
            <form onSubmit={submit}>
              <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
                Un solo acceso para cualquier panel — con tu correo y clave te llevamos directo al tuyo.
              </p>

              <div className="field" style={{ marginBottom: 14 }}>
                <label htmlFor="au-email">Correo</label>
                <input
                  id="au-email" type="email" autoComplete="username" required
                  value={email} onChange={editar(setEmail)} placeholder="tu@empresa.cl" autoFocus
                />
              </div>

              <div className="field" style={{ marginBottom: 10 }}>
                <label htmlFor="au-password">Contraseña</label>
                <input
                  id="au-password" type="password" autoComplete="current-password" required
                  value={password} onChange={editar(setPassword)} placeholder="Contraseña"
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
                <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 13, padding: '4px 8px' }} onClick={pedirReset}>
                  ¿Olvidaste tu contraseña?
                </button>
              </div>

              {error && (
                <div className="badge badge-red" role="alert" style={{ display: 'block', padding: '10px 14px', marginBottom: 14 }}>{error}</div>
              )}
              {aviso && (
                <div className="badge badge-green" role="status" style={{ display: 'block', padding: '10px 14px', marginBottom: 14 }}>{aviso}</div>
              )}

              <button className="btn btn-primary" style={{ width: '100%' }} disabled={loading || loadingLlave}>
                {loading ? <span className="spinner" /> : 'Iniciar sesión'}
              </button>

              <button
                type="button"
                className="btn btn-outline"
                style={{ width: '100%', marginTop: 10 }}
                disabled={loading || loadingLlave}
                onClick={entrarConLlave}
              >
                {loadingLlave ? <span className="spinner" /> : (<><Icon.Shield size={16} /> Entrar con llave USB</>)}
              </button>
            </form>
          )}

          {modo === 'clientes' && (!enviado ? (
            <form onSubmit={enviarMagic}>
              <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
                Sin contraseñas: escribe el correo con el que procesaste tus facturas y te
                enviamos un <b>enlace de acceso</b> a tu historial.
              </p>
              <div className="field" style={{ marginBottom: 14 }}>
                <label htmlFor="au-email-cliente">Correo</label>
                <input
                  id="au-email-cliente" type="email" autoComplete="email" required
                  value={emailCliente} onChange={(e) => setEmailCliente(e.target.value)} placeholder="tu@empresa.cl"
                />
              </div>
              {errorCliente && (
                <div className="badge badge-red" role="alert" style={{ display: 'block', padding: '10px 14px', marginBottom: 14 }}>{errorCliente}</div>
              )}
              <button className="btn btn-primary" style={{ width: '100%' }} disabled={cargandoCliente}>
                {cargandoCliente ? <span className="spinner" /> : 'Enviarme el enlace'}
              </button>
            </form>
          ) : (
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <div style={{ color: 'var(--green)' }}><Icon.CheckCircle size={40} /></div>
              <h2 style={{ margin: '10px 0 6px' }}>Revisa tu correo</h2>
              <p className="muted" style={{ fontSize: 14 }}>
                Si <b>{emailCliente}</b> tiene historial en sicr3p, te llegará un enlace de acceso.
                Expira en 15 minutos y sirve una sola vez.
              </p>
              <button className="btn btn-outline btn-sm" onClick={() => setEnviado(false)}>Usar otro correo</button>
            </div>
          ))}
        </div>

        <div className="login-badges">
          <span className="b"><Icon.Shield size={14} /> Acceso seguro</span>
          <span className="b"><Icon.CheckCircle size={14} /> JWT + bcrypt</span>
          <span className="b"><Icon.Building size={14} /> Antofagasta, Chile</span>
        </div>
      </div>
    </div>
  );
}
