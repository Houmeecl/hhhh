import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import { api, authProveedor } from '../api.js';
import CambiarPasswordObligatorio from '../components/CambiarPasswordObligatorio.jsx';
import LotesPorFirmar from './LotesPorFirmar.jsx';

// Shell mínimo, sin sidebar de navegación: el proveedor solo conecta su
// llave USB y firma los lotes que le asignaron — una sola pantalla, no
// necesita menú de secciones (mismo espíritu que el resto de este panel).
export default function ProveedorApp() {
  const nav = useNavigate();
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => { document.title = 'sicr3p — Panel de Proveedor'; }, []);

  useEffect(() => {
    if (!authProveedor.access) { nav('/panel-proveedor/login'); return; }
    let vigente = true;
    const verificar = (reintento = false) => api.meProveedor()
      .then((d) => {
        if (!vigente) return;
        // Defensa en profundidad: el backend ya rechaza el login cruzado,
        // pero si el JWT quedó de otro panel se cierra esta sesión en vez
        // de mostrar datos ajenos.
        if (d.user.panel !== 'proveedor') { authProveedor.clear(); nav('/panel-proveedor/login'); return; }
        setUser(d.user); setChecking(false);
      })
      .catch((e) => {
        if (!vigente) return;
        if (e instanceof TypeError && !reintento) { setTimeout(() => verificar(true), 400); return; }
        authProveedor.clear(); nav('/panel-proveedor/login');
      });
    verificar();
    return () => { vigente = false; };
  }, []);

  function salir() { authProveedor.clear(); nav('/panel-proveedor/login'); }

  if (checking) return <div style={{ padding: 60 }}><span className="spinner dark" /> Cargando panel…</div>;

  if (user?.must_reset_password) {
    return (
      <CambiarPasswordObligatorio
        subtitulo="Panel de Proveedor"
        cambiar={api.cambiarPasswordProveedor}
        onCambiada={() => api.meProveedor().then((d) => setUser(d.user))}
      />
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 24px', background: 'var(--navy)', color: '#fff', flexWrap: 'wrap', gap: 10,
        borderBottom: '3px solid #14b8a6',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Logo size={22} light />
          <div style={{ fontSize: 12, fontWeight: 700, color: '#14b8a6' }}>Panel de Proveedor</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{user?.nombre}</div>
            <div style={{ fontSize: 11, color: '#9aa8bd' }}>{user?.email}</div>
          </div>
          <button className="btn btn-outline btn-sm" onClick={salir}>Cerrar sesión</button>
        </div>
      </div>

      <main style={{ maxWidth: 1000, margin: '0 auto', padding: '28px 20px' }}>
        <LotesPorFirmar />
      </main>
    </div>
  );
}
