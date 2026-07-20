import { useEffect, useState } from 'react';
import { api, fmtFecha, fmtInt } from '../api.js';
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
            Códigos de prueba con créditos (1 crédito = 1 factura), API keys para empresas mandantes y terminales POS Aduana Verde.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        <button className={`btn btn-sm ${tab === 'codigos' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('codigos')}>Códigos de prueba</button>
        <button className={`btn btn-sm ${tab === 'mandantes' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('mandantes')}>API mandantes</button>
        <button className={`btn btn-sm ${tab === 'terminales' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('terminales')}>Terminales</button>
      </div>

      {tab === 'codigos' && <Codigos flash={flash} />}
      {tab === 'mandantes' && <Mandantes flash={flash} />}
      {tab === 'terminales' && <Terminales flash={flash} />}
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
          <thead><tr><th>Código</th><th>Empresa</th><th className="num">Créditos</th><th>Último uso</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id}>
                <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{c.codigo}</td>
                <td className="muted" style={{ fontSize: 13 }}>{c.empresa || '—'}{c.email && <div style={{ fontSize: 12 }}>{c.email}</div>}</td>
                <td className="num"><b>{c.creditos - c.creditos_usados}</b> / {c.creditos}</td>
                <td className="muted" style={{ fontSize: 13 }}>{c.ultimo_uso ? fmtFecha(c.ultimo_uso) : '—'}</td>
                <td><span className={`badge ${c.activo ? 'badge-green' : 'badge-gray'}`}>{c.activo ? 'Activo' : 'Inactivo'}</span></td>
                <td><button className="btn btn-outline btn-sm" onClick={() => toggle(c)}>{c.activo ? 'Desactivar' : 'Activar'}</button></td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 30 }}>Sin códigos generados.</td></tr>}
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

// ---------- Terminales POS "Aduana Verde" ----------
function Terminales({ flash }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ nombre: '', ubicacion: '' });
  const [creando, setCreando] = useState(false);
  const [claveNueva, setClaveNueva] = useState(null); // { nombre, serial, clave }

  const cargar = () => api.posTerminales().then((r) => setItems(r.terminales)).catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);

  async function crear() {
    setCreando(true);
    try {
      const { terminal, clave } = await api.crearPosTerminal(form);
      setClaveNueva({ nombre: terminal.nombre, serial: terminal.serial, clave });
      setForm({ nombre: '', ubicacion: '' });
      cargar(); flash('Terminal registrado.');
    } catch (e) { flash(e.message, true); }
    finally { setCreando(false); }
  }

  async function toggle(t) {
    try { await api.editarPosTerminal(t.id, { activo: !t.activo }); cargar(); }
    catch (e) { flash(e.message, true); }
  }

  async function regenerar(t) {
    if (!window.confirm(`¿Regenerar la clave de "${t.nombre}"? La clave actual dejará de funcionar de inmediato.`)) return;
    try {
      const { terminal, clave } = await api.editarPosTerminal(t.id, { regenerar_clave: true });
      setClaveNueva({ nombre: terminal.nombre, serial: terminal.serial, clave });
      cargar(); flash('Clave regenerada.');
    } catch (e) { flash(e.message, true); }
  }

  return (
    <div className="form-content-grid">
      <div style={{ display: 'grid', gap: 16 }}>
        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Nuevo terminal</h3>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            Terminales físicos de la red Aduana Verde. Cada equipo se conecta en <b>/pos</b> con su serial y clave (login de dispositivo).
          </p>
          <div className="field"><label>Nombre</label><input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} placeholder="POS Paso Sico 1" /></div>
          <div className="field" style={{ marginBottom: 14 }}><label>Ubicación (opcional)</label><input value={form.ubicacion} onChange={(e) => setForm({ ...form, ubicacion: e.target.value })} placeholder="Complejo fronterizo Sico" /></div>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={crear} disabled={creando || !form.nombre}>
            {creando ? <span className="spinner" /> : 'Registrar y generar clave'}
          </button>
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            La clave del terminal se muestra <b>una sola vez</b>. Si se pierde, hay que regenerarla.
          </p>
        </div>
        {claveNueva && (
          <div className="card card-pad" style={{ borderColor: 'var(--green)' }}>
            <h3 style={{ marginTop: 0 }}>Credenciales de {claveNueva.nombre}</h3>
            <div style={{ fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all', background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
              <div><span style={{ opacity: 0.6 }}>Serial:</span> <b>{claveNueva.serial}</b></div>
              <div style={{ marginTop: 6 }}><span style={{ opacity: 0.6 }}>Clave:</span> <b>{claveNueva.clave}</b></div>
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Guárdala ahora: no se puede volver a ver.</p>
          </div>
        )}
        <TarifaCompensacion flash={flash} />
      </div>

      <div className="card">
        <div className="table-scroll">
        <table className="data">
          <thead><tr><th>Terminal</th><th>Serial</th><th>Estado</th><th>Última actividad</th><th className="num">Docs. procesados</th><th></th></tr></thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.id}>
                <td><b>{t.nombre}</b>{t.ubicacion && <div className="muted" style={{ fontSize: 12 }}>{t.ubicacion}</div>}</td>
                <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{t.serial}</td>
                <td><span className={`badge ${t.activo ? 'badge-green' : 'badge-gray'}`}>{t.activo ? 'Activo' : 'Inactivo'}</span></td>
                <td className="muted" style={{ fontSize: 13 }}>{t.ultima_actividad ? fmtFecha(t.ultima_actividad) : 'Nunca'}</td>
                <td className="num"><b>{fmtInt(t.documentos_procesados)}</b></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-outline btn-sm" onClick={() => toggle(t)}>{t.activo ? 'Desactivar' : 'Activar'}</button>{' '}
                  <button className="btn btn-outline btn-sm" onClick={() => regenerar(t)}>Regenerar clave</button>
                </td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 30 }}>Sin terminales registrados.</td></tr>}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}

// ---------- Tarifa de compensación (terminales POS + flujo web) ----------
// La tarifa oficial en CLP por t CO2e con que se calcula el cobro simulado
// de compensación. GET público (/pos/config), edición solo admin (PUT).
function TarifaCompensacion({ flash }) {
  const [config, setConfig] = useState(null);
  const [tarifa, setTarifa] = useState('');
  const [fuente, setFuente] = useState('');
  const [tipoCambio, setTipoCambio] = useState('');
  const [tcAuto, setTcAuto] = useState(false);
  const [errorCarga, setErrorCarga] = useState(false);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    api.posConfig()
      .then((c) => {
        setConfig(c);
        setTarifa(c?.tarifa_clp_tco2e != null ? String(c.tarifa_clp_tco2e) : '');
        setFuente(c?.fuente || '');
        setTipoCambio(c?.tipo_cambio_usd_clp != null ? String(c.tipo_cambio_usd_clp) : '');
        setTcAuto(c?.tipo_cambio_auto === true);
      })
      .catch(() => setErrorCarga(true));
  }, []);

  async function guardar() {
    const n = Number(tarifa);
    if (!n || n <= 0) { flash('Ingresa una tarifa válida en CLP por t CO2e.', true); return; }
    const tc = tipoCambio.trim() === '' ? null : Number(tipoCambio);
    if (!tcAuto && tc !== null && (!Number.isFinite(tc) || tc <= 0)) {
      flash('El tipo de cambio debe ser un número mayor que 0, o dejarse vacío para no mostrar USD.', true);
      return;
    }
    const detalleTc = tcAuto
      ? ' con dólar automático (observado BCCh, se actualiza solo)'
      : (tc != null ? ` y el tipo de cambio a $${tc} CLP por USD` : '');
    if (!window.confirm(`¿Actualizar la tarifa de compensación a $${fmtInt(n)} CLP por t CO2e${detalleTc}? Aplica de inmediato a todos los terminales y al flujo web.`)) return;
    setGuardando(true);
    try {
      const body = { tarifa_clp_tco2e: n, fuente, tipo_cambio_auto: tcAuto };
      if (!tcAuto) body.tipo_cambio_usd_clp = tc;
      const { config: c, aviso } = await api.editarPosConfig(body);
      setConfig(c);
      setTarifa(c?.tarifa_clp_tco2e != null ? String(c.tarifa_clp_tco2e) : String(n));
      setFuente(c?.fuente || fuente);
      setTipoCambio(c?.tipo_cambio_usd_clp != null ? String(c.tipo_cambio_usd_clp) : '');
      setTcAuto(c?.tipo_cambio_auto === true);
      setErrorCarga(false);
      if (aviso) flash(aviso, true);
      else flash('Configuración de compensación actualizada.');
    } catch (e) { flash(e.message, true); }
    finally { setGuardando(false); }
  }

  return (
    <div className="card card-pad">
      <h3 style={{ marginTop: 0 }}>Tarifa de compensación y tipo de cambio</h3>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        CLP por t CO2e con que los terminales y el flujo web calculan el cobro de compensación
        (pago simulado — sin pasarela conectada). El tipo de cambio define el equivalente en USD
        que se muestra junto a los montos.
      </p>
      {config && (
        <div style={{ padding: '10px 14px', background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
          Vigente: <b>${fmtInt(config.tarifa_clp_tco2e)} CLP / t CO2e</b>
          <div style={{ fontSize: 12, marginTop: 2 }}>
            {config.tipo_cambio_usd_clp != null
              ? <>Tipo de cambio: <b>${config.tipo_cambio_usd_clp} CLP / USD</b>{config.tipo_cambio_auto && ' · automático'}</>
              : config.tipo_cambio_auto
                ? <span className="muted">Dólar automático activado — esperando la primera actualización…</span>
                : <span className="muted">Tipo de cambio USD sin fijar — el sitio no muestra montos en USD.</span>}
            {config.tipo_cambio_fuente && (
              <div className="muted" style={{ fontSize: 12 }}>
                {config.tipo_cambio_fuente}
                {config.tipo_cambio_actualizado && ` · actualizado el ${fmtFecha(config.tipo_cambio_actualizado)}`}
              </div>
            )}
          </div>
          {config.fuente && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>Fuente: {config.fuente}</div>}
          {config.updated_at && <div className="muted" style={{ fontSize: 12 }}>Actualizada el {fmtFecha(config.updated_at)}</div>}
        </div>
      )}
      {errorCarga && (
        <div className="badge badge-red" style={{ display: 'block', padding: '8px 12px', marginBottom: 12 }}>
          No se pudo cargar la tarifa vigente.
        </div>
      )}
      <div className="field">
        <label>Nueva tarifa (CLP por t CO2e)</label>
        <input inputMode="numeric" value={tarifa} placeholder="5000"
          onChange={(e) => setTarifa(e.target.value.replace(/\D/g, ''))} />
      </div>
      <div className="field">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={tcAuto} onChange={(e) => setTcAuto(e.target.checked)}
            style={{ width: 'auto', margin: 0 }} />
          Actualizar el dólar automáticamente (observado BCCh vía mindicador.cl, cada 6 h)
        </label>
      </div>
      {tcAuto ? (
        <p className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
          El servidor obtiene el dólar observado del Banco Central y lo mantiene al día solo.
          Si la fuente falla, conserva el último valor conocido.
        </p>
      ) : (
        <div className="field">
          <label>Tipo de cambio (CLP por USD, opcional)</label>
          <input inputMode="decimal" value={tipoCambio} placeholder="943.5 (dólar observado BCCh)"
            onChange={(e) => setTipoCambio(e.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1'))} />
          <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
            Vacío = no se muestran montos en USD. Fija el dólar observado del Banco Central y cita la fuente abajo.
          </p>
        </div>
      )}
      <div className="field" style={{ marginBottom: 14 }}>
        <label>Fuente (opcional)</label>
        <input value={fuente} placeholder="Impuesto verde US$5/t · dólar observado BCCh 20-07-2026"
          onChange={(e) => setFuente(e.target.value)} />
      </div>
      <button className="btn btn-primary" style={{ width: '100%' }} onClick={guardar} disabled={guardando || !tarifa}>
        {guardando ? <span className="spinner" /> : 'Guardar tarifa'}
      </button>
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
