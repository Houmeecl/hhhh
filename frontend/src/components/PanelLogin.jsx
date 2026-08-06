import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { startAuthentication } from '@simplewebauthn/browser';
import Logo from './Logo.jsx';
import { Icon } from './icons.jsx';
import { api } from '../api.js';

// ============================================================
// Login compartido por los paneles de entidad (núcleo, terreno, puerto,
// mandante, agencia, trazador, proveedor). Antes eran archivos casi
// idénticos —comparando LoginPuerto con LoginMandante solo cambiaban tres
// tokens— y lo que divergía entre ellos no eran decisiones sino descuidos.
//
// Mismo patrón que components/ActivarCuenta.jsx: un componente
// parametrizado que sirve a todas las rutas de login de panel.
//
// Todo lo variable entra por props. Lo que NO cambia acá: las rutas, los
// almacenes de sesión (auth, authAv, authPuerto, authMandante,
// authAgencia, authTrazador, authProveedor) y el contrato del backend — el
// store se recibe, no se elige adentro.
// ============================================================

export default function PanelLogin({
  panel,           // string que espera POST /auth/login; el backend rechaza con 403 si la cuenta no es de este panel
  authStore,       // almacén de sesión del panel (de api.js)
  redirect,        // a dónde ir tras entrar
  titulo,          // encabezado de la tarjeta
  subtitulo,       // rótulo verde bajo el logo; opcional
  descripcion,     // párrafo explicativo; opcional
  placeholder,     // ejemplo de correo
  conLlave = false, // panel proveedor: login FIDO2-primero, la contraseña
                     // queda como respaldo secundario (default false — los
                     // paneles existentes no cambian de comportamiento).
}) {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingLlave, setLoadingLlave] = useState(false);

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

  // Login sin contraseña con una llave USB FIDO2 con sensor de huella
  // (YubiKey Bio, Kensington VeriMark, Feitian BioPass — se registra antes
  // desde el panel admin). Misma lógica que pages/AccesoUnico.jsx: la
  // huella se valida DENTRO de la llave, este sitio nunca la recibe, solo
  // una firma que confirma "esta llave, que ya conocemos, verificó a su
  // dueño". A diferencia de esa pantalla (que detecta el panel solo desde
  // la respuesta del backend), acá el panel ya viene fijo por prop, así
  // que se verifica que la cuenta que entró con la llave sea de ESTE
  // panel antes de guardar la sesión — mismo criterio de defensa en
  // profundidad que usa AgenciaApp al validar /auth/me.
  async function entrarConLlave() {
    if (!email) { setError('Escribe tu correo para entrar con la llave USB.'); return; }
    setError(''); setAviso(''); setLoadingLlave(true);
    try {
      const opciones = await api.webauthnLoginOpciones(email);
      const respuesta = await startAuthentication({ optionsJSON: opciones });
      const { accessToken, refreshToken, user } = await api.webauthnLoginVerificar(email, respuesta, panel);
      if (user.panel !== panel) {
        setError('Esa llave no corresponde a una cuenta de este panel.');
        return;
      }
      authStore.set(accessToken, refreshToken);
      nav(redirect);
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

  // El reset existía solo en el panel núcleo. El backend ya lo soporta
  // para todos —services/cuentas.js arma RUTA_ACTIVAR según el panel—,
  // así que los otros paneles simplemente no tenían el botón: quien
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

          {conLlave && (
            <>
              {/* Acción primaria: entra sin contraseña con la llave USB. La
                  contraseña queda como respaldo, más abajo. */}
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: '100%', marginBottom: 10 }}
                disabled={loading || loadingLlave}
                onClick={entrarConLlave}
              >
                {loadingLlave ? <span className="spinner" /> : (<><Icon.Shield size={16} /> Entrar con llave USB</>)}
              </button>
              <p className="muted" style={{ fontSize: 12, textAlign: 'center', margin: '0 0 16px' }}>
                Si aún no tenés tu llave registrada, entrá con tu contraseña temporal.
              </p>
            </>
          )}

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

          {error && (
            <div className="badge badge-red" role="alert" style={{ display: 'block', padding: '10px 14px', marginBottom: 14 }}>{error}</div>
          )}
          {aviso && (
            <div className="badge badge-green" role="status" style={{ display: 'block', padding: '10px 14px', marginBottom: 14 }}>{aviso}</div>
          )}

          <button className={`btn ${conLlave ? 'btn-outline' : 'btn-primary'}`} style={{ width: '100%' }} disabled={loading || loadingLlave}>
            {loading ? <span className="spinner" /> : 'Iniciar sesión'}
          </button>
        </form>

        {/* Solo un atajo para quien no recuerda en qué panel entra: el
            backend detecta el panel real de la cuenta y esta redirige
            sola (ver pages/AccesoUnico.jsx). No reemplaza esta pantalla
            —cada panel sigue teniendo su propia URL directa—, solo evita
            que alguien se quede trabado por no saber cuál usar. */}
        <p className="muted" style={{ fontSize: 13, textAlign: 'center', marginTop: 14 }}>
          ¿No sabes en qué panel entrar? <a href="/ingresar">Usa el acceso general</a>
        </p>

        <div className="login-badges">
          <span className="b"><Icon.Shield size={14} /> Acceso seguro</span>
          <span className="b"><Icon.CheckCircle size={14} /> JWT + bcrypt</span>
          <span className="b"><Icon.Building size={14} /> Antofagasta, Chile</span>
        </div>
      </div>
    </div>
  );
}
