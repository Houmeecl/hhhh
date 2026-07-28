import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Logo from './Logo.jsx';
import { Icon } from './icons.jsx';
import { api } from '../api.js';

// ============================================================
// Login compartido por los CINCO paneles: núcleo, terreno, puerto,
// mandante y agencia. Antes eran cinco archivos casi idénticos —
// comparando LoginPuerto con LoginMandante solo cambiaban tres tokens—
// y lo que divergía entre ellos no eran decisiones sino descuidos.
//
// Mismo patrón que components/ActivarCuenta.jsx: un componente
// parametrizado que sirve a las cinco rutas.
//
// Todo lo variable entra por props. Lo que NO cambia acá: las rutas,
// los cinco almacenes de sesión (auth, authAv, authPuerto,
// authMandante, authAgencia) y el contrato del backend — el store se
// recibe, no se elige adentro.
// ============================================================

export default function PanelLogin({
  panel,           // string que espera POST /auth/login; el backend rechaza con 403 si la cuenta no es de este panel
  authStore,       // almacén de sesión del panel (de api.js)
  redirect,        // a dónde ir tras entrar
  titulo,          // encabezado de la tarjeta
  subtitulo,       // rótulo verde bajo el logo; opcional
  descripcion,     // párrafo explicativo; opcional
  placeholder,     // ejemplo de correo
}) {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [loading, setLoading] = useState(false);

  // El error se limpia al reeditar cualquier campo: antes solo
  // desaparecía en el siguiente submit, así que quedaba en pantalla
  // contradiciendo lo que la persona estaba escribiendo.
  const editar = (set) => (e) => { set(e.target.value); if (error) setError(''); };

  async function submit(e) {
    e.preventDefault();
    setError(''); setAviso(''); setLoading(true);
    try {
      const { accessToken, refreshToken } = await api.login(email, password, panel);
      authStore.set(accessToken, refreshToken);
      nav(redirect);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // El reset existía solo en el panel núcleo. El backend ya lo soporta
  // para todos —services/cuentas.js arma RUTA_ACTIVAR según el panel—,
  // así que los otros cuatro simplemente no tenían el botón: quien
  // olvidaba su clave se quedaba sin salida en pantalla.
  async function pedirReset() {
    if (!email) { setError('Ingresa tu correo para restablecer la contraseña.'); return; }
    setError('');
    try {
      await api.solicitarReset(email);
      // Respuesta deliberadamente ambigua: no revela si el correo existe.
      setAviso('Si el correo existe, enviamos instrucciones para restablecer tu contraseña.');
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="login-wrap">
      {/* `.login-card` ya define max-width: 430px; no se repite inline. */}
      <div style={{ width: '100%', maxWidth: 430 }} className="fade-up">
        <div style={{ textAlign: 'center', marginBottom: 24, position: 'relative', zIndex: 2 }}>
          {/* `light` es obligatorio: el fondo de .login-wrap es un gradiente
              oscuro y sin esta prop el logotipo se pinta en var(--navy). */}
          <Logo size={48} tagline light />
          {subtitulo && (
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--green)', marginTop: 6 }}>{subtitulo}</div>
          )}
        </div>

        <form className="login-card" onSubmit={submit}>
          <h2>{titulo}</h2>
          {descripcion && <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>{descripcion}</p>}

          <div className="field" style={{ marginBottom: 14 }}>
            <label htmlFor="login-email">Correo</label>
            {/* type/autoComplete/required: en móvil esto decide el teclado que
                aparece y si el gestor de claves ofrece autocompletar. */}
            <input
              id="login-email" type="email" autoComplete="username" required
              value={email} onChange={editar(setEmail)} placeholder={placeholder} autoFocus
            />
          </div>

          <div className="field" style={{ marginBottom: 10 }}>
            <label htmlFor="login-password">Contraseña</label>
            <input
              id="login-password" type="password" autoComplete="current-password" required
              value={password} onChange={editar(setPassword)} placeholder="Contraseña"
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            {/* `btn` va primero a propósito: es la clase que quita el borde
                por defecto del <button>. Con solo `btn-ghost` el navegador
                pintaba un recuadro alrededor del texto. */}
            <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 13, padding: '4px 8px' }} onClick={pedirReset}>
              ¿Olvidaste tu contraseña?
            </button>
          </div>

          {/* role="alert" para que un lector de pantalla lo anuncie al aparecer. */}
          {error && (
            <div className="badge badge-red" role="alert" style={{ display: 'block', padding: '10px 14px', marginBottom: 14 }}>{error}</div>
          )}
          {aviso && (
            <div className="badge badge-green" role="status" style={{ display: 'block', padding: '10px 14px', marginBottom: 14 }}>{aviso}</div>
          )}

          <button className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? <span className="spinner" /> : 'Iniciar sesión'}
          </button>
        </form>

        <div className="login-badges">
          <span className="b"><Icon.Shield size={14} /> Acceso seguro</span>
          <span className="b"><Icon.CheckCircle size={14} /> JWT + bcrypt</span>
          <span className="b"><Icon.Building size={14} /> Antofagasta, Chile</span>
        </div>
      </div>
    </div>
  );
}
