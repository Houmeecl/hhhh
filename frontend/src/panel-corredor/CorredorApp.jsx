import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import Icon from '../components/icons.jsx';
import { apiCorredor, authCorredor } from './api.js';
import Parcelas from './Parcelas.jsx';
import Cargas from './Cargas.jsx';
import Empresas from './Empresas.jsx';

// Shell del Corredor. Mismo patrón de navegación que los otros siete
// paneles —cada pestaña es una ruta real, con NavLink y <Routes>
// anidadas, no useState('tab')— para que atrás/adelante del navegador
// funcionen. Ver docs/REGLAS-DE-NAVEGACION.md.
//
// LAS PESTAÑAS DEPENDEN DEL ROL, y no es cosmético. Cargas y Predios se
// filtran por `exportador_id`, que un admin del Corredor no tiene: le
// mostraban dos pantallas estructuralmente vacías y ninguna forma de
// hacer lo único que hace un admin, que es enrolar empresas. Pasó en
// producción — entró y no había nada.
const TABS_OPERADOR = [
  { to: '/panel-corredor', end: true, label: 'Cargas' },
  { to: '/panel-corredor/predios', label: 'Predios' },
];
const TABS_ADMIN = [
  { to: '/panel-corredor', end: true, label: 'Empresas' },
];
const tabsDe = (usuario) => (usuario?.rol === 'admin' ? TABS_ADMIN : TABS_OPERADOR);

export default function CorredorApp() {
  const nav = useNavigate();
  const [usuario, setUsuario] = useState(null);
  const [verificando, setVerificando] = useState(true);
  const [noHabilitado, setNoHabilitado] = useState(null);

  useEffect(() => { document.title = 'sicr3p Corredor — Panel del exportador'; }, []);

  useEffect(() => {
    if (!authCorredor.access) { nav('/panel-corredor/login'); return; }
    apiCorredor.me()
      .then((r) => { setUsuario(r.usuario); setVerificando(false); })
      .catch((e) => {
        // El 503 no es una sesión mala: es el Corredor apagado en este
        // servidor. Mandar a login sería hacer probar credenciales que no
        // van a funcionar por un motivo que no tiene que ver con ellas.
        if (e.status === 503) { setNoHabilitado(e.data?.falta || []); setVerificando(false); return; }
        authCorredor.clear();
        nav('/panel-corredor/login');
      });
  }, []);

  function salir() { authCorredor.clear(); nav('/panel-corredor/login'); }

  if (verificando) return <div style={{ padding: 60 }}><span className="spinner dark" /> Cargando panel…</div>;

  if (noHabilitado) {
    return (
      <main className="narrow-page theme-corredor">
        <div className="card card-pad cor-vacio">
          <span className="badge badge-amber badge-sem" style={{ marginBottom: 12 }}>Corredor no habilitado</span>
          <h2 style={{ margin: '0 0 10px', fontSize: 19 }}>Todavía no está encendido en este servidor</h2>
          <p className="cor-nota" style={{ margin: 0 }}>
            El equipo de sicr3p tiene que configurar {noHabilitado.join(' y ')} antes de que el panel
            del Corredor funcione. El resto de la plataforma sigue operando normalmente.
          </p>
        </div>
      </main>
    );
  }

  // Mientras la clave siga siendo la temporal, lo único posible es
  // cambiarla — el backend además rechaza todo lo demás con 403.
  if (usuario?.must_reset_password) {
    return <DefinirClave onLista={() => apiCorredor.me().then((r) => setUsuario(r.usuario))} />;
  }

  return (
    <div className="corredor-shell theme-corredor">
      <div className="corredor-header">
        <div className="corredor-marca">
          <Logo size={22} light />
          <div className="corredor-kicker">CORREDOR BIOCEÁNICO</div>
        </div>
        <div className="corredor-header-der">
          <div className="corredor-usuario">
            <b>
              {usuario?.nombre_empresa || usuario?.nombre}
              {usuario?.rol === 'admin' && (
                <span className="corredor-rol">Administración</span>
              )}
            </b>
            <span>{usuario?.email}</span>
          </div>
          <button className="btn btn-outline btn-sm" onClick={salir}>Cerrar sesión</button>
        </div>
      </div>

      <div className="corredor-tabs">
        <div className="corredor-tabs-inner">
          {tabsDe(usuario).map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end}
              className={({ isActive }) => `corredor-tab ${isActive ? 'active' : ''}`}>
              {t.label}
            </NavLink>
          ))}
        </div>
      </div>

      <main className="corredor-main">
        <Routes>
          {/* El admin no comparte ninguna ruta con el operador: las suyas
              consultarían por una empresa que no tiene. */}
          {usuario?.rol === 'admin' ? (
            <Route index element={<Empresas />} />
          ) : (
            <>
              <Route index element={<Cargas />} />
              <Route path="predios" element={<Parcelas />} />
            </>
          )}
          <Route path="*" element={<Navigate to="/panel-corredor" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function DefinirClave({ onLista }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function guardar(e) {
    e.preventDefault();
    setGuardando(true); setError('');
    try {
      const r = await apiCorredor.cambiarPassword(password);
      // El token viejo lleva must_reset_password=true y seguiría
      // bloqueando todo hasta expirar: se reemplaza por el que devuelve
      // el backend.
      authCorredor.set(r.access);
      onLista();
    } catch (err) { setError(err.message); } finally { setGuardando(false); }
  }

  return (
    <div className="login-wrap theme-corredor">
      <form className="card card-pad login-card cor-form" onSubmit={guardar}>
        <h1 style={{ fontSize: 20, marginTop: 0 }}>Define tu contraseña</h1>
        <p className="muted" style={{ fontSize: 13, margin: '0 0 18px' }}>
          Entraste con una clave temporal. Elige la tuya para continuar.
        </p>
        <div className="field">
          <label htmlFor="cor-nueva">Contraseña nueva (mínimo 8 caracteres)</label>
          <input id="cor-nueva" type="password" value={password} autoComplete="new-password"
            onChange={(e) => { setPassword(e.target.value); setError(''); }} />
        </div>
        {error && (
          <div className="cor-aviso cor-aviso-alto" role="alert">
            <Icon.Alert size={16} />
            <div>{error}</div>
          </div>
        )}
        <button className="btn btn-primary" type="submit" style={{ width: '100%', marginTop: 4 }} disabled={guardando || password.length < 8}>
          {guardando ? <span className="spinner" /> : 'Guardar y entrar'}
        </button>
      </form>
    </div>
  );
}
