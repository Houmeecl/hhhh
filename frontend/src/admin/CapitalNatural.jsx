import { useEffect, useState } from 'react';
import { api, fmt, fmtInt, fmtFecha } from '../api.js';
import { Icon } from '../components/icons.jsx';
import { Donut } from '../components/Charts.jsx';

// Etiquetas de factores conocidos (el resto se muestra tal cual).
const FACTOR_LABELS = {
  electricidad_kgco2e_kwh: 'Electricidad (kgCO2e/kWh)',
  agua_kgco2e_m3: 'Agua (kgCO2e/m3)',
  materiales_kgco2e_kg: 'Materiales (kgCO2e/kg)',
};

export default function CapitalNatural() {
  const [tab, setTab] = useState('cuentas');
  const [toast, setToast] = useState(null);
  const flash = (msg, err = false) => { setToast({ msg, err }); setTimeout(() => setToast(null), 3500); };

  return (
    <div>
      <div className="admin-head">
        <div>
          <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: 'var(--green-600)' }}><Icon.Leaf size={24} /></span> Capital Natural
          </h1>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>
            Cuentas ambientales del Plan Nacional de Cuentas Ambientales de Chile (MMA), basado en SEEA (ONU): flujos derivados de documentos + activos naturales (stocks). Agua, energía, carbono y materiales.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        <button className={`btn btn-sm ${tab === 'cuentas' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('cuentas')}>Plan de cuentas</button>
        <button className={`btn btn-sm ${tab === 'activos' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('activos')}>Activos naturales</button>
        <button className={`btn btn-sm ${tab === 'libro' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('libro')}>Libro y balance</button>
      </div>

      {tab === 'cuentas' && <Cuentas flash={flash} />}
      {tab === 'activos' && <Activos flash={flash} />}
      {tab === 'libro' && <Libro flash={flash} />}

      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}

// ---------- Pestaña 1: Plan de cuentas ----------
function Cuentas({ flash }) {
  const [items, setItems] = useState([]);
  const [edit, setEdit] = useState(null);

  const cargar = () => api.capitalCuentas().then((r) => setItems(r.cuentas)).catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);

  async function toggle(c) {
    try {
      await api.guardarCuentaNatural(c.codigo, { activo: !c.activo });
      cargar(); flash(`${c.nombre} ${!c.activo ? 'activada' : 'desactivada'}.`);
    } catch (e) { flash(e.message, true); }
  }

  async function guardar() {
    try {
      const factores = {};
      for (const [k, v] of Object.entries(edit.factores || {})) {
        const n = parseFloat(v);
        if (n > 0) factores[k] = n;
      }
      await api.guardarCuentaNatural(edit.codigo, {
        factores, fuente: edit.fuente, notas: edit.notas,
        precio_clp_unidad: edit.precio_clp_unidad, precio_fuente: edit.precio_fuente,
      });
      setEdit(null); cargar(); flash('Cuenta guardada.');
    } catch (e) { flash(e.message, true); }
  }

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {items.map((c) => (
          <div className="card card-pad" key={c.codigo}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <b style={{ fontSize: 17 }}>{c.codigo} · {c.nombre}</b>
              <span className={`badge ${c.activo ? 'badge-green' : 'badge-gray'}`}>{c.activo ? '● Activa' : '○ Inactiva'}</span>
            </div>
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              {c.unidad} · {c.tipo === 'stock' ? 'solo stock (activos)' : 'flujo del período'} · {c.marco}
            </div>
            {Object.keys(c.factores || {}).length > 0 && (
              <table className="data" style={{ marginTop: 12 }}>
                <tbody>
                  {Object.entries(c.factores).map(([k, v]) => (
                    <tr key={k}><td className="muted" style={{ fontSize: 13 }}>{FACTOR_LABELS[k] || k}</td><td className="num">{fmt(v, 4)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
            {c.fuente && <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Fuente: {c.fuente}</div>}
            {c.notas && <div className="muted" style={{ fontSize: 12, marginTop: 4, fontStyle: 'italic' }}>{c.notas}</div>}
            {c.precio_clp_unidad != null && (
              <div className="muted" style={{ fontSize: 12, marginTop: 8, borderTop: '1px dashed var(--border)', paddingTop: 8 }}>
                Precio: $ {fmtInt(c.precio_clp_unidad)} / {c.unidad} — valoriza activos automáticamente sin monto manual.
                {c.precio_fuente && <div>Fuente: {c.precio_fuente}</div>}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn btn-outline btn-sm" onClick={() => setEdit({
                codigo: c.codigo, nombre: c.nombre, fuente: c.fuente || '', notas: c.notas || '',
                factores: Object.fromEntries(Object.entries(c.factores || {}).map(([k, v]) => [k, String(v)])),
                precio_clp_unidad: c.precio_clp_unidad != null ? String(c.precio_clp_unidad) : '',
                precio_fuente: c.precio_fuente || '',
              })}>Editar</button>
              <button className={`btn btn-sm ${c.activo ? 'btn-danger' : 'btn-primary'}`} onClick={() => toggle(c)}>
                {c.activo ? 'Desactivar' : 'Activar'}
              </button>
            </div>
          </div>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 14 }}>
        Solo las cuentas <b>activas</b> reciben movimientos automáticos al procesar documentos. Los factores de conversión son editables y quedan citados en el informe.
      </p>

      {edit && (
        <div className="modal-bg" onClick={(e) => e.target.className === 'modal-bg' && setEdit(null)}>
          <div className="modal">
            <h2 style={{ marginTop: 0 }}>Cuenta · {edit.codigo} — {edit.nombre}</h2>
            {Object.keys(edit.factores).length > 0 && (
              <div className="form-row" style={{ gridTemplateColumns: '1fr' }}>
                {Object.entries(edit.factores).map(([k, v]) => (
                  <div className="field" key={k}>
                    <label>{FACTOR_LABELS[k] || k}</label>
                    <input value={v} onChange={(e) => setEdit({ ...edit, factores: { ...edit.factores, [k]: e.target.value } })} />
                  </div>
                ))}
              </div>
            )}
            <div className="field"><label>Fuente</label><input value={edit.fuente} onChange={(e) => setEdit({ ...edit, fuente: e.target.value })} /></div>
            <div className="field"><label>Notas</label><textarea rows={2} value={edit.notas} onChange={(e) => setEdit({ ...edit, notas: e.target.value })} /></div>
            <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr', margin: '10px 0 0' }}>
              <div className="field"><label>Precio unitario CLP (opcional)</label>
                <input value={edit.precio_clp_unidad} onChange={(e) => setEdit({ ...edit, precio_clp_unidad: e.target.value.replace(/[^\d.,]/g, '').replace(',', '.') })} placeholder="Vacío = sin valorización automática" /></div>
              <div className="field"><label>Fuente del precio</label>
                <input value={edit.precio_fuente} onChange={(e) => setEdit({ ...edit, precio_fuente: e.target.value })} placeholder="Ej. ESVD, tasación propia…" /></div>
            </div>
            <p className="muted" style={{ fontSize: 12, margin: '6px 0 14px' }}>
              Si defines un precio, los activos de esta cuenta sin "Valor CLP" manual se valorizan solos (extensión × precio) y se marcan "auto" en el informe.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setEdit(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardar}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------- Pestaña 2: Activos naturales ----------
const ACTIVO_VACIO = { nombre: '', cuenta_codigo: 'AGUA', descripcion: '', extension: '', unidad: '', condicion: '', valor_clp: '', ubicacion: '', vigencia: '' };

function Activos({ flash }) {
  const [items, setItems] = useState([]);
  const [cuentas, setCuentas] = useState([]);
  const [form, setForm] = useState(null); // null | {id?, ...campos}

  const cargar = () => Promise.all([api.capitalActivos(), api.capitalCuentas()])
    .then(([a, c]) => { setItems(a.activos); setCuentas(c.cuentas); })
    .catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);

  async function guardar() {
    try {
      if (form.id) await api.editarActivoNatural(form.id, form);
      else await api.crearActivoNatural(form);
      setForm(null); cargar(); flash('Activo guardado.');
    } catch (e) { flash(e.message, true); }
  }
  async function eliminar(a) {
    if (!window.confirm(`¿Eliminar el activo "${a.nombre}"?`)) return;
    try { await api.eliminarActivoNatural(a.id); cargar(); flash('Activo eliminado.'); }
    catch (e) { flash(e.message, true); }
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn btn-primary btn-sm" onClick={() => setForm({ ...ACTIVO_VACIO })}>+ Nuevo activo</button>
      </div>
      <div className="card">
        <div className="table-scroll">
        <table className="data">
          <thead><tr><th>Activo</th><th>Cuenta</th><th className="num">Extensión</th><th className="num">Condición</th><th className="num">Valor (CLP)</th><th>Ubicación</th><th></th></tr></thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id}>
                <td><b>{a.nombre}</b>{a.descripcion && <div className="muted" style={{ fontSize: 12 }}>{a.descripcion}</div>}</td>
                <td><span className="badge badge-gray">{a.cuenta_codigo}</span></td>
                <td className="num">{fmt(a.extension, 1)} {a.unidad || a.cuenta_unidad}</td>
                <td className="num">{a.condicion != null ? `${a.condicion}/100` : '—'}</td>
                <td className="num">
                  {a.valor_clp_efectivo != null ? `$ ${fmtInt(a.valor_clp_efectivo)}` : '—'}
                  {a.valor_origen === 'automatico' && <span className="badge badge-gray" style={{ marginLeft: 6, fontSize: 10 }}>auto</span>}
                </td>
                <td className="muted" style={{ fontSize: 13 }}>{a.ubicacion || '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-outline btn-sm" onClick={() => setForm({
                    id: a.id, nombre: a.nombre, cuenta_codigo: a.cuenta_codigo, descripcion: a.descripcion || '',
                    extension: String(a.extension ?? ''), unidad: a.unidad || '', condicion: a.condicion != null ? String(a.condicion) : '',
                    valor_clp: a.valor_clp != null ? String(a.valor_clp) : '', ubicacion: a.ubicacion || '', vigencia: a.vigencia || '',
                  })}>Editar</button>{' '}
                  <button className="btn btn-danger btn-sm" onClick={() => eliminar(a)}>Eliminar</button>
                </td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 30 }}>Sin activos registrados. Registra derechos de agua, predios, bosques u otros stocks naturales.</td></tr>}
          </tbody>
        </table>
        </div>
      </div>

      {form && (
        <div className="modal-bg" onClick={(e) => e.target.className === 'modal-bg' && setForm(null)}>
          <div className="modal">
            <h2 style={{ marginTop: 0 }}>{form.id ? 'Editar activo' : 'Nuevo activo natural'}</h2>
            <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="field"><label>Nombre</label><input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} placeholder="Derecho de agua 12 l/s" /></div>
              <div className="field"><label>Cuenta</label>
                <select value={form.cuenta_codigo} disabled={Boolean(form.id)} onChange={(e) => setForm({ ...form, cuenta_codigo: e.target.value })}>
                  {cuentas.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.nombre}</option>)}
                </select>
              </div>
              <div className="field"><label>Extensión</label><input value={form.extension} onChange={(e) => setForm({ ...form, extension: e.target.value })} placeholder="12" /></div>
              <div className="field"><label>Unidad</label><input value={form.unidad} onChange={(e) => setForm({ ...form, unidad: e.target.value })} placeholder="l/s, ha, m3…" /></div>
              <div className="field"><label>Condición (0–100, opcional)</label><input type="range" min="0" max="100" value={form.condicion || 0} onChange={(e) => setForm({ ...form, condicion: e.target.value })} />
                <div className="muted" style={{ fontSize: 12 }}>{form.condicion !== '' ? `${form.condicion}/100` : 'sin evaluar'}</div>
              </div>
              <div className="field"><label>Valor CLP manual (opcional)</label><input value={form.valor_clp} onChange={(e) => setForm({ ...form, valor_clp: e.target.value.replace(/\D/g, '') })} placeholder="Vacío = automático si la cuenta tiene precio" /></div>
              <div className="field"><label>Ubicación</label><input value={form.ubicacion} onChange={(e) => setForm({ ...form, ubicacion: e.target.value })} placeholder="Antofagasta" /></div>
              <div className="field"><label>Vigencia</label><input value={form.vigencia} onChange={(e) => setForm({ ...form, vigencia: e.target.value })} placeholder="Indefinida / 2030" /></div>
            </div>
            <div className="field" style={{ marginBottom: 14 }}><label>Descripción</label><textarea rows={2} value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} /></div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setForm(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardar} disabled={!form.nombre}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------- Pestaña 3: Libro y balance ----------
const MOV_VACIO = { cuenta_codigo: 'CO2E', fecha: '', glosa: '', cantidad: '', unidad: '', tipo: 'cargo' };

function Libro({ flash }) {
  const [balance, setBalance] = useState([]);
  const [movs, setMovs] = useState([]);
  const [filtro, setFiltro] = useState({ cuenta: '', desde: '', hasta: '' });
  const [nuevo, setNuevo] = useState(null);
  const [descargando, setDescargando] = useState(false);

  const qs = () => {
    const p = new URLSearchParams();
    if (filtro.cuenta) p.set('cuenta', filtro.cuenta);
    if (filtro.desde) p.set('desde', filtro.desde);
    if (filtro.hasta) p.set('hasta', filtro.hasta);
    const s = p.toString();
    return s ? `?${s}` : '';
  };

  const cargar = () => Promise.all([
    api.capitalBalance(qs()),
    api.capitalLibro(qs()),
  ]).then(([b, l]) => { setBalance(b.balance); setMovs(l.movimientos); }).catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, [filtro]);

  async function guardarMovimiento() {
    try {
      await api.crearMovimientoNatural(nuevo);
      setNuevo(null); cargar(); flash('Movimiento registrado.');
    } catch (e) { flash(e.message, true); }
  }

  async function pdf() {
    setDescargando(true);
    try { await api.abrirBalanceNaturalPdf(qs()); }
    catch (e) { flash(e.message, true); }
    finally { setDescargando(false); }
  }

  const activas = balance.filter((b) => b.activo);
  const donutData = activas.filter((b) => b.n_movimientos > 0).map((b) => ({ label: `${b.codigo} · ${b.nombre}`, value: b.n_movimientos }));

  return (
    <>
      {/* Tarjetas de balance */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14, marginBottom: 18 }}>
        {activas.map((b) => (
          <div className="card card-pad" key={b.codigo}>
            <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em' }}>{b.codigo} · {b.nombre}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--green-600)', margin: '6px 0 2px' }}>{fmt(b.saldo, 2)}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {b.unidad} · {b.n_movimientos} mov.
              {b.n_activos > 0 && <> · {b.n_activos} activo{b.n_activos > 1 ? 's' : ''}{b.valor_clp_total != null ? ` ($ ${fmtInt(b.valor_clp_total)})` : ''}</>}
            </div>
          </div>
        ))}
      </div>

      <div className="form-content-grid">
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="card card-pad">
            <h3 style={{ marginTop: 0 }}>Movimientos por cuenta</h3>
            <Donut data={donutData} unit="movimientos" />
          </div>
          <div className="card card-pad">
            <h3 style={{ marginTop: 0 }}>Informe</h3>
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={pdf} disabled={descargando}>
              {descargando ? <span className="spinner" /> : 'Estado de Capital Natural (PDF)'}
            </button>
            <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              Balance por cuenta con movimientos del período, activos naturales y metodología citada (Plan Nacional de Cuentas Ambientales de Chile / SEEA).
            </p>
          </div>
        </div>

        <div>
          {/* Filtros */}
          <div className="card card-pad" style={{ marginBottom: 14 }}>
            <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr 1fr auto', alignItems: 'end', margin: 0 }}>
              <div className="field"><label>Cuenta</label>
                <select value={filtro.cuenta} onChange={(e) => setFiltro({ ...filtro, cuenta: e.target.value })}>
                  <option value="">Todas</option>
                  {balance.map((b) => <option key={b.codigo} value={b.codigo}>{b.codigo} · {b.nombre}</option>)}
                </select>
              </div>
              <div className="field"><label>Desde</label><input type="date" value={filtro.desde} onChange={(e) => setFiltro({ ...filtro, desde: e.target.value })} /></div>
              <div className="field"><label>Hasta</label><input type="date" value={filtro.hasta} onChange={(e) => setFiltro({ ...filtro, hasta: e.target.value })} /></div>
              <button className="btn btn-outline btn-sm" style={{ marginBottom: 4 }} onClick={() => setNuevo({ ...MOV_VACIO })}>+ Movimiento manual</button>
            </div>
          </div>

          <div className="card">
            <div className="table-scroll">
            <table className="data">
              <thead><tr><th>Fecha</th><th>Cuenta</th><th>Glosa</th><th>Tipo</th><th className="num">Cantidad</th><th>Origen</th></tr></thead>
              <tbody>
                {movs.map((m) => (
                  <tr key={m.id}>
                    <td className="muted" style={{ fontSize: 13 }}>{fmtFecha(m.fecha)}</td>
                    <td><span className="badge badge-gray">{m.cuenta_codigo}</span></td>
                    <td style={{ fontSize: 13 }}>{m.glosa}</td>
                    <td><span className={`badge ${m.tipo === 'cargo' ? 'badge-green' : 'badge-amber'}`}>{m.tipo}</span></td>
                    <td className="num">{fmt(m.cantidad, 2)} {m.unidad}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{m.origen}{m.factura_id ? ' · trazado' : ''}</td>
                  </tr>
                ))}
                {movs.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 30 }}>Sin movimientos en el período. Procesa documentos o registra un movimiento manual.</td></tr>}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      </div>

      {nuevo && (
        <div className="modal-bg" onClick={(e) => e.target.className === 'modal-bg' && setNuevo(null)}>
          <div className="modal">
            <h2 style={{ marginTop: 0 }}>Movimiento manual</h2>
            <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="field"><label>Cuenta</label>
                <select value={nuevo.cuenta_codigo} onChange={(e) => {
                  const c = balance.find((b) => b.codigo === e.target.value);
                  setNuevo({ ...nuevo, cuenta_codigo: e.target.value, unidad: c?.unidad || '' });
                }}>
                  {balance.map((b) => <option key={b.codigo} value={b.codigo}>{b.codigo} · {b.nombre}</option>)}
                </select>
              </div>
              <div className="field"><label>Fecha</label><input type="date" value={nuevo.fecha} onChange={(e) => setNuevo({ ...nuevo, fecha: e.target.value })} /></div>
              <div className="field"><label>Cantidad</label><input value={nuevo.cantidad} onChange={(e) => setNuevo({ ...nuevo, cantidad: e.target.value.replace(/[^\d.,]/g, '').replace(',', '.') })} placeholder="0.0" /></div>
              <div className="field"><label>Tipo</label>
                <select value={nuevo.tipo} onChange={(e) => setNuevo({ ...nuevo, tipo: e.target.value })}>
                  <option value="cargo">Cargo (consumo/emisión)</option>
                  <option value="abono">Abono (reducción/compensación)</option>
                </select>
              </div>
            </div>
            <div className="field" style={{ marginBottom: 14 }}><label>Glosa</label><input value={nuevo.glosa} onChange={(e) => setNuevo({ ...nuevo, glosa: e.target.value })} placeholder="Ajuste medición directa marzo" /></div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setNuevo(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardarMovimiento} disabled={!nuevo.glosa || !nuevo.cantidad}>Registrar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
