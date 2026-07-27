import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import { Icon } from '../components/icons.jsx';
import { api, authAv } from '../api.js';
import ResumenAv from './ResumenAv.jsx';
import CargarAv from './CargarAv.jsx';
import RepAv from './RepAv.jsx';
import CompensacionAv from './CompensacionAv.jsx';

const NAV = [
  { to: '/panel-verde', end: true, ico: Icon.Chart, label: 'Resumen' },
  { to: '/panel-verde/cargar', ico: Icon.Doc, label: 'Cargar documento' },
  { to: '/panel-verde/rep', ico: Icon.Leaf, label: 'REP' },
  { to: '/panel-verde/compensacion', ico: Icon.Qr, label: 'Compensación' },
];

// El panel del mostrador presencial de sicr3p es su propia "app" instalable,
// distinta del panel núcleo (que usa /manifest-admin.webmanifest) — mismo
// service worker (sw.js), solo cambia el manifest mientras esta ruta está
// montada. Mismo patrón que useManifestAdmin en admin/AdminApp.jsx.
function useManifestAv() {
  useEffect(() => {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return undefined;
    const original = link.getAttribute('href');
    link.setAttribute('href', '/manifest-aduana-verde.webmanifest');
    return () => link.setAttribute('href', original);
  }, []);
}

export default function AdminAvApp() {
  const nav = useNavigate();
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  useManifestAv();

  useEffect(() => { document.title = 'sicr3p — Panel mostrador'; }, []);

  useEffect(() => {
    if (!authAv.access) { nav('/panel-verde/login'); return; }
    let vigente = true;
    const verificar = (reintento = false) => api.meAv()
      .then((d) => {
        if (!vigente) return;
        // Defensa en profundidad: el backend ya rechaza el login cruzado,
        // pero si el JWT quedó de otro panel (navegador compartido) se
        // cierra la sesión de este panel en vez de mostrar datos ajenos.
        if (d.user.panel !== 'aduana_verde') { authAv.clear(); nav('/panel-verde/login'); return; }
        setUser(d.user); setChecking(false);
      })
      .catch((e) => {
        if (!vigente) return;
        if (e instanceof TypeError && !reintento) { setTimeout(() => verificar(true), 400); return; }
        authAv.clear(); nav('/panel-verde/login');
      });
    verificar();
    return () => { vigente = false; };
  }, []);

  function salir() { authAv.clear(); nav('/panel-verde/login'); }

  if (checking) return <div style={{ padding: 60 }}><span className="spinner dark" /> Cargando panel…</div>;

  return (
    <div className="admin-shell theme-av">
      <div className="admin-topbar">
        <button className="hamburger" aria-label="Abrir menú" onClick={() => setMenuOpen(true)}>
          <Icon.List size={22} />
        </button>
        <Logo size={22} light />
      </div>

      {menuOpen && <div className="admin-overlay" onClick={() => setMenuOpen(false)} />}

      <aside className={`admin-side ${menuOpen ? 'open' : ''}`}>
        <div className="brand">
          <Logo size={26} light />
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)', marginTop: 2 }}>Mostrador presencial</div>
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
          <div className="muted" style={{ fontSize: 12, color: '#94a3b8' }}>{user?.email}</div>
          <button className="btn btn-outline btn-sm" style={{ marginTop: 8, width: '100%' }} onClick={salir}>Cerrar sesión</button>
        </div>
      </aside>

      <main className="admin-main">
        <Routes>
          <Route index element={<ResumenAv />} />
          <Route path="cargar" element={<CargarAv />} />
          <Route path="rep" element={<RepAv />} />
          <Route path="compensacion" element={<CompensacionAv />} />
          <Route path="*" element={<Navigate to="/panel-verde" replace />} />
        </Routes>
      </main>
    </div>
  );
}
