import { useEffect, useState } from 'react';
import { api, fmtFecha } from '../api.js';

const ROLES = ['admin', 'operador', 'cliente'];

export default function Usuarios() {
  const [usuarios, setUsuarios] = useState([]);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);

  const cargar = () => api.usuarios().then((r) => setUsuarios(r.usuarios)).catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);
  function flash(msg, err = false, persist = false) { setToast({ msg, err, persist }); if (!persist) setTimeout(() => setToast(null), 3500); }

  async function crear() {
    try {
      const r = await api.crearUsuario(modal);
      setModal(null); cargar();
      if (r.dev_activation_link) {
        const motivo = r.correo_enviado === false ? 'No se pudo enviar el correo. Comparte este link a mano' : 'Link activación (dev)';
        flash(`Usuario creado. ${motivo}: ${r.dev_activation_link}`, r.correo_enviado === false, true);
      } else flash('Usuario creado. Enviamos el correo de activación.');
    } catch (e) { flash(e.message, true); }
  }
  async function cambiar(u, campo, valor) {
    try { await api.editarUsuario(u.id, { [campo]: valor }); cargar(); } catch (e) { flash(e.message, true); }
  }
  async function reenviar(u) {
    try {
      const r = await api.reenviarActivacion(u.id);
      if (r.dev_activation_link) {
        const motivo = r.correo_enviado === false ? 'No se pudo enviar el correo. Comparte este link a mano' : 'Link activación (dev)';
        flash(`${motivo}: ${r.dev_activation_link}`, r.correo_enviado === false, true);
      } else flash('Reenviamos el correo de activación.');
    } catch (e) { flash(e.message, true); }
  }

  const badge = (e) => e === 'activo' ? 'badge-green' : e === 'pendiente' ? 'badge-amber' : 'badge-red';

  return (
    <div>
      <div className="admin-head">
        <h1>Usuarios y roles</h1>
        <button className="btn btn-primary" onClick={() => setModal({ email: '', nombre: '', rol: 'operador' })}>+ Nuevo usuario</button>
      </div>

      <div className="card">
        <div className="table-scroll">
        <table className="data">
          <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Estado</th><th>Cliente</th><th>Último acceso</th><th></th></tr></thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id}>
                <td><b>{u.nombre}</b></td>
                <td className="muted">{u.email}</td>
                <td>
                  <select value={u.rol} onChange={(e) => cambiar(u, 'rol', e.target.value)} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)' }}>
                    {ROLES.map((r) => <option key={r}>{r}</option>)}
                  </select>
                </td>
                <td>
                  <select value={u.estado} onChange={(e) => cambiar(u, 'estado', e.target.value)} className={`badge ${badge(u.estado)}`} style={{ border: 'none', padding: '4px 8px', borderRadius: 6 }}>
                    <option value="activo">activo</option><option value="pendiente">pendiente</option><option value="suspendido">suspendido</option>
                  </select>
                </td>
                <td className="muted">{u.cliente || '—'}</td>
                <td className="muted" style={{ fontSize: 13 }}>{u.ultimo_login ? fmtFecha(u.ultimo_login) : 'Nunca'}</td>
                <td>
                  {u.estado === 'pendiente' && (
                    <button className="btn btn-sm btn-outline" onClick={() => reenviar(u)}>Reenviar activación</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {modal && (
        <div className="modal-bg" onClick={(e) => e.target.className === 'modal-bg' && setModal(null)}>
          <div className="modal">
            <h2 style={{ marginTop: 0 }}>Nuevo usuario</h2>
            <p className="muted">Se envía un enlace de activación por correo (must_reset_password). No hay auto-registro.</p>
            <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="field"><label>Nombre</label><input value={modal.nombre} onChange={(e) => setModal({ ...modal, nombre: e.target.value })} /></div>
              <div className="field"><label>Email</label><input value={modal.email} onChange={(e) => setModal({ ...modal, email: e.target.value })} /></div>
              <div className="field"><label>Rol</label><select value={modal.rol} onChange={(e) => setModal({ ...modal, rol: e.target.value })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setModal(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={crear}>Crear y enviar</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.err ? 'err' : ''}`} style={toast.persist ? { maxWidth: 500, wordBreak: 'break-all', cursor: 'pointer' } : {}} onClick={() => toast.persist && setToast(null)}>{toast.msg}</div>}
    </div>
  );
}
