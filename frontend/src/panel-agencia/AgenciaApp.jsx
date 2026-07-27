import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import { Icon } from '../components/icons.jsx';
import { api, authAgencia } from '../api.js';
import Expedientes from './Expedientes.jsx';
import CapturarDocumentos from './CapturarDocumentos.jsx';

const NAV = [
  { to: '/panel-agencia', end: true, ico: Icon.Package, label: 'Expedientes' },
  { to: '/panel-agencia/capturar', end: true, ico: Icon.Cloud, label: 'Capturar documentos' },
];

export default function AgenciaApp() {
  const nav = useNavigate();
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => { document.title = 'sicr3p — Panel de Agencia'; }, []);

  useEffect(() => {
    if (!authAgencia.access) { nav('/panel-agencia/login'); return; }
    let vigente = true;
    const verificar = (reintento = false) => api.meAgencia()
      .then((d) => {
        if (!vigente) return;
        // Defensa en profundidad: el backend ya rechaza el login cruzado,
        // pero si el JWT quedó de otro panel se cierra esta sesión en vez
        // de mostrar datos ajenos.
        if (d.user.panel !== 'agencia') { authAgencia.clear(); nav('/panel-agencia/login'); return; }
        setUser(d.user); setChecking(false);
      })
      .catch((e) => {
        if (!vigente) return;
        if (e instanceof TypeError && !reintento) { setTimeout(() => verificar(true), 400); return; }
        authAgencia.clear(); nav('/panel-agencia/login');
      });
    verificar();
    return () => { vigente = false; };
  }, []);

  function salir() { authAgencia.clear(); nav('/panel-agencia/login'); }

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
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)', marginTop: 2 }}>Panel de Agencia</div>
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
          <Route index element={<Expedientes />} />
          <Route path="capturar" element={<CapturarDocumentos />} />
          <Route path="*" element={<Navigate to="/panel-agencia" replace />} />
        </Routes>
      </main>
    </div>
  );
}
