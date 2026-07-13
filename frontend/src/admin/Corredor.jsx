import { useEffect, useState, useRef } from 'react';
import { api, fmt, fmtFecha } from '../api.js';
import { Icon } from '../components/icons.jsx';

const PAISES = { CL: 'Chile', AR: 'Argentina', PY: 'Paraguay', BR: 'Brasil' };
const TIPOS = ['factura', 'energia', 'combustible', 'guia', 'manifiesto', 'contrato', 'otro'];

export default function Corredor() {
  const [tab, setTab] = useState('metodologias');
  const [toast, setToast] = useState(null);
  const flash = (msg, err = false) => { setToast({ msg, err }); setTimeout(() => setToast(null), 3500); };

  return (
    <div>
      <div className="admin-head">
        <div>
          <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: 'var(--green-600)' }}><Icon.Target size={24} /></span> Corredor Bioceánico Capricornio
          </h1>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>
            Brasil · Paraguay · Argentina · Chile — trazabilidad y contabilidad de carbono por tramo, con metodología por país.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        <button className={`btn btn-sm ${tab === 'metodologias' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('metodologias')}>Metodologías por país</button>
        <button className={`btn btn-sm ${tab === 'documentos' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('documentos')}>Documentos</button>
      </div>

      {tab === 'metodologias' ? <Metodologias flash={flash} /> : <Documentos flash={flash} />}

      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}

