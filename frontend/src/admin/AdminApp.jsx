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
import CapitalNatural from './CapitalNatural.jsx';
import Trazabilidad from './Trazabilidad.jsx';
import Buscar from './Buscar.jsx';

const NAV = [
  { to: '/admin', end: true, ico: Icon.Chart, label: 'Dashboard' },
  { to: '/admin/clientes', ico: Icon.Building, label: 'Clientes y contratos' },
  { to: '/admin/sesiones', ico: Icon.Doc, label: 'Sesiones e informes' },
  { to: '/admin/corredor', ico: Icon.Target, label: 'Corredor Bioceánico' },
  { to: '/admin/capital', ico: Icon.Leaf, label: 'Capital Natural' },
  { to: '/admin/trazabilidad', ico: Icon.Doc, label: 'Trazabilidad' },
  { to: '/admin/buscar', ico: Icon.Search, label: 'Búsqueda' },
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
  const [pwd, setPwd] = useState(null); // {actual, nueva, confirmar, msg, err, ok}

  useEffect(() => {
    if (!auth.access) { nav('/admin/login'); return; }
    let vigente = true;
    const verificar = (reintento = false) => api.me()
      .then((d) => { if (vigente) { setUser(d.user); setChecking(false); } })
      .catch((e) => {
        if (!vigente) return;
        // Un error de red (TypeError) no invalida la sesión: se reintenta una vez.
        if (e instanceof TypeError && !reintento) { setTimeout(() => verificar(true), 400); return; }
        auth.clear(); nav('/admin/login');
      });
    verificar();
    return () => { vigente = false; };
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
          <button className="btn btn-outline btn-sm" style={{ marginTop: 10, width: '100%' }}
            onClick={() => { setMenuOpen(false); setPwd({ actual: '', nueva: '', confirmar: '' }); }}>
            Cambiar contraseña
          </button>
          <button className="btn btn-outline btn-sm" style={{ marginTop: 8, width: '100%' }} onClick={salir}>Cerrar sesión</button>
        </div>
      </aside>

      {pwd && (
        <div className="modal-bg" onClick={(e) => e.target.className === 'modal-bg' && setPwd(null)}>
          <div className="modal" style={{ maxWidth: 420 }}>
            <h2 style={{ marginTop: 0 }}>Cambiar contraseña</h2>
            <div className="field"><label>Contraseña actual</label>
              <input type="password" value={pwd.actual} onChange={(e) => setPwd({ ...pwd, actual: e.target.value })} /></div>
            <div className="field"><label>Nueva contraseña (mín. 10 caracteres)</label>
              <input type="password" value={pwd.nueva} onChange={(e) => setPwd({ ...pwd, nueva: e.target.value })} /></div>
            <div className="field"><label>Confirmar nueva contraseña</label>
              <input type="password" value={pwd.confirmar} onChange={(e) => setPwd({ ...pwd, confirmar: e.target.value })} /></div>
            {pwd.err && <div className="badge badge-red" style={{ display: 'block', padding: '10px 14px', marginBottom: 12 }}>{pwd.err}</div>}
            {pwd.ok && <div className="badge badge-green" style={{ display: 'block', padding: '10px 14px', marginBottom: 12 }}>Contraseña actualizada.</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setPwd(null)}>Cerrar</button>
              <button className="btn btn-primary" disabled={!pwd.actual || !pwd.nueva || pwd.ok}
                onClick={async () => {
                  if (pwd.nueva !== pwd.confirmar) { setPwd({ ...pwd, err: 'Las contraseñas no coinciden.' }); return; }
                  if (pwd.nueva.length < 10) { setPwd({ ...pwd, err: 'Mínimo 10 caracteres.' }); return; }
                  try {
                    await api.cambiarPassword(pwd.actual, pwd.nueva);
                    setPwd({ ...pwd, err: null, ok: true });
                    setTimeout(() => setPwd(null), 1600);
                  } catch (e) { setPwd({ ...pwd, err: e.message, ok: false }); }
                }}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      <main className="admin-main">
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="clientes" element={<Clientes rol={user?.rol} />} />
          <Route path="sesiones" element={<Sesiones />} />
          <Route path="corredor" element={<Corredor />} />
          <Route path="capital" element={<CapitalNatural />} />
          <Route path="trazabilidad" element={<Trazabilidad />} />
          <Route path="buscar" element={<Buscar />} />
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
