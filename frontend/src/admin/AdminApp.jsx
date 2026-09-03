import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import { Icon } from '../components/icons.jsx';
import { api, auth } from '../api.js';
import CambiarPasswordObligatorio from '../components/CambiarPasswordObligatorio.jsx';
import Dashboard from './Dashboard.jsx';
import Clientes from './Clientes.jsx';
import Sesiones from './Sesiones.jsx';
import Metricas from './Metricas.jsx';
import Juego from './Juego.jsx';
import Prospectos from './Prospectos.jsx';
import SimpleApi from './SimpleApi.jsx';
import Usuarios from './Usuarios.jsx';
import Actividad from './Actividad.jsx';
import Corredor from './Corredor.jsx';
import Origen from './Origen.jsx';
import CorredorQR from './CorredorQR.jsx';
import CapitalNatural from './CapitalNatural.jsx';
import Contabilidad from './Contabilidad.jsx';
import Trazabilidad from './Trazabilidad.jsx';
import Buscar from './Buscar.jsx';
import Transporte from './Transporte.jsx';
import Accesos from './Accesos.jsx';
import MotorPropio from './MotorPropio.jsx';
import Capacitacion from './Capacitacion.jsx';
import Apl from './Apl.jsx';
import Auspiciadores from './Auspiciadores.jsx';
import Activos from './Activos.jsx';
import Datos from './Datos.jsx';
import Sii from './Sii.jsx';
import Enrolar from './Enrolar.jsx';
import Cobros from './Cobros.jsx';
import SelectorPanel from './SelectorPanel.jsx';
import { SECCIONES_ADMIN_NAV, itemsVisiblesDe, puedeVerAlguna } from './secciones.js';

// El menú (23 entradas agrupadas por lo que la persona viene a hacer)
// vive en secciones.js — misma fuente que los checkboxes de Usuarios.jsx.
// Desde la migración 092 cada cuenta ve solo sus secciones asignadas
// (superadmin ve todo); el gate real está en el backend (requireSeccion),
// esto solo evita mostrar puertas que van a dar 403.

// Envuelve una pantalla que exige sección: sin permiso, rebota al
// Dashboard en vez de renderizar — así una URL tecleada a mano tampoco
// muestra nada, aunque el NAV ya la esconda. `slug` acepta un array
// cuando la pantalla la comparten dos secciones con distinto alcance
// (ej. accesos_externos completo Y proveedores, más angosta — ver
// Accesos.jsx, que filtra sus propias tabs según cuál de las dos tiene).
function RequiereSeccion({ user, slug, children }) {
  const slugs = Array.isArray(slug) ? slug : [slug];
  if (!puedeVerAlguna(user, ...slugs)) return <Navigate to="/admin" replace />;
  return children;
}

// El panel admin es su propia "app" instalable, distinta del sitio público
// (que usa /manifest.webmanifest, start_url "/"): mientras se está en
// /admin, el navegador ofrece instalar "sicr3p Admin" con su propio
// nombre/scope — mismo service worker (sw.js) para ambas, sin cache
// especial de datos operativos.
function useManifestAdmin() {
  useEffect(() => {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return undefined;
    const original = link.getAttribute('href');
    link.setAttribute('href', '/manifest-admin.webmanifest');
    return () => link.setAttribute('href', original);
  }, []);
}

