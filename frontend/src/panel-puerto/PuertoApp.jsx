import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import { Icon } from '../components/icons.jsx';
import { api, authPuerto } from '../api.js';
import CambiarPasswordObligatorio from '../components/CambiarPasswordObligatorio.jsx';
import Transitos from './Transitos.jsx';

const NAV = [
  { to: '/panel-puerto', end: true, ico: Icon.Package, label: 'Tránsitos' },
];

export default function PuertoApp() {
  const nav = useNavigate();
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => { document.title = 'sicr3p — Panel de Puerto'; }, []);

  useEffect(() => {
    if (!authPuerto.access) { nav('/panel-puerto/login'); return; }
    let vigente = true;
    const verificar = (reintento = false) => api.mePuerto()
      .then((d) => {
        if (!vigente) return;
        // Defensa en profundidad: el backend ya rechaza el login cruzado,
        // pero si el JWT quedó de otro panel se cierra esta sesión en vez
        // de mostrar datos ajenos.
        if (d.user.panel !== 'puerto') { authPuerto.clear(); nav('/panel-puerto/login'); return; }
        setUser(d.user); setChecking(false);
      })
      .catch((e) => {
        if (!vigente) return;
        if (e instanceof TypeError && !reintento) { setTimeout(() => verificar(true), 400); return; }
        authPuerto.clear(); nav('/panel-puerto/login');
      });
    verificar();
    return () => { vigente = false; };
  }, []);

  function salir() { authPuerto.clear(); nav('/panel-puerto/login'); }

  if (checking) return <div style={{ padding: 60 }}><span className="spinner dark" /> Cargando panel…</div>;

  if (user?.must_reset_password) {
    return (
      <CambiarPasswordObligatorio
        subtitulo="Panel de Puerto"
        cambiar={api.cambiarPasswordPuerto}
        onCambiada={() => api.mePuerto().then((d) => setUser(d.user))}
      />
    );
  }

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
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)', marginTop: 2 }}>Panel de Puerto</div>
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
          <Route index element={<Transitos />} />
          <Route path="*" element={<Navigate to="/panel-puerto" replace />} />
        </Routes>
      </main>
    </div>
  );
}
