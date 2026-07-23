import { useEffect, useState } from 'react';
import { api, fmtFecha } from '../api.js';
import { Icon } from '../components/icons.jsx';

// Accesos externos: API para mandantes + códigos de prueba con créditos.
export default function Accesos() {
  const [tab, setTab] = useState('codigos');
  const [toast, setToast] = useState(null);
  const flash = (msg, err = false) => { setToast({ msg, err }); setTimeout(() => setToast(null), 3500); };

  return (
    <div>
      <div className="admin-head">
        <div>
          <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: 'var(--green-600)' }}><Icon.Qr size={24} /></span> Accesos externos
          </h1>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>
            Códigos de prueba con créditos (1 crédito = 1 factura) y API keys para empresas mandantes.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        <button className={`btn btn-sm ${tab === 'codigos' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('codigos')}>Códigos de prueba</button>
        <button className={`btn btn-sm ${tab === 'mandantes' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('mandantes')}>API mandantes</button>
      </div>

      {tab === 'codigos' && <Codigos flash={flash} />}
      {tab === 'mandantes' && <Mandantes flash={flash} />}
      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}

function Codigos({ flash }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ cantidad: '5', creditos: '5', empresa: '', email: '' });
  const [creando, setCreando] = useState(false);
  const [nuevos, setNuevos] = useState([]);

  const cargar = () => api.codigos().then((r) => setItems(r.codigos)).catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);

  async function crear() {
    setCreando(true);
    try {
      const { codigos } = await api.crearCodigos({
        cantidad: Number(form.cantidad) || 1, creditos: Number(form.creditos) || 5,
        empresa: form.empresa, email: form.email,
      });
      setNuevos(codigos.map((c) => c.codigo));
      cargar(); flash(`${codigos.length} código(s) generados.`);
    } catch (e) { flash(e.message, true); }
    finally { setCreando(false); }
  }

  async function toggle(c) {
    try { await api.editarCodigo(c.id, { activo: !c.activo }); cargar(); }
    catch (e) { flash(e.message, true); }
  }

  return (
    <div className="form-content-grid">
      <div style={{ display: 'grid', gap: 16 }}>
        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Generar códigos</h3>
          <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr', margin: '0 0 12px' }}>
            <div className="field"><label>Cantidad</label><input value={form.cantidad} onChange={(e) => setForm({ ...form, cantidad: e.target.value.replace(/\D/g, '') })} /></div>
            <div className="field"><label>Créditos c/u</label><input value={form.creditos} onChange={(e) => setForm({ ...form, creditos: e.target.value.replace(/\D/g, '') })} /></div>
            <div className="field"><label>Empresa (opcional)</label><input value={form.empresa} onChange={(e) => setForm({ ...form, empresa: e.target.value })} /></div>
            <div className="field"><label>Email (opcional)</label><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          </div>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={crear} disabled={creando}>
            {creando ? <span className="spinner" /> : 'Generar'}
          </button>
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            El invitado entra en <b>sicr3p.cl/prueba</b> con su código. Cada factura procesada consume 1 crédito.
          </p>
        </div>
        {nuevos.length > 0 && (
          <div className="card card-pad" style={{ borderColor: 'var(--green)' }}>
            <h3 style={{ marginTop: 0 }}>Recién generados</h3>
            {nuevos.map((c) => <div key={c} style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 15, padding: '4px 0' }}>{c}</div>)}
          </div>
        )}
      </div>

      <div className="card">
        <div className="table-scroll">
        <table className="data">
          <thead><tr><th>Código</th><th>Empresa</th><th className="num">Créditos</th><th>Último uso</th><th>Conexión</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {items.map((c) => {
              const conexion = c.creditos_usados > 0
                ? { texto: 'Usó créditos', clase: 'badge-green' }
                : c.primera_conexion_at
                  ? { texto: 'Conectado, sin usar créditos', clase: 'badge-yellow' }
                  : { texto: 'No conectado', clase: 'badge-gray' };
              return (
              <tr key={c.id}>
                <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{c.codigo}</td>
                <td className="muted" style={{ fontSize: 13 }}>{c.empresa || '—'}{c.email && <div style={{ fontSize: 12 }}>{c.email}</div>}</td>
                <td className="num"><b>{c.creditos - c.creditos_usados}</b> / {c.creditos}</td>
                <td className="muted" style={{ fontSize: 13 }}>{c.ultimo_uso ? fmtFecha(c.ultimo_uso) : '—'}</td>
                <td><span className={`badge ${conexion.clase}`}>{conexion.texto}</span></td>
                <td><span className={`badge ${c.activo ? 'badge-green' : 'badge-gray'}`}>{c.activo ? 'Activo' : 'Inactivo'}</span></td>
                <td><button className="btn btn-outline btn-sm" onClick={() => toggle(c)}>{c.activo ? 'Desactivar' : 'Activar'}</button></td>
              </tr>
              );
            })}
            {items.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 30 }}>Sin códigos generados.</td></tr>}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}

