import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import { apiCorredor, authCorredor } from './api.js';
import Parcelas from './Parcelas.jsx';
import Cargas from './Cargas.jsx';

// Shell del Corredor. Mismo patrón de navegación que los otros siete
// paneles —cada pestaña es una ruta real, con NavLink y <Routes>
// anidadas, no useState('tab')— para que atrás/adelante del navegador
// funcionen. Ver docs/REGLAS-DE-NAVEGACION.md.
const TABS = [
  { to: '/panel-corredor', end: true, label: 'Cargas' },
  { to: '/panel-corredor/predios', label: 'Predios' },
];

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
      <main style={{ maxWidth: 520, margin: '0 auto', padding: '60px 20px' }}>
        <div className="card card-pad" style={{ textAlign: 'center' }}>
          <span className="badge badge-amber" style={{ marginBottom: 12 }}>Corredor no habilitado</span>
          <h2 style={{ margin: '0 0 10px' }}>Todavía no está encendido en este servidor</h2>
          <p className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Logo size={22} light />
          <div className="corredor-kicker">CORREDOR BIOCEÁNICO</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{usuario?.nombre_empresa || usuario?.nombre}</div>
            <div style={{ fontSize: 11, color: '#9aa8bd' }}>{usuario?.email}</div>
          </div>
          <button className="btn btn-outline btn-sm" onClick={salir}>Cerrar sesión</button>
        </div>
      </div>

      <div className="corredor-tabs">
        <div className="corredor-tabs-inner">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end}
              className={({ isActive }) => `corredor-tab ${isActive ? 'active' : ''}`}>
              {t.label}
            </NavLink>
          ))}
        </div>
      </div>

      <main className="corredor-main">
        <Routes>
          <Route index element={<Cargas />} />
          <Route path="predios" element={<Parcelas />} />
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
    <div className="login-wrap">
      <form className="card card-pad login-card" onSubmit={guardar}>
        <h1 style={{ fontSize: 20, marginTop: 0 }}>Define tu contraseña</h1>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Entraste con una clave temporal. Elige la tuya para continuar.
        </p>
        <div className="field" style={{ marginBottom: 14 }}>
          <label>Contraseña nueva (mínimo 8 caracteres)</label>
          <input type="password" value={password} autoComplete="new-password"
            onChange={(e) => { setPassword(e.target.value); setError(''); }} />
        </div>
        {error && <div className="badge badge-red" style={{ display: 'block', padding: 10, marginBottom: 12 }}>{error}</div>}
        <button className="btn btn-primary" type="submit" style={{ width: '100%' }} disabled={guardando || password.length < 8}>
          {guardando ? <span className="spinner" /> : 'Guardar y entrar'}
        </button>
      </form>
    </div>
  );
}