export default function AdminApp() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pwd, setPwd] = useState(null); // {actual, nueva, confirmar, msg, err, ok}

  useManifestAdmin();

  useEffect(() => { document.title = 'sicr3p — Panel'; }, []);

  useEffect(() => {
    if (!auth.access) { nav('/admin/login'); return; }
    let vigente = true;
    const verificar = (reintento = false) => api.me()
      .then((d) => {
        if (!vigente) return;
        // Defensa en profundidad (mismo criterio que los otros paneles):
        // un token válido de OTRO panel no entra al admin.
        if (d.user?.panel && d.user.panel !== 'sicrep') { auth.clear(); nav('/admin/login'); return; }
        setUser(d.user); setChecking(false);
      })
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

  if (user?.must_reset_password) {
    return (
      <CambiarPasswordObligatorio
        subtitulo="Panel sicrep"
        cambiar={api.cambiarPassword}
        onCambiada={() => api.me().then((d) => setUser(d.user))}
      />
    );
  }

  // La elección de panel ocupa la pantalla completa: es lo primero tras
  // iniciar sesión y todavía no se sabe a qué panel va la persona, así que
  // mostrarle el menú lateral de sicrep alrededor sería contradecir la
  // pregunta. Va DESPUÉS del cambio de contraseña obligatorio: con una clave
  // temporal todavía sin cambiar no corresponde ofrecer ningún panel.
  // SelectorPanel rebota solo a /admin si la cuenta no es superadmin.
  if (pathname === '/admin/paneles') return <SelectorPanel user={user} />;

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
          {SECCIONES_ADMIN_NAV.map((sec) => {
            const visibles = itemsVisiblesDe(sec, user);
            if (!visibles.length) return null; // grupo sin nada que mostrar: ni el título
            return (
              <div key={sec.titulo}>
                <div className="nav-sec">{sec.titulo}</div>
                {visibles.map((n) => {
                  const Ico = n.ico;
                  return (
                    <NavLink key={n.slug} to={n.to} end={n.end} onClick={() => setMenuOpen(false)} className={({ isActive }) => (isActive ? 'active' : '')}>
                      <span className="icon-badge"><Ico size={18} /></span> {n.label}
                    </NavLink>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="foot">
          <div style={{ fontWeight: 600 }}>{user?.nombre}</div>
          <div className="muted" style={{ fontSize: 12, color: '#94a3b8' }}>{user?.email} · {user?.rol}{user?.es_superadmin ? ' · superadmin' : ''}</div>
          {user?.es_superadmin && (
            <button className="btn btn-outline btn-sm" style={{ marginTop: 10, width: '100%' }}
              onClick={() => { setMenuOpen(false); nav('/admin/paneles'); }}>
              Entrar a otro panel
            </button>
          )}
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
          <Route index element={<Dashboard user={user} />} />
          <Route path="clientes" element={<RequiereSeccion user={user} slug="clientes"><Clientes rol={user?.rol} /></RequiereSeccion>} />
          <Route path="sesiones" element={<RequiereSeccion user={user} slug="sesiones"><Sesiones /></RequiereSeccion>} />
          <Route path="corredor" element={<RequiereSeccion user={user} slug="corredor"><Corredor /></RequiereSeccion>} />
          <Route path="origen" element={<RequiereSeccion user={user} slug="origen"><Origen /></RequiereSeccion>} />
          <Route path="origen-carteles-qr" element={<RequiereSeccion user={user} slug="origen"><CorredorQR /></RequiereSeccion>} />
          <Route path="capital" element={<RequiereSeccion user={user} slug="capital_natural"><CapitalNatural /></RequiereSeccion>} />
          <Route path="contabilidad" element={<RequiereSeccion user={user} slug="contabilidad"><Contabilidad /></RequiereSeccion>} />
          <Route path="trazabilidad" element={<RequiereSeccion user={user} slug="trazabilidad"><Trazabilidad /></RequiereSeccion>} />
          <Route path="buscar" element={<RequiereSeccion user={user} slug="buscar"><Buscar /></RequiereSeccion>} />
          <Route path="transporte" element={<RequiereSeccion user={user} slug="transporte"><Transporte /></RequiereSeccion>} />
          <Route path="accesos" element={<RequiereSeccion user={user} slug={['accesos_externos', 'proveedores']}><Accesos user={user} /></RequiereSeccion>} />
          <Route path="metricas" element={<RequiereSeccion user={user} slug="metricas"><Metricas /></RequiereSeccion>} />
          <Route path="juego" element={<RequiereSeccion user={user} slug="juego"><Juego /></RequiereSeccion>} />
          <Route path="prospectos" element={<RequiereSeccion user={user} slug="prospectos"><Prospectos /></RequiereSeccion>} />
          <Route path="motor-propio" element={<RequiereSeccion user={user} slug="motor_propio"><MotorPropio /></RequiereSeccion>} />
          <Route path="motor" element={<RequiereSeccion user={user} slug="motor_externo"><SimpleApi /></RequiereSeccion>} />
          <Route path="usuarios" element={<RequiereSeccion user={user} slug="usuarios"><Usuarios yo={user} /></RequiereSeccion>} />
          <Route path="actividad" element={<RequiereSeccion user={user} slug="actividad"><Actividad /></RequiereSeccion>} />
          <Route path="capacitacion/*" element={<RequiereSeccion user={user} slug="capacitacion"><Capacitacion /></RequiereSeccion>} />
          <Route path="apl" element={<RequiereSeccion user={user} slug="apl"><Apl /></RequiereSeccion>} />
          <Route path="auspiciadores" element={<RequiereSeccion user={user} slug="auspiciadores"><Auspiciadores rol={user?.rol} /></RequiereSeccion>} />
          <Route path="activos" element={<RequiereSeccion user={user} slug="activos"><Activos rol={user?.rol} /></RequiereSeccion>} />
          <Route path="datos" element={<RequiereSeccion user={user} slug="datos_personales"><Datos rol={user?.rol} /></RequiereSeccion>} />
          <Route path="sii" element={<RequiereSeccion user={user} slug="sii"><Sii /></RequiereSeccion>} />
          <Route path="enrolar" element={<RequiereSeccion user={user} slug="enrolar"><Enrolar /></RequiereSeccion>} />
          <Route path="cobros" element={<RequiereSeccion user={user} slug="cobros"><Cobros /></RequiereSeccion>} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </main>
    </div>
  );
}
