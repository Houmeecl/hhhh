import { useEffect, useState } from 'react';
import { api, fmtFecha } from '../api.js';

const VACIO = { rut: '', nombre_empresa: '', contacto_email: '', estado_contrato: 'piloto', fecha_inicio: '', fecha_fin: '', plan: 'piloto' };

export default function Clientes({ rol }) {
  const [clientes, setClientes] = useState([]);
  const [modal, setModal] = useState(null); // {mode:'crear'|'editar', data}
  const [cuenta, setCuenta] = useState(null); // cliente para crear cuenta
  const [toast, setToast] = useState(null);
  const esAdmin = rol === 'admin';

  const cargar = () => api.clientes().then((r) => setClientes(r.clientes)).catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);
  function flash(msg, err = false) { setToast({ msg, err }); setTimeout(() => setToast(null), 3500); }

  async function guardar() {
    try {
      if (modal.mode === 'crear') await api.crearCliente(modal.data);
      else await api.editarCliente(modal.data.id, modal.data);
      setModal(null); cargar(); flash('Cliente guardado.');
    } catch (e) { flash(e.message, true); }
  }
  async function eliminar(id) {
    if (!confirm('¿Eliminar este cliente? Esta acción no se puede deshacer.')) return;
    try { await api.eliminarCliente(id); cargar(); flash('Cliente eliminado.'); } catch (e) { flash(e.message, true); }
  }
  async function crearCuenta() {
    try {
      const r = await api.crearCuenta(cuenta.id, { email: cuenta.email });
      setCuenta(null);
      if (r.dev_activation_link) {
        const motivo = r.correo_enviado === false ? 'No se pudo enviar el correo. Comparte este link a mano' : 'Link activación (dev)';
        setToast({ msg: `${motivo}: ${r.dev_activation_link}`, err: r.correo_enviado === false, persist: true });
      } else flash('Cuenta creada. Enviamos el correo de activación.');
    } catch (e) { flash(e.message, true); }
  }

  const badge = (e) => e === 'activo' ? 'badge-green' : e === 'piloto' ? 'badge-amber' : 'badge-red';

  return (
    <div>
      <div className="admin-head">
        <h1>Clientes y contratos</h1>
        {esAdmin && <button className="btn btn-primary" onClick={() => setModal({ mode: 'crear', data: { ...VACIO } })}>+ Nuevo cliente</button>}
      </div>

      <div className="card">
        <div className="table-scroll">
        <table className="data">
          <thead>
            <tr><th>Empresa</th><th>RUT</th><th>Contacto</th><th>Contrato</th><th>Plan</th><th>Vigencia</th><th></th></tr>
          </thead>
          <tbody>
            {clientes.map((c) => (
              <tr key={c.id}>
                <td><b>{c.nombre_empresa}</b></td>
                <td>{c.rut}</td>
                <td className="muted">{c.contacto_email || '—'}</td>
                <td><span className={`badge ${badge(c.estado_contrato)}`}>{c.estado_contrato}</span></td>
                <td>{c.plan}</td>
                <td className="muted" style={{ fontSize: 13 }}>{fmtFecha(c.fecha_inicio)} → {fmtFecha(c.fecha_fin)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {esAdmin && <>
                    <button className="btn btn-ghost btn-sm" onClick={() => setModal({ mode: 'editar', data: { ...c, fecha_inicio: c.fecha_inicio?.slice(0,10) || '', fecha_fin: c.fecha_fin?.slice(0,10) || '' } })}>Editar</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setCuenta({ id: c.id, email: c.contacto_email || '' })}>Crear cuenta</button>
                    <button className="btn btn-ghost btn-sm" style={{ color: '#b91c1c' }} onClick={() => eliminar(c.id)}>Eliminar</button>
                  </>}
                </td>
              </tr>
            ))}
            {clientes.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 30 }}>Sin clientes aún.</td></tr>}
          </tbody>
        </table>
        </div>
      </div>

      {/* Modal crear/editar */}
      {modal && (
        <div className="modal-bg" onClick={(e) => e.target.className === 'modal-bg' && setModal(null)}>
          <div className="modal">
            <h2 style={{ marginTop: 0 }}>{modal.mode === 'crear' ? 'Nuevo cliente' : 'Editar cliente'}</h2>
            <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="field"><label>RUT</label><input value={modal.data.rut} disabled={modal.mode === 'editar'} onChange={(e) => setModal({ ...modal, data: { ...modal.data, rut: e.target.value } })} /></div>
              <div className="field"><label>Empresa</label><input value={modal.data.nombre_empresa} onChange={(e) => setModal({ ...modal, data: { ...modal.data, nombre_empresa: e.target.value } })} /></div>
              <div className="field"><label>Email de contacto</label><input value={modal.data.contacto_email || ''} onChange={(e) => setModal({ ...modal, data: { ...modal.data, contacto_email: e.target.value } })} /></div>
              <div className="field"><label>Plan</label><input value={modal.data.plan || ''} onChange={(e) => setModal({ ...modal, data: { ...modal.data, plan: e.target.value } })} /></div>
              <div className="field"><label>Estado de contrato</label>
                <select value={modal.data.estado_contrato} onChange={(e) => setModal({ ...modal, data: { ...modal.data, estado_contrato: e.target.value } })}>
                  <option value="piloto">piloto</option><option value="activo">activo</option><option value="vencido">vencido</option>
                </select>
              </div>
              <div className="field"><label>Inicio</label><input type="date" value={modal.data.fecha_inicio || ''} onChange={(e) => setModal({ ...modal, data: { ...modal.data, fecha_inicio: e.target.value } })} /></div>
              <div className="field"><label>Fin</label><input type="date" value={modal.data.fecha_fin || ''} onChange={(e) => setModal({ ...modal, data: { ...modal.data, fecha_fin: e.target.value } })} /></div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setModal(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardar}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal crear cuenta */}
      {cuenta && (
        <div className="modal-bg" onClick={(e) => e.target.className === 'modal-bg' && setCuenta(null)}>
          <div className="modal">
            <h2 style={{ marginTop: 0 }}>Crear cuenta de acceso</h2>
            <p className="muted">Se genera un usuario con rol <b>cliente</b> y se envía un enlace de activación por correo. No hay auto-registro.</p>
            <div className="field" style={{ marginBottom: 16 }}>
              <label>Correo del usuario</label>
              <input value={cuenta.email} onChange={(e) => setCuenta({ ...cuenta, email: e.target.value })} placeholder="usuario@empresa.cl" />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setCuenta(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={crearCuenta}>Crear y enviar</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.err ? 'err' : ''}`} style={toast.persist ? { maxWidth: 500, wordBreak: 'break-all', cursor: 'pointer' } : {}} onClick={() => toast.persist && setToast(null)}>{toast.msg}</div>}
    </div>
  );
}
