import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import { Icon } from '../components/icons.jsx';
import { api } from '../api.js';

// ============================================================
// Pantalla de elección de panel, lo primero que ve un superadmin al entrar
// (routes: /admin/paneles; Login.jsx redirige acá tras iniciar sesión).
//
// Antes esto era un <select> escondido en el pie de la barra lateral: para
// entrar a otro panel había que iniciar sesión, esperar a que cargara el
// dashboard de sicrep, bajar hasta el fondo del menú y recién ahí elegir.
// Como el superadmin casi siempre entra sabiendo a qué panel va, la
// elección corresponde ANTES, no enterrada después.
//
// Solo la ven las cuentas es_superadmin: un admin normal tiene un único
// panel y una pantalla de un solo botón sería estorbo, así que rebota
// directo a su dashboard.
// ============================================================

// El panel propio va primero y aparte: es una sesión completa, no una
// vista de 5 minutos. Los demás se abren con el token de vista que emite
// POST /api/admin/entrar-a-panel (lectura, sin refresh) — ver
// components/EntrarComoSuperadmin.jsx, que recibe ese token y lo guarda.
const PANELES_VISTA = [
  {
    valor: 'aduana_verde', etiqueta: 'Terreno', ico: Icon.Truck,
    descripcion: 'Carga de documentos y trámites en terreno.',
  },
  {
    valor: 'puerto', etiqueta: 'Puerto', ico: Icon.Package,
    descripcion: 'Tránsitos que pasan por un punto portuario.',
    cargar: () => api.puertos(), entidades: (d) => d.puertos, nombre: (e) => e.nombre,
  },
  {
    valor: 'mandante', etiqueta: 'Mandante', ico: Icon.Building,
    descripcion: 'Proveedores y export de Alcance 3 de una minera.',
    cargar: () => api.mandantes(), entidades: (d) => d.mandantes, nombre: (e) => e.nombre_empresa,
  },
  {
    valor: 'agencia', etiqueta: 'Agencia de aduana', ico: Icon.Doc,
    descripcion: 'Expedientes y captura de documentos de aduana.',
    cargar: () => api.agencias(), entidades: (d) => d.agencias, nombre: (e) => e.nombre,
  },
  {
    valor: 'trazador', etiqueta: 'Trazador', ico: Icon.Search,
    descripcion: 'Búsqueda y trazabilidad por RUT.',
    cargar: () => api.accesosTrazadores(), entidades: (d) => d.trazadores, nombre: (e) => e.nombre,
  },
  {
    valor: 'proveedor', etiqueta: 'Empresa', ico: Icon.Leaf,
    descripcion: 'Contabilidad de carbono de una empresa enrolada.',
    cargar: () => api.accesosProveedores(), entidades: (d) => d.proveedores, nombre: (e) => e.nombre_empresa,
  },
];

