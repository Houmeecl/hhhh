import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import { Icon } from '../components/icons.jsx';
import { api, auth } from '../api.js';
import Dashboard from './Dashboard.jsx';
import Clientes from './Clientes.jsx';
import Sesiones from './Sesiones.jsx';
import Metricas from './Metricas.jsx';
import Prospectos from './Prospectos.jsx';
import SimpleApi from './SimpleApi.jsx';
import Usuarios from './Usuarios.jsx';
import Actividad from './Actividad.jsx';
import Corredor from './Corredor.jsx';

const NAV = [
  { to: '/admin', end: true, ico: Icon.Chart, label: 'Dashboard' },
  { to: '/admin/clientes', ico: Icon.Building, label: 'Clientes y contratos' },
  { to: '/admin/sesiones', ico: Icon.Doc, label: 'Sesiones e informes' },
  { to: '/admin/corredor', ico: Icon.Target, label: 'Corredor Bioceánico' },
  { to: '/admin/metricas', ico: Icon.Chart, label: 'Métricas' },
  { to: '/admin/prospectos', ico: Icon.Target, label: 'Prospectos' },
  { to: '/admin/motor', ico: Icon.Plug, label: 'Motor externo' },
  { to: '/admin/usuarios', ico: Icon.Users, label: 'Usuarios y roles' },
  { to: '/admin/actividad', ico: Icon.List, label: 'Log de actividad' },
];

export default function AdminApp() {
  const nav = useNavigate();
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!auth.access) { nav('/admin/login'); return; }
    api.me().then((d) => { setUser(d.user); setChecking(false); }).catch(() => { auth.clear(); nav('/admin/login'); });
  }, []);

  function salir() { auth.clear(); nav('/admin/login'); }

  if (checking) return <div style={{ padding: 60 }}><span className="spinner dark" /> Cargando panel…</div>;

  return (
    <div className="admin-shell">
      {/* Barra superior solo en móvil */}
      <div className="admin-topbar">
        <button className="hamburger" aria-label="Abrir menú" onClick={() => setMenuOpen(true)}>
          <Icon.List size={22} />
        </button>
        <Logo size={22} />
      </div>

      {/* Overlay para cerrar el drawer en móvil */}
      {menuOpen && <div className="admin-overlay" onClick={() => setMenuOpen(false)} />}

      <aside className={`admin-side ${menuOpen ? 'open' : ''}`}>
        <div className="brand"><Logo size={26} light tagline /></div>
        <nav>
          {NAV.map((n) => {
            const Ico = n.ico;
            return (
              <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setMenuOpen(false)} className={({ isActive }) => (isActive ? 'active' : '')}>
                <span className="icon-badge"><Ico size={18} /></span> {n.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="foot">
          <div style={{ fontWeight: 600 }}>{user?.nombre}</div>
          <div className="muted" style={{ fontSize: 12, color: '#94a3b8' }}>{user?.email} · {user?.rol}</div>
          <button className="btn btn-outline btn-sm" style={{ marginTop: 10, width: '100%' }} onClick={salir}>Cerrar sesión</button>
        </div>
      </aside>

      <main className="admin-main">
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="clientes" element={<Clientes rol={user?.rol} />} />
          <Route path="sesiones" element={<Sesiones />} />
          <Route path="corredor" element={<Corredor />} />
          <Route path="metricas" element={<Metricas />} />
          <Route path="prospectos" element={<Prospectos />} />
          <Route path="motor" element={<SimpleApi />} />
          <Route path="usuarios" element={<Usuarios />} />
          <Route path="actividad" element={<Actividad />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </main>
    </div>
  );
}
