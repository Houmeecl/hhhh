import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import { Icon } from '../components/icons.jsx';
import { api, auth } from '../api.js';
import CambiarPasswordObligatorio from '../components/CambiarPasswordObligatorio.jsx';
import Dashboard from './Dashboard.jsx';
import Clientes from './Clientes.jsx';
import Sesiones from './Sesiones.jsx';
import Metricas from './Metricas.jsx';
import Prospectos from './Prospectos.jsx';
import SimpleApi from './SimpleApi.jsx';
import Usuarios from './Usuarios.jsx';
import Actividad from './Actividad.jsx';
import Corredor from './Corredor.jsx';
import Origen from './Origen.jsx';
import CapitalNatural from './CapitalNatural.jsx';
import Trazabilidad from './Trazabilidad.jsx';
import Buscar from './Buscar.jsx';
import Transporte from './Transporte.jsx';
import Accesos from './Accesos.jsx';
import MotorPropio from './MotorPropio.jsx';
import Capacitacion from './Capacitacion.jsx';
import Apl from './Apl.jsx';
import Auspiciadores from './Auspiciadores.jsx';
import Datos from './Datos.jsx';
import Sii from './Sii.jsx';
import Enrolar from './Enrolar.jsx';

const NAV = [
  { to: '/admin', end: true, ico: Icon.Chart, label: 'Dashboard' },
  { to: '/admin/enrolar', ico: Icon.Users, label: 'Enrolar cliente' },
  { to: '/admin/clientes', ico: Icon.Building, label: 'Clientes y contratos' },
  { to: '/admin/sesiones', ico: Icon.Doc, label: 'Sesiones e informes' },
  { to: '/admin/corredor', ico: Icon.Target, label: 'Corredor Bioceánico' },
  { to: '/admin/origen', ico: Icon.Qr, label: 'Pasaporte de Origen' },
  { to: '/admin/capital', ico: Icon.Leaf, label: 'Capital Natural' },
  { to: '/admin/trazabilidad', ico: Icon.Doc, label: 'Trazabilidad' },
  { to: '/admin/sii', ico: Icon.Doc, label: 'SII compras/ventas' },
  { to: '/admin/buscar', ico: Icon.Search, label: 'Búsqueda' },
  { to: '/admin/transporte', ico: Icon.ArrowRight, label: 'Transporte Cat. 7' },
  { to: '/admin/accesos', ico: Icon.Qr, label: 'Accesos externos' },
  { to: '/admin/metricas', ico: Icon.Chart, label: 'Métricas' },
  { to: '/admin/prospectos', ico: Icon.Target, label: 'Prospectos' },
  { to: '/admin/motor-propio', ico: Icon.Cog, label: 'Motor propio' },
  { to: '/admin/motor', ico: Icon.Plug, label: 'Motor externo' },
  { to: '/admin/usuarios', ico: Icon.Users, label: 'Usuarios y roles' },
  { to: '/admin/actividad', ico: Icon.List, label: 'Log de actividad' },
  { to: '/admin/capacitacion', ico: Icon.Book, label: 'Capacitación' },
  { to: '/admin/apl', ico: Icon.CheckCircle, label: 'APL' },
  { to: '/admin/auspiciadores', ico: Icon.Users, label: 'Auspiciadores' },
  { to: '/admin/datos', ico: Icon.Shield, label: 'Datos personales' },
];

// Bloque "Entrar a otro panel" — visible solo para cuentas es_superadmin.
// Canjea la sesión sicrep por un token de VISTA (5 min, sin refresh) del
// panel elegido y abre una pestaña nueva al puente /impersonar/:panel.
const PANELES_VISTA = [
  { valor: 'aduana_verde', etiqueta: 'Terreno', entidades: null },
  { valor: 'puerto', etiqueta: 'Puerto', entidades: (d) => d.puertos, cargar: () => api.puertos(), nombre: (e) => e.nombre },
  { valor: 'mandante', etiqueta: 'Mandante', entidades: (d) => d.mandantes, cargar: () => api.mandantes(), nombre: (e) => e.nombre_empresa },
  { valor: 'agencia', etiqueta: 'Agencia', entidades: (d) => d.agencias, cargar: () => api.agencias(), nombre: (e) => e.nombre },
  { valor: 'trazador', etiqueta: 'Trazador', entidades: (d) => d.trazadores, cargar: () => api.accesosTrazadores(), nombre: (e) => e.nombre },
  { valor: 'proveedor', etiqueta: 'Proveedor', entidades: (d) => d.proveedores, cargar: () => api.accesosProveedores(), nombre: (e) => e.nombre_empresa },
];