export default function SelectorPanel({ user }) {
  const nav = useNavigate();
  const [abierto, setAbierto] = useState(''); // panel cuya tarjeta está desplegada
  const [entidades, setEntidades] = useState(null); // null = todavía cargando
  const [entidadId, setEntidadId] = useState('');
  const [msg, setMsg] = useState('');
  const [cargando, setCargando] = useState(false);

  const cfg = PANELES_VISTA.find((p) => p.valor === abierto);

  useEffect(() => { document.title = 'sicr3p — Elegir panel'; }, []);

  useEffect(() => {
    setEntidades(null); setEntidadId(''); setMsg('');
    if (!cfg?.cargar) return undefined;
    let vigente = true;
    cfg.cargar()
      .then((d) => { if (vigente) setEntidades((cfg.entidades(d) || []).filter((e) => e.activo !== false)); })
      .catch((e) => { if (vigente) { setEntidades([]); setMsg(e.message); } });
    return () => { vigente = false; };
  }, [abierto]);

  async function abrirVista() {
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
      const { accessToken } = await api.entrarAPanel(abierto, entidadId || undefined);
      // En el fragmento (#), no en el query: así el token no llega al
      // servidor ni queda en el access.log — ver EntrarComoSuperadmin.jsx.
      const destino = `/impersonar/${abierto}#t=${encodeURIComponent(accessToken)}`;
      if (pestana) pestana.location.replace(destino);
      else window.location.assign(destino);
    } catch (e) {
      if (pestana) pestana.close();
      setMsg(e.message);
    }
    setCargando(false);
  }

  // Un admin sin la marca de superadmin no tiene nada que elegir.
  if (!user?.es_superadmin) return <Navigate to="/admin" replace />;

  const necesitaEntidad = Boolean(cfg?.cargar);
  const listo = abierto && (!necesitaEntidad || entidadId);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--navy)', color: '#fff', padding: '48px 20px' }}>
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Logo size={40} light tagline />
          <h1 style={{ fontSize: 26, margin: '22px 0 6px' }}>¿A qué panel quieres entrar?</h1>
          <p style={{ color: '#9aa8bd', fontSize: 14, margin: 0 }}>
            Hola {user?.nombre || user?.email}. Tu sesión es del panel sicrep; los demás se abren
            como vista de solo lectura, en una pestaña aparte y por 5 minutos.
          </p>
        </div>

        {/* El panel propio, aparte del resto: es la sesión real, no una vista. */}
        <button
          onClick={() => nav('/admin')}
          style={{
            display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left',
            background: '#fff', border: 'none', borderRadius: 12, padding: '18px 20px',
            cursor: 'pointer', marginBottom: 26,
          }}
        >
          <span className="icon-badge" style={{ background: 'var(--green)', color: '#fff' }}><Icon.Chart size={20} /></span>
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', fontWeight: 700, color: 'var(--navy)', fontSize: 16 }}>Panel sicrep</span>
            <span style={{ display: 'block', color: '#64748b', fontSize: 13 }}>
              Tu panel de siempre: clientes, contabilidad de carbono, motor y accesos.
            </span>
          </span>
          <Icon.ArrowRight size={18} color="var(--navy)" />
        </button>

        <div style={{ fontSize: 12, fontWeight: 700, color: '#9aa8bd', letterSpacing: .4, marginBottom: 10 }}>
          VER OTRO PANEL (5 MIN, SOLO LECTURA)
        </div>

        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {PANELES_VISTA.map((p) => {
            const Ico = p.ico;
            const activo = abierto === p.valor;
            return (
              <div key={p.valor} style={{
                background: activo ? 'rgba(20,184,166,.14)' : 'rgba(255,255,255,.06)',
                border: `1px solid ${activo ? '#14b8a6' : 'rgba(255,255,255,.12)'}`,
                borderRadius: 12, padding: 16, minWidth: 0,
              }}>
                <button
                  onClick={() => setAbierto(activo ? '' : p.valor)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                    background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0,
                  }}
                >
                  <Ico size={18} color="#14b8a6" />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 600, fontSize: 15 }}>{p.etiqueta}</span>
                    <span style={{ display: 'block', color: '#9aa8bd', fontSize: 12.5 }}>{p.descripcion}</span>
                  </span>
                </button>

                {activo && (
                  <div style={{ marginTop: 12 }}>
                    {p.cargar && (
                      <select
                        value={entidadId} onChange={(e) => setEntidadId(e.target.value)}
                        style={{ width: '100%', marginBottom: 8 }}
                      >
                        <option value="">
                          {entidades ? (entidades.length ? 'Elige cuál…' : 'Sin entidades activas') : 'Cargando…'}
                        </option>
                        {(entidades || []).map((e) => (
                          <option key={e.id} value={e.id}>{p.nombre(e)}</option>
                        ))}
                      </select>
                    )}
                    {msg && <div style={{ fontSize: 12, color: '#fca5a5', marginBottom: 8 }}>{msg}</div>}
                    <button
                      className="btn btn-primary btn-sm" style={{ width: '100%' }}
                      disabled={!listo || cargando} onClick={abrirVista}
                    >
                      {cargando ? <><span className="spinner" /> Abriendo…</> : 'Abrir vista'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
