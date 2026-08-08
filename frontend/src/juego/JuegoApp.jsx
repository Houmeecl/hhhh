import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Icon } from '../components/icons.jsx';
import { api, authSuma, fmtInt } from '../api.js';
import Perfil from './Perfil.jsx';
import Escanear from './Escanear.jsx';
import Trayecto from './Trayecto.jsx';
import Misiones from './Misiones.jsx';
import Recompensas from './Recompensas.jsx';

// "Sube y Suma" es su propia app instalable (PWA), distinta del panel
// núcleo — mismo service worker (sw.js), solo cambia el manifest mientras
// esta ruta está montada (mismo patrón que useManifestAv en admin-av).
function useManifestSuma() {
  useEffect(() => {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return undefined;
    const original = link.getAttribute('href');
    link.setAttribute('href', '/manifest-suma.webmanifest');
    return () => link.setAttribute('href', original);
  }, []);
}

const NAV = [
  { to: '/suma', end: true, ico: Icon.Chart, label: 'Inicio' },
  { to: '/suma/escanear', end: true, ico: Icon.Camera, label: 'Escanear' },
  { to: '/suma/trayecto', end: true, ico: Icon.Truck, label: 'Trayecto' },
  { to: '/suma/misiones', end: true, ico: Icon.Target, label: 'Misiones' },
  { to: '/suma/recompensas', end: true, ico: Icon.Coin, label: 'Premios' },
];

export default function JuegoApp() {
  useManifestSuma();
  const nav = useNavigate();
  const location = useLocation();
  const [jugador, setJugador] = useState(null);
  const [checking, setChecking] = useState(true);

  // Se re-consulta en cada cambio de ruta (no solo al montar): el jugador
  // gana puntos en pantallas propias (escanear, trayecto, canjear) y el
  // contador del encabezado tiene que reflejarlo apenas vuelve a Inicio u
  // otra pestaña, sin depender de un refresco completo de la página.
  useEffect(() => {
    if (!authSuma.access) { nav('/suma/login', { replace: true }); return; }
    let vigente = true;
    api.jugadorPerfil()
      .then((d) => { if (vigente) { setJugador(d.jugador); setChecking(false); } })
      .catch(() => {
        if (!vigente) return;
        authSuma.clear();
        nav('/suma/login', { replace: true });
      });
    return () => { vigente = false; };
  }, [location.pathname]);

  function salir() { authSuma.clear(); nav('/suma/login'); }

  if (checking) {
    return (
      <div className="game-shell theme-suma">
        <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><span className="spinner" /></div>
      </div>
    );
  }

  return (
    <div className="game-shell theme-suma">
      <div className="game-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Icon.Sparkles size={18} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Sube y Suma</div>
            <div style={{ fontSize: 11, opacity: 0.75, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{jugador?.empresa}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="badge" style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}>
            {fmtInt(jugador?.puntos_totales ?? 0)} pts
          </span>
          <button className="btn btn-ghost btn-sm" style={{ color: '#fff', padding: '4px 6px' }} onClick={salir} title="Salir">
            <Icon.Logout size={16} />
          </button>
        </div>
      </div>

      <div className="game-content">
        <Routes>
          <Route index element={<Perfil />} />
          <Route path="escanear" element={<Escanear />} />
          <Route path="trayecto" element={<Trayecto />} />
          <Route path="misiones" element={<Misiones />} />
          <Route path="recompensas" element={<Recompensas />} />
          <Route path="*" element={<Navigate to="/suma" replace />} />
        </Routes>
      </div>

      <nav className="game-bottomnav">
        {NAV.map((n) => {
          const Ico = n.ico;
          return (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Ico size={20} /> {n.label}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
