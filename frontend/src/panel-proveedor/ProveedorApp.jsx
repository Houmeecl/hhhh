import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import { api, authProveedor } from '../api.js';
import CambiarPasswordObligatorio from '../components/CambiarPasswordObligatorio.jsx';
import LotesPorFirmar from './LotesPorFirmar.jsx';
import AnalisisSii from './AnalisisSii.jsx';
import Rep from './Rep.jsx';
import Transporte from './Transporte.jsx';
import Expedientes from './Expedientes.jsx';
import CentroDocumental from './CentroDocumental.jsx';
import MisDatos from './MisDatos.jsx';

// Shell mínimo, sin sidebar: siete pestañas alcanzan. Cada una es una
// ruta real (NavLink + <Routes> anidadas) — mismo patrón que los otros 7
// shells del proyecto (admin, terreno, puerto, mandante, agencia,
// trazador, Sube y Suma): antes eran useState('sii')+onClick, sin URL
// propia por pestaña ni soporte de atrás/adelante del navegador.
const TABS = [
  { to: '/panel-proveedor', end: true, label: 'Compras y ventas (SII)' },
  { to: '/panel-proveedor/rep', label: 'Ley REP' },
  { to: '/panel-proveedor/transporte', label: 'Transporte Cat. 7' },
  { to: '/panel-proveedor/expedientes', label: 'Expedientes' },
  { to: '/panel-proveedor/documentos', label: 'Documentación' },
  { to: '/panel-proveedor/lotes', label: 'Lotes por firmar' },
  { to: '/panel-proveedor/datos', label: 'Datos de la empresa' },
];

export default function ProveedorApp() {
  const nav = useNavigate();
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [onboarding, setOnboarding] = useState(null);
  const [contratoVigente, setContratoVigente] = useState(null);

  useEffect(() => { document.title = 'sicr3p — Panel de la empresa'; }, []);

  useEffect(() => {
    if (!authProveedor.access) { nav('/panel-proveedor/login'); return; }
    let vigente = true;
    const verificar = (reintento = false) => api.meProveedor()
      .then((d) => {
        if (!vigente) return;
        if (d.user.panel !== 'proveedor') { authProveedor.clear(); nav('/panel-proveedor/login'); return; }
        setUser(d.user); setChecking(false);
        if (!d.user.must_reset_password) {
          api.proveedorPerfil()
            .then((p) => { setOnboarding(!p.onboarding_completado); setContratoVigente(Boolean(p.contrato_vigente)); })
            .catch(() => { setOnboarding(false); setContratoVigente(false); });
        }
      })
      .catch((e) => {
        if (!vigente) return;
        if (e instanceof TypeError && !reintento) { setTimeout(() => verificar(true), 400); return; }
        authProveedor.clear(); nav('/panel-proveedor/login');
      });
    verificar();
    return () => { vigente = false; };
  }, []);

  useEffect(() => {
    if (contratoVigente !== false || onboarding !== false) return undefined;
    const id = setInterval(() => {
      api.proveedorPerfil()
        .then((p) => { if (p.contrato_vigente) setContratoVigente(true); })
        .catch(() => {});
    }, 30000);
    return () => clearInterval(id);
  }, [contratoVigente, onboarding]);

  function salir() { authProveedor.clear(); nav('/panel-proveedor/login'); }

  if (checking) return <div style={{ padding: 60 }}><span className="spinner dark" /> Cargando panel…</div>;

  if (user?.must_reset_password) {
    return (
      <CambiarPasswordObligatorio
        subtitulo="Panel de la empresa"
        cambiar={api.cambiarPasswordProveedor}
        onCambiada={() => api.meProveedor().then((d) => setUser(d.user))}
      />
    );
  }

  return (
    <div className="proveedor-shell theme-proveedor">
      <div className="proveedor-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Logo size={22} light />
          <div className="proveedor-kicker">Panel de la empresa</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{user?.nombre}</div>
            <div style={{ fontSize: 11, color: '#9aa8bd' }}>{user?.email}</div>
          </div>
          <button className="btn btn-outline btn-sm" onClick={salir}>Cerrar sesión</button>
        </div>
      </div>

      {onboarding ? (
        <main className="proveedor-main">
          <MisDatos onboarding onListo={() => {
            setOnboarding(false);
            api.proveedorPerfil().then((p) => setContratoVigente(Boolean(p.contrato_vigente))).catch(() => setContratoVigente(false));
          }} />
        </main>
      ) : !contratoVigente ? (
        <main style={{ maxWidth: 560, margin: '0 auto', padding: '60px 20px' }}>
          <div className="card" style={{ textAlign: 'center', padding: '36px 28px' }}>
            <span className="badge badge-amber" style={{ marginBottom: 14 }}>Cuenta en revisión</span>
            <h2 style={{ margin: '0 0 10px' }}>Ya recibimos tus datos</h2>
            <p className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
              El equipo de sicr3p está preparando el contrato de tu empresa. En cuanto quede
              emitido, tu cuenta se activa sola y podrás conectar el SII y ver tu contabilidad
              de carbono desde acá — no necesitas hacer nada más por ahora.
            </p>
          </div>
        </main>
      ) : (
        <>
          <div className="proveedor-tabs">
            <div className="proveedor-tabs-inner">
              {TABS.map((t) => (
                <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `proveedor-tab ${isActive ? 'active' : ''}`}>
                  {t.label}
                </NavLink>
              ))}
            </div>
          </div>

          <main className="proveedor-main">
            <Routes>
              <Route index element={<AnalisisSii />} />
              <Route path="rep" element={<Rep />} />
              <Route path="transporte" element={<Transporte />} />
              <Route path="expedientes" element={<Expedientes />} />
              <Route path="documentos" element={<CentroDocumental />} />
              <Route path="lotes" element={<LotesPorFirmar />} />
              <Route path="datos" element={<MisDatos />} />
              <Route path="*" element={<Navigate to="/panel-proveedor" replace />} />
            </Routes>
          </main>
        </>
      )}
    </div>
  );
}
