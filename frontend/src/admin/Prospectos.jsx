import { useEffect, useState } from 'react';
import { api, fmtFecha } from '../api.js';
import { Icon } from '../components/icons.jsx';

const ETAPAS = ['nuevo', 'contactado', 'demo', 'piloto', 'ganado', 'perdido'];
const VACIO = { nombre_empresa: '', rut: '', contacto: '', etapa: 'nuevo', origen: '', notas: '', proxima_accion: '' };

export default function Prospectos() {
  const [items, setItems] = useState([]);
  const [modal, setModal] = useState(null);

  const cargar = () => api.prospectos().then((r) => setItems(r.prospectos)).catch(() => {});
  useEffect(() => { cargar(); }, []);

  async function guardar() {
    try {
      if (modal.id) await api.editarProspecto(modal.id, modal);
      else await api.crearProspecto(modal);
      setModal(null); cargar();
    } catch (e) { alert(e.message); }
  }
  async function mover(p, etapa) { await api.editarProspecto(p.id, { ...p, etapa }); cargar(); }
  async function eliminar(id) { if (confirm('¿Eliminar prospecto?')) { await api.eliminarProspecto(id); cargar(); } }

  const badge = (e) => e === 'ganado' ? 'badge-green' : e === 'perdido' ? 'badge-red' : e === 'piloto' || e === 'demo' ? 'badge-amber' : 'badge-gray';

  return (
    <div>
      <div className="admin-head">
        <h1>Prospectos</h1>
        <button className="btn btn-primary" onClick={() => setModal({ ...VACIO })}>+ Nuevo prospecto</button>
      </div>

      {/* Pipeline por columnas */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${ETAPAS.length}, 1fr)`, gap: 10, marginBottom: 20 }}>
        {ETAPAS.map((et) => (
          <div key={et} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 10, minHeight: 120 }}>
            <div style={{ fontWeight: 700, fontSize: 12, textTransform: 'uppercase', color: 'var(--gray)', marginBottom: 8 }}>{et} · {items.filter((p) => p.etapa === et).length}</div>
            {items.filter((p) => p.etapa === et).map((p) => (
              <div key={p.id} style={{ background: 'var(--bg)', borderRadius: 8, padding: 8, marginBottom: 6, fontSize: 13 }}>
                <div style={{ fontWeight: 600 }}>{p.nombre_empresa}</div>
                <div className="muted" style={{ fontSize: 11 }}>{p.contacto || '—'}</div>
                {p.proxima_accion && <div className="muted" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}><Icon.Calendar size={12} /> {fmtFecha(p.proxima_accion)}</div>}
                <div style={{ marginTop: 4 }}>
                  <span style={{ cursor: 'pointer', fontSize: 11 }} onClick={() => setModal({ ...p, proxima_accion: p.proxima_accion?.slice(0,10) || '' })}>editar</span>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="card">
        <table className="data">
          <thead><tr><th>Empresa</th><th>Contacto</th><th>Etapa</th><th>Origen</th><th>Próxima acción</th><th></th></tr></thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td><b>{p.nombre_empresa}</b><div className="muted" style={{ fontSize: 12 }}>{p.rut}</div></td>
                <td className="muted">{p.contacto}</td>
                <td>
                  <select className="badge" value={p.etapa} onChange={(e) => mover(p, e.target.value)} style={{ border: 'none', background: 'var(--bg)', padding: '4px 8px', borderRadius: 6 }}>
                    {ETAPAS.map((e) => <option key={e} value={e}>{e}</option>)}
                  </select>
                </td>
                <td className="muted">{p.origen}</td>
                <td>{fmtFecha(p.proxima_accion)}</td>
                <td><button className="btn btn-ghost btn-sm" style={{ color: '#b91c1c' }} onClick={() => eliminar(p.id)}>Eliminar</button></td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 30 }}>Sin prospectos.</td></tr>}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="modal-bg" onClick={(e) => e.target.className === 'modal-bg' && setModal(null)}>
          <div className="modal">
            <h2 style={{ marginTop: 0 }}>{modal.id ? 'Editar prospecto' : 'Nuevo prospecto'}</h2>
            <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="field"><label>Empresa</label><input value={modal.nombre_empresa} onChange={(e) => setModal({ ...modal, nombre_empresa: e.target.value })} /></div>
              <div className="field"><label>RUT</label><input value={modal.rut || ''} onChange={(e) => setModal({ ...modal, rut: e.target.value })} /></div>
              <div className="field"><label>Contacto</label><input value={modal.contacto || ''} onChange={(e) => setModal({ ...modal, contacto: e.target.value })} /></div>
              <div className="field"><label>Origen</label><input value={modal.origen || ''} onChange={(e) => setModal({ ...modal, origen: e.target.value })} /></div>
              <div className="field"><label>Etapa</label><select value={modal.etapa} onChange={(e) => setModal({ ...modal, etapa: e.target.value })}>{ETAPAS.map((e) => <option key={e}>{e}</option>)}</select></div>
              <div className="field"><label>Próxima acción</label><input type="date" value={modal.proxima_accion || ''} onChange={(e) => setModal({ ...modal, proxima_accion: e.target.value })} /></div>
            </div>
            <div className="field" style={{ marginBottom: 14 }}><label>Notas</label><textarea rows={3} value={modal.notas || ''} onChange={(e) => setModal({ ...modal, notas: e.target.value })} /></div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setModal(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardar}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