function Metodologias({ flash }) {
  const [items, setItems] = useState([]);
  const [edit, setEdit] = useState(null);

  const cargar = () => api.corredorMetodologias().then((r) => setItems(r.metodologias)).catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);

  async function guardar() {
    try {
      const factores = {
        electricidad_kgco2e_kwh: parseFloat(edit.elec) || 0,
        diesel_kgco2e_l: parseFloat(edit.diesel) || 0,
      };
      await api.guardarMetodologia(edit.pais, {
        nombre: edit.nombre, factores, referencia: edit.referencia, fuente: edit.fuente,
        vigencia: edit.vigencia, notas: edit.notas,
      });
      setEdit(null); cargar(); flash('Metodología guardada.');
    } catch (e) { flash(e.message, true); }
  }
  async function toggle(m) {
    try { await api.guardarMetodologia(m.pais, { activo: !m.activo }); cargar(); flash(`${PAISES[m.pais]} ${!m.activo ? 'activado' : 'desactivado'}.`); }
    catch (e) { flash(e.message, true); }
  }

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
        {items.map((m) => (
          <div className="card card-pad" key={m.pais}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <b style={{ fontSize: 17 }}>{PAISES[m.pais]}</b>
              <span className={`badge ${m.activo ? 'badge-green' : 'badge-gray'}`}>{m.activo ? '● Activo' : '○ Inactivo'}</span>
            </div>
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{m.referencia}</div>
            <table className="data" style={{ marginTop: 12 }}>
              <tbody>
                <tr><td className="muted">Electricidad</td><td className="num">{fmt(m.factores?.electricidad_kgco2e_kwh, 4)} kgCO2e/kWh</td></tr>
                <tr><td className="muted">Diésel</td><td className="num">{fmt(m.factores?.diesel_kgco2e_l, 3)} kgCO2e/L</td></tr>
              </tbody>
            </table>
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Fuente: {m.fuente} · {m.vigencia}</div>
            {m.notas && <div className="muted" style={{ fontSize: 12, marginTop: 4, fontStyle: 'italic' }}>{m.notas}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn btn-outline btn-sm" onClick={() => setEdit({
                pais: m.pais, nombre: m.nombre, referencia: m.referencia, fuente: m.fuente, vigencia: m.vigencia, notas: m.notas || '',
                elec: m.factores?.electricidad_kgco2e_kwh ?? '', diesel: m.factores?.diesel_kgco2e_l ?? '',
              })}>Editar</button>
              <button className={`btn btn-sm ${m.activo ? 'btn-danger' : 'btn-primary'}`} onClick={() => toggle(m)}>
                {m.activo ? 'Desactivar' : 'Activar'}
              </button>
            </div>
          </div>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 14 }}>
        Cada país aplica su propia metodología. Solo los países <b>activos</b> calculan CO₂e; los inactivos guardan los documentos como traza hasta validar sus factores.
      </p>

      {edit && (
        <div className="modal-bg" onClick={(e) => e.target.className === 'modal-bg' && setEdit(null)}>
          <div className="modal">
            <h2 style={{ marginTop: 0 }}>Metodología · {PAISES[edit.pais]}</h2>
            <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="field"><label>Nombre</label><input value={edit.nombre || ''} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} /></div>
              <div className="field"><label>Referencia (marco/norma)</label><input value={edit.referencia || ''} onChange={(e) => setEdit({ ...edit, referencia: e.target.value })} /></div>
              <div className="field"><label>Electricidad (kgCO2e/kWh)</label><input value={edit.elec} onChange={(e) => setEdit({ ...edit, elec: e.target.value })} /></div>
              <div className="field"><label>Diésel (kgCO2e/L)</label><input value={edit.diesel} onChange={(e) => setEdit({ ...edit, diesel: e.target.value })} /></div>
              <div className="field"><label>Fuente</label><input value={edit.fuente || ''} onChange={(e) => setEdit({ ...edit, fuente: e.target.value })} /></div>
              <div className="field"><label>Vigencia</label><input value={edit.vigencia || ''} onChange={(e) => setEdit({ ...edit, vigencia: e.target.value })} /></div>
            </div>
            <div className="field" style={{ marginBottom: 14 }}><label>Notas</label><textarea rows={2} value={edit.notas} onChange={(e) => setEdit({ ...edit, notas: e.target.value })} /></div>
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

function Documentos({ flash }) {
  const [docs, setDocs] = useState([]);
  const [form, setForm] = useState({ pais_origen: 'BR', pais_destino: 'CL', tramo: '', tipo_documento: 'factura', rut_emisor: '', rut_receptor: '' });
  const [file, setFile] = useState(null);
  const [subiendo, setSubiendo] = useState(false);
  const fileRef = useRef();

  const cargar = () => api.corredorDocumentos().then((r) => setDocs(r.documentos)).catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);

  async function subir() {
    if (!file) { flash('Adjunta un documento (archivo o foto).', true); return; }
    setSubiendo(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      fd.append('archivo', file);
      const { documento } = await api.subirDocumentoCorredor(fd);
      setFile(null); if (fileRef.current) fileRef.current.value = '';
      cargar();
      flash(documento.estado === 'procesado' ? `Procesado: ${fmt(documento.total_co2e, 3)} t CO2e` : documento.estado === 'pendiente_motor' ? 'Guardado (país inactivo: pendiente de motor).' : 'Guardado como traza documental.');
    } catch (e) { flash(e.message, true); } finally { setSubiendo(false); }
  }

  const badge = (e) => e === 'procesado' ? 'badge-green' : e === 'pendiente_motor' ? 'badge-amber' : 'badge-gray';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 20, alignItems: 'start' }}>
      <div className="card card-pad">
        <h3 style={{ marginTop: 0 }}>Cargar documento</h3>
        <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr', margin: '0 0 12px' }}>
          <div className="field"><label>País origen</label>
            <select value={form.pais_origen} onChange={(e) => setForm({ ...form, pais_origen: e.target.value })}>{Object.entries(PAISES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </div>
          <div className="field"><label>País destino</label>
            <select value={form.pais_destino} onChange={(e) => setForm({ ...form, pais_destino: e.target.value })}>{Object.entries(PAISES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </div>
          <div className="field"><label>Tramo</label><input value={form.tramo} onChange={(e) => setForm({ ...form, tramo: e.target.value })} placeholder="Campo Grande → Antofagasta" /></div>
          <div className="field"><label>Tipo</label>
            <select value={form.tipo_documento} onChange={(e) => setForm({ ...form, tipo_documento: e.target.value })}>{TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}</select>
          </div>
          <div className="field"><label>RUT emisor</label><input value={form.rut_emisor} onChange={(e) => setForm({ ...form, rut_emisor: e.target.value })} /></div>
          <div className="field"><label>RUT receptor</label><input value={form.rut_receptor} onChange={(e) => setForm({ ...form, rut_receptor: e.target.value })} /></div>
        </div>
        {/* Carga por archivo o cámara del teléfono */}
        <input ref={fileRef} type="file" accept=".pdf,.xml,.jpg,.jpeg,.png" capture="environment" onChange={(e) => setFile(e.target.files[0])} style={{ fontSize: 13, marginBottom: 10, width: '100%' }} />
        {file && <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>📎 {file.name}</div>}
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={subir} disabled={subiendo}>
          {subiendo ? <span className="spinner" /> : 'Cargar y trazar'}
        </button>
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          Facturas, energía y combustible calculan CO₂e con la metodología del país destino (si está activo). El resto se guarda como traza documental.
        </p>
      </div>

      <div className="card">
        <table className="data">
          <thead><tr><th>Fecha</th><th>Tramo</th><th>Tipo</th><th>Metodología</th><th>Estado</th><th className="num">t CO2e</th></tr></thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td className="muted" style={{ fontSize: 13 }}>{fmtFecha(d.created_at)}</td>
                <td>{d.pais_origen} → {d.pais_destino}{d.tramo ? <div className="muted" style={{ fontSize: 12 }}>{d.tramo}</div> : null}</td>
                <td><span className="badge badge-gray">{d.tipo_documento}</span></td>
                <td>{d.metodologia_pais}</td>
                <td><span className={`badge ${badge(d.estado)}`}>{d.estado}</span></td>
                <td className="num">{d.estado === 'procesado' ? fmt(d.total_co2e, 3) : '—'}</td>
              </tr>
            ))}
            {docs.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 30 }}>Sin documentos cargados.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
