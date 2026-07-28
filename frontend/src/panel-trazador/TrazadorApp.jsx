import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import { Icon } from '../components/icons.jsx';
import { api, authTrazador } from '../api.js';
import Buscar from './Buscar.jsx';

const NAV = [
  { to: '/panel-trazador', end: true, ico: Icon.Search, label: 'Buscar' },
];

export default function TrazadorApp() {
  const nav = useNavigate();
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => { document.title = 'sicr3p — Panel de Trazador'; }, []);

  useEffect(() => {
    if (!authTrazador.access) { nav('/panel-trazador/login'); return; }
    let vigente = true;
    const verificar = (reintento = false) => api.meTrazador()
      .then((d) => {
        if (!vigente) return;
        if (d.user.panel !== 'trazador') { authTrazador.clear(); nav('/panel-trazador/login'); return; }
        setUser(d.user); setChecking(false);
      })
      .catch((e) => {
        if (!vigente) return;
        if (e instanceof TypeError && !reintento) { setTimeout(() => verificar(true), 400); return; }
        authTrazador.clear(); nav('/panel-trazador/login');
      });
    verificar();
    return () => { vigente = false; };
  }, []);

  function salir() { authTrazador.clear(); nav('/panel-trazador/login'); }

  if (checking) return <div style={{ padding: 60 }}><span className="spinner dark" /> Cargando panel…</div>;

  return (
    <div className="admin-shell">
      <div className="admin-topbar">
        <button className="hamburger" aria-label="Abrir menú" onClick={() => setMenuOpen(true)}>
          <Icon.List size={22} />
        </button>
        <Logo size={22} />
      </div>

      {menuOpen && <div className="admin-overlay" onClick={() => setMenuOpen(false)} />}

      <aside className={`admin-side ${menuOpen ? 'open' : ''}`}>
        <div className="brand">
          <Logo size={26} light />
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)', marginTop: 2 }}>Panel de Trazador</div>
        </div>
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
          <div className="muted" style={{ fontSize: 12 }}>{user?.email}</div>
          <button className="btn btn-outline btn-sm" style={{ marginTop: 8, width: '100%' }} onClick={salir}>Cerrar sesión</button>
        </div>
      </aside>

      <main className="admin-main">
        <Routes>
          <Route index element={<Buscar />} />
          <Route path="*" element={<Navigate to="/panel-trazador" replace />} />
        </Routes>
      </main>
    </div>
  );
}