function Mandantes({ flash }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ nombre_empresa: '', rut: '', email: '' });
  const [tokenNuevo, setTokenNuevo] = useState(null);
  const [creando, setCreando] = useState(false);
  const [gestion, setGestion] = useState(null); // mandante siendo gestionado (webhook + proveedores)

  const cargar = () => api.mandantes().then((r) => setItems(r.mandantes)).catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);

  async function crear() {
    setCreando(true);
    try {
      const { mandante, token } = await api.crearMandante(form);
      setTokenNuevo({ empresa: mandante.nombre_empresa, token });
      setForm({ nombre_empresa: '', rut: '', email: '' });
      cargar(); flash('Mandante creado.');
    } catch (e) { flash(e.message, true); }
    finally { setCreando(false); }
  }

  async function toggle(m) {
    try { await api.editarMandante(m.id, { activo: !m.activo }); cargar(); }
    catch (e) { flash(e.message, true); }
  }

  return (
    <div className="form-content-grid">
      <div style={{ display: 'grid', gap: 16 }}>
        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Nuevo mandante</h3>
          <div className="field"><label>Empresa</label><input value={form.nombre_empresa} onChange={(e) => setForm({ ...form, nombre_empresa: e.target.value })} /></div>
          <div className="field"><label>RUT</label><input value={form.rut} onChange={(e) => setForm({ ...form, rut: e.target.value })} /></div>
          <div className="field" style={{ marginBottom: 14 }}><label>Email (opcional)</label><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={crear} disabled={creando || !form.nombre_empresa || !form.rut}>
            {creando ? <span className="spinner" /> : 'Crear y generar API key'}
          </button>
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            La API key se muestra <b>una sola vez</b>. El mandante consulta a sus proveedores con el header <code>X-Api-Key</code> (ver README).
          </p>
        </div>
        {tokenNuevo && (
          <div className="card card-pad" style={{ borderColor: 'var(--green)' }}>
            <h3 style={{ marginTop: 0 }}>API key de {tokenNuevo.empresa}</h3>
            <div style={{ fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all', background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>{tokenNuevo.token}</div>
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Cópiala ahora: no volverá a mostrarse.</p>
          </div>
        )}
      </div>

      <div className="card">
        <div className="table-scroll">
        <table className="data">
          <thead><tr><th>Empresa</th><th>RUT</th><th>Último uso</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.id}>
                <td><b>{m.nombre_empresa}</b>{m.email && <div className="muted" style={{ fontSize: 12 }}>{m.email}</div>}</td>
                <td>{m.rut}</td>
                <td className="muted" style={{ fontSize: 13 }}>{m.ultimo_uso ? fmtFecha(m.ultimo_uso) : 'Nunca'}</td>
                <td><span className={`badge ${m.activo ? 'badge-green' : 'badge-gray'}`}>{m.activo ? 'Activa' : 'Inactiva'}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-outline btn-sm" onClick={() => setGestion(m)}>Gestionar</button>{' '}
                  <button className="btn btn-outline btn-sm" onClick={() => toggle(m)}>{m.activo ? 'Desactivar' : 'Activar'}</button>
                </td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 30 }}>Sin mandantes registrados.</td></tr>}
          </tbody>
        </table>
        </div>
      </div>

      {gestion && <GestionMandante mandante={gestion} flash={flash} onClose={() => { setGestion(null); cargar(); }} />}
    </div>
  );
}

// ---------- Modal: gestión de un mandante (webhook + permisos finos) ----------
function GestionMandante({ mandante, flash, onClose }) {
  const [webhook, setWebhook] = useState(mandante.webhook_url || '');
  const [proveedores, setProveedores] = useState([]);
  const [nuevoRut, setNuevoRut] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = () => api.proveedoresMandante(mandante.id).then((r) => setProveedores(r.proveedores)).catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);

  async function guardarWebhook() {
    setGuardando(true);
    try {
      await api.editarMandante(mandante.id, { webhook_url: webhook });
      flash('Webhook actualizado.');
    } catch (e) { flash(e.message, true); }
    finally { setGuardando(false); }
  }

  async function agregar() {
    try {
      await api.agregarProveedorMandante(mandante.id, nuevoRut);
      setNuevoRut(''); cargar(); flash('Proveedor agregado a la lista.');
    } catch (e) { flash(e.message, true); }
  }

  async function quitar(p) {
    try { await api.quitarProveedorMandante(mandante.id, p.id); cargar(); }
    catch (e) { flash(e.message, true); }
  }

  return (
    <div className="modal-bg" onClick={(e) => e.target.className === 'modal-bg' && onClose()}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <h2 style={{ marginTop: 0 }}>{mandante.nombre_empresa}</h2>

        <h3 style={{ fontSize: 15, marginBottom: 6 }}>Webhook</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Notifica esta URL (POST) cada vez que se procesa una sesión nueva de este mandante.
        </p>
        <div className="field"><input value={webhook} onChange={(e) => setWebhook(e.target.value)} placeholder="https://tu-sistema.cl/hooks/sicr3p" /></div>
        <button className="btn btn-outline btn-sm" onClick={guardarWebhook} disabled={guardando}>
          {guardando ? <span className="spinner" /> : 'Guardar webhook'}
        </button>

        <h3 style={{ fontSize: 15, margin: '20px 0 6px' }}>Proveedores permitidos</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Sin ninguno agregado, el mandante ve a todos los proveedores que le facturaron (comportamiento por defecto).
          Agrega al menos uno para restringir el acceso solo a esos RUT.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input value={nuevoRut} onChange={(e) => setNuevoRut(e.target.value)} placeholder="76.123.456-0" style={{ flex: 1 }} />
          <button className="btn btn-primary btn-sm" onClick={agregar} disabled={!nuevoRut}>Agregar</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {proveedores.map((p) => (
            <span key={p.id} className="badge badge-gray" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {p.rut_proveedor}
              <button onClick={() => quitar(p)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 700 }}>×</button>
            </span>
          ))}
          {proveedores.length === 0 && <span className="muted" style={{ fontSize: 13 }}>Sin restricción (ve todos).</span>}
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="btn btn-outline" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
