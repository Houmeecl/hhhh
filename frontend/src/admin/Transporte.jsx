import { useEffect, useState } from 'react';
import { api, fmt, fmtFecha } from '../api.js';
import { Icon } from '../components/icons.jsx';
import { Donut } from '../components/Charts.jsx';
import { formatearRut } from '../lib/rut.js';

// Transporte de personal — GHG Protocol Categoría 7.
export default function Transporte() {
  const [tab, setTab] = useState('viajes');
  const [toast, setToast] = useState(null);
  const flash = (msg, err = false) => { setToast({ msg, err }); setTimeout(() => setToast(null), 3500); };

  return (
    <div>
      <div className="admin-head">
        <div>
          <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: 'var(--green-600)' }}><Icon.Target size={24} /></span> Transporte de personal
          </h1>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>
            GHG Protocol Categoría 7 — traslados de trabajadores con factores por modo (editables). Cada viaje carga la cuenta de carbono.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        <button className={`btn btn-sm ${tab === 'viajes' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('viajes')}>Viajes</button>
        <button className={`btn btn-sm ${tab === 'modos' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('modos')}>Modos y factores</button>
      </div>

      {tab === 'viajes' ? <Viajes flash={flash} /> : <Modos flash={flash} />}
      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}

function Modos({ flash }) {
  const [items, setItems] = useState([]);
  const [edit, setEdit] = useState(null);

  const cargar = () => api.transporteModos().then((r) => setItems(r.modos)).catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);

  async function guardar() {
    try {
      await api.guardarModoTransporte(edit.codigo, {
        nombre: edit.nombre, factor_kgco2e_pkm: parseFloat(edit.factor) || 0, fuente: edit.fuente,
      });
      setEdit(null); cargar(); flash('Modo actualizado.');
    } catch (e) { flash(e.message, true); }
  }

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 14 }}>
        {items.map((m) => (
          <div className="card card-pad" key={m.codigo}>
            <b style={{ fontSize: 16 }}>{m.nombre}</b>
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--green-600)', margin: '8px 0 2px' }}>{fmt(m.factor_kgco2e_pkm, 3)}</div>
            <div className="muted" style={{ fontSize: 12 }}>kgCO2e por pasajero-km</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{m.fuente}</div>
            <button className="btn btn-outline btn-sm" style={{ marginTop: 10 }}
              onClick={() => setEdit({ codigo: m.codigo, nombre: m.nombre, factor: String(m.factor_kgco2e_pkm), fuente: m.fuente || '' })}>Editar</button>
          </div>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 14 }}>
        Factores referenciales — valida con la fuente oficial (HuellaChile / DEFRA) antes de reportar. El factor queda citado en cada viaje al calcularse.
      </p>

      {edit && (
        <div className="modal-bg" onClick={(e) => e.target.className === 'modal-bg' && setEdit(null)}>
          <div className="modal" style={{ maxWidth: 420 }}>
            <h2 style={{ marginTop: 0 }}>{edit.nombre}</h2>
            <div className="field"><label>Nombre</label><input value={edit.nombre} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} /></div>
            <div className="field"><label>Factor (kgCO2e/pasajero-km)</label><input value={edit.factor} onChange={(e) => setEdit({ ...edit, factor: e.target.value.replace(/[^\d.,]/g, '').replace(',', '.') })} /></div>
            <div className="field" style={{ marginBottom: 14 }}><label>Fuente</label><input value={edit.fuente} onChange={(e) => setEdit({ ...edit, fuente: e.target.value })} /></div>
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

const VIAJE_VACIO = { rut_cliente: '', fecha: '', modo: 'bus', origen: '', destino: '', km: '', pasajeros: '1', ida_vuelta: true, notas: '' };

function Viajes({ flash }) {
  const [viajes, setViajes] = useState([]);
  const [totales, setTotales] = useState([]);
  const [modos, setModos] = useState([]);
  const [form, setForm] = useState({ ...VIAJE_VACIO });
  const [guardando, setGuardando] = useState(false);

  const cargar = () => Promise.all([api.transporteViajes(), api.transporteModos()])
    .then(([v, m]) => { setViajes(v.viajes); setTotales(v.totales); setModos(m.modos); })
    .catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);

  async function guardar() {
    setGuardando(true);
    try {
      const { viaje } = await api.crearViaje({ ...form, km: parseFloat(form.km), pasajeros: parseInt(form.pasajeros, 10) });
      setForm({ ...VIAJE_VACIO });
      cargar();
      flash(`Viaje registrado: ${fmt(viaje.co2e, 3)} t CO2e.`);
    } catch (e) { flash(e.message, true); }
    finally { setGuardando(false); }
  }

  async function eliminar(v) {
    if (!window.confirm(`¿Eliminar el viaje ${v.origen} → ${v.destino}?`)) return;
    try { await api.eliminarViaje(v.id); cargar(); flash('Viaje eliminado.'); }
    catch (e) { flash(e.message, true); }
  }

  const donutData = totales.map((t) => ({ label: modos.find((m) => m.codigo === t.modo)?.nombre || t.modo, value: t.co2e }));

  return (
    <div className="form-content-grid">
      <div style={{ display: 'grid', gap: 16 }}>
        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Registrar traslado</h3>
          <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr', margin: '0 0 12px' }}>
            <div className="field"><label>Modo</label>
              <select value={form.modo} onChange={(e) => setForm({ ...form, modo: e.target.value })}>
                {modos.map((m) => <option key={m.codigo} value={m.codigo}>{m.nombre}</option>)}
              </select>
            </div>
            <div className="field"><label>Fecha</label><input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} /></div>
            <div className="field"><label>Origen</label><input value={form.origen} onChange={(e) => setForm({ ...form, origen: e.target.value })} placeholder="Antofagasta" /></div>
            <div className="field"><label>Destino</label><input value={form.destino} onChange={(e) => setForm({ ...form, destino: e.target.value })} placeholder="Faena / Calama" /></div>
            <div className="field"><label>Km (por tramo)</label><input value={form.km} onChange={(e) => setForm({ ...form, km: e.target.value.replace(/[^\d.,]/g, '').replace(',', '.') })} placeholder="200" /></div>
            <div className="field"><label>Pasajeros</label><input value={form.pasajeros} onChange={(e) => setForm({ ...form, pasajeros: e.target.value.replace(/\D/g, '') })} /></div>
            <div className="field"><label>RUT cliente (opcional)</label><input value={form.rut_cliente} onChange={(e) => setForm({ ...form, rut_cliente: e.target.value })} onBlur={() => form.rut_cliente && setForm((f) => ({ ...f, rut_cliente: formatearRut(f.rut_cliente) }))} /></div>
            <div className="field" style={{ display: 'flex', alignItems: 'flex-end' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500, marginBottom: 8 }}>
                <input type="checkbox" checked={form.ida_vuelta} onChange={(e) => setForm({ ...form, ida_vuelta: e.target.checked })} style={{ width: 'auto' }} /> Ida y vuelta
              </label>
            </div>
          </div>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={guardar} disabled={guardando || !form.origen || !form.destino || !form.km}>
            {guardando ? <span className="spinner" /> : 'Calcular y registrar'}
          </button>
        </div>
        {donutData.length > 0 && (
          <div className="card card-pad">
            <h3 style={{ marginTop: 0 }}>CO2e por modo</h3>
            <Donut data={donutData} unit="t CO2e" />
          </div>
        )}
      </div>

      <div className="card">
        <div className="table-scroll">
        <table className="data">
          <thead><tr><th>Fecha</th><th>Trayecto</th><th>Modo</th><th className="num">Km</th><th className="num">Pax</th><th className="num">t CO2e</th><th></th></tr></thead>
          <tbody>
            {viajes.map((v) => (
              <tr key={v.id}>
                <td className="muted" style={{ fontSize: 13 }}>{fmtFecha(v.fecha)}</td>
                <td><b>{v.origen} → {v.destino}</b>{v.ida_vuelta && <span className="muted" style={{ fontSize: 12 }}> · ida y vuelta</span>}
                  {v.rut_cliente && <div className="muted" style={{ fontSize: 12 }}>{v.rut_cliente}</div>}</td>
                <td><span className="badge badge-gray">{v.modo_nombre}</span></td>
                <td className="num">{fmt(v.km, 0)}</td>
                <td className="num">{v.pasajeros}</td>
                <td className="num"><b>{fmt(v.co2e, 3)}</b></td>
                <td><button className="btn btn-outline btn-sm" onClick={() => eliminar(v)}>Eliminar</button></td>
              </tr>
            ))}
            {viajes.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 30 }}>Sin traslados registrados.</td></tr>}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