function EntrarAOtroPanel() {
  const [panel, setPanel] = useState('');
  const [entidades, setEntidades] = useState(null); // null = panel sin entidad
  const [entidadId, setEntidadId] = useState('');
  const [msg, setMsg] = useState('');
  const [cargando, setCargando] = useState(false);

  const cfg = PANELES_VISTA.find((p) => p.valor === panel);

  useEffect(() => {
    setEntidades(null); setEntidadId(''); setMsg('');
    if (!cfg || !cfg.cargar) return;
    let vigente = true;
    cfg.cargar()
      .then((d) => { if (vigente) setEntidades((cfg.entidades(d) || []).filter((e) => e.activo !== false)); })
      .catch((e) => { if (vigente) setMsg(e.message); });
    return () => { vigente = false; };
  }, [panel]);

  async function entrar() {
    setMsg(''); setCargando(true);
    // La pestaña se abre ACÁ, todavía dentro del gesto del clic. Si se
    // abriera después del await, el navegador la trata como popup no
    // solicitado y la bloquea en silencio: el botón parecía no hacer nada.
    // Va sin 'noopener' porque con esa opción window.open devuelve null y
    // se pierde la referencia para redirigirla; el vínculo se corta a mano
    // con opener = null (el destino es del mismo origen, no un tercero).
    const pestana = window.open('', '_blank');
    if (pestana) pestana.opener = null;
    try {
      const { accessToken } = await api.entrarAPanel(panel, entidadId || undefined);
      // En el fragmento (#), no en el query: así el token no llega al
      // servidor ni queda en el access.log — ver EntrarComoSuperadmin.jsx.
      const destino = `/impersonar/${panel}#t=${encodeURIComponent(accessToken)}`;
      // Si aun así la bloqueó (algunos navegadores con el bloqueo estricto),
      // se usa la pestaña actual en vez de dejar al usuario sin nada.
      if (pestana) pestana.location.replace(destino);
      else window.location.assign(destino);
    } catch (e) {
      if (pestana) pestana.close();
      setMsg(e.message);
    }
    setCargando(false);
  }

  const necesitaEntidad = Boolean(cfg?.cargar);
  const listo = panel && (!necesitaEntidad || entidadId);

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,.12)' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>Entrar a otro panel</div>
      <select value={panel} onChange={(e) => setPanel(e.target.value)} style={{ width: '100%', marginBottom: 6 }}>
        <option value="">Panel…</option>
        {PANELES_VISTA.map((p) => <option key={p.valor} value={p.valor}>{p.etiqueta}</option>)}
      </select>
      {necesitaEntidad && (
        <select value={entidadId} onChange={(e) => setEntidadId(e.target.value)} style={{ width: '100%', marginBottom: 6 }}>
          <option value="">{entidades ? (entidades.length ? 'Entidad…' : 'Sin entidades activas') : 'Cargando…'}</option>
          {(entidades || []).map((e) => <option key={e.id} value={e.id}>{cfg.nombre(e)}</option>)}
        </select>
      )}
      {msg && <div style={{ fontSize: 12, color: '#fca5a5', marginBottom: 6 }}>{msg}</div>}
      <button className="btn btn-outline btn-sm" style={{ width: '100%' }} disabled={!listo || cargando} onClick={entrar}>
        {cargando ? 'Abriendo…' : 'Abrir vista (5 min)'}
      </button>
    </div>
  );
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
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pwd, setPwd] = useState(null); // {actual, nueva, confirmar, msg, err, ok}

  useManifestAdmin();

  useEffect(() => { document.title = 'sicrep — Panel'; }, []);

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
          <div className="muted" style={{ fontSize: 12, color: '#94a3b8' }}>{user?.email} · {user?.rol}{user?.es_superadmin ? ' · superadmin' : ''}</div>
          {user?.es_superadmin && <EntrarAOtroPanel />}
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
          <Route path="origen" element={<Origen />} />
          <Route path="capital" element={<CapitalNatural />} />
          <Route path="trazabilidad" element={<Trazabilidad />} />
          <Route path="buscar" element={<Buscar />} />
          <Route path="transporte" element={<Transporte />} />
          <Route path="accesos" element={<Accesos />} />
          <Route path="metricas" element={<Metricas />} />
          <Route path="prospectos" element={<Prospectos />} />
          <Route path="motor-propio" element={<MotorPropio />} />
          <Route path="motor" element={<SimpleApi />} />
          <Route path="usuarios" element={<Usuarios yo={user} />} />
          <Route path="actividad" element={<Actividad />} />
          <Route path="capacitacion/*" element={<Capacitacion />} />
          <Route path="apl" element={<Apl />} />
          <Route path="auspiciadores" element={<Auspiciadores rol={user?.rol} />} />
          <Route path="datos" element={<Datos rol={user?.rol} />} />
          <Route path="sii" element={<Sii />} />
          <Route path="enrolar" element={<Enrolar />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </main>
    </div>
  );
}
