import { useEffect, useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { api, fmtFecha } from '../api.js';
import PasswordUnaVez from '../components/PasswordUnaVez.jsx';

const ROLES = ['admin', 'operador', 'cliente'];
const PANELES = ['sicrep', 'aduana_verde'];
const PANEL_LABEL = { sicrep: 'sicrep', aduana_verde: 'sicr3p (terreno)' };

export default function Usuarios() {
  const [usuarios, setUsuarios] = useState([]);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  // Contraseña temporal a mostrar una sola vez (creación o "generar nueva").
  // Distinto del `toast`: esto no se autocierra, porque el valor no vuelve
  // a estar disponible una vez cerrado.
  const [pwdResultado, setPwdResultado] = useState(null);
  // Llaves USB de huella (WebAuthn/FIDO2) de un usuario: { usuario, llaves }.
  const [llavesModal, setLlavesModal] = useState(null);
  const [nombreLlaveNueva, setNombreLlaveNueva] = useState('');
  const [registrandoLlave, setRegistrandoLlave] = useState(false);

  const cargar = () => api.usuarios().then((r) => setUsuarios(r.usuarios)).catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);
  function flash(msg, err = false, persist = false) { setToast({ msg, err, persist }); if (!persist) setTimeout(() => setToast(null), 3500); }

  async function crear() {
    try {
      const r = await api.crearUsuario(modal);
      setModal(null); cargar();
      if (r.password) {
        setPwdResultado({ titulo: 'Usuario creado', password: r.password });
      } else if (r.dev_activation_link) {
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
      if (r.password) {
        setPwdResultado({ titulo: `Contraseña nueva para ${u.nombre}`, password: r.password });
        cargar();
      } else if (r.dev_activation_link) {
        const motivo = r.correo_enviado === false ? 'No se pudo enviar el correo. Comparte este link a mano' : 'Link activación (dev)';
        flash(`${motivo}: ${r.dev_activation_link}`, r.correo_enviado === false, true);
      } else flash('Reenviamos el correo de activación.');
    } catch (e) { flash(e.message, true); }
  }

  const badge = (e) => e === 'activo' ? 'badge-green' : e === 'pendiente' ? 'badge-amber' : 'badge-red';

  // ---------- Llaves USB de huella (WebAuthn/FIDO2) ----------
  async function abrirLlaves(u) {
    setNombreLlaveNueva('');
    try {
      const r = await api.llavesUsb(u.id);
      setLlavesModal({ usuario: u, llaves: r.llaves });
    } catch (e) { flash(e.message, true); }
  }

  // La huella se valida DENTRO de la llave física: este panel nunca la
  // recibe, solo una firma que confirma "esta llave, que ya conocemos,
  // verificó a su dueño" (ver routes/webauthn.js).
  async function registrarLlave() {
    if (!llavesModal) return;
    setRegistrandoLlave(true);
    try {
      const opciones = await api.webauthnRegistroOpciones(llavesModal.usuario.id);
      const respuesta = await startRegistration({ optionsJSON: opciones });
      await api.webauthnRegistroVerificar(llavesModal.usuario.id, respuesta, nombreLlaveNueva.trim() || null);
      flash('Llave registrada.');
      await abrirLlaves(llavesModal.usuario);
      cargar();
    } catch (e) {
      flash(e.name === 'NotAllowedError' ? 'No se detectó la llave o se canceló la operación.' : e.message, true);
    } finally {
      setRegistrandoLlave(false);
    }
  }

  async function eliminarLlave(credencialId) {
    if (!llavesModal) return;
    try {
      await api.webauthnEliminar(llavesModal.usuario.id, credencialId);
      flash('Llave eliminada.');
      await abrirLlaves(llavesModal.usuario);
      cargar();
    } catch (e) { flash(e.message, true); }
  }

  return (
    <div>
      <div className="admin-head">
        <h1>Usuarios y roles</h1>
        <button className="btn btn-primary" onClick={() => setModal({ email: '', nombre: '', rol: 'operador', panel: 'sicrep' })}>+ Nuevo usuario</button>
      </div>

      <div className="card">
        <div className="table-scroll">
        <table className="data">
          <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Panel</th><th>Estado</th><th>Cliente</th><th>Último acceso</th><th>Llave USB</th><th></th></tr></thead>
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
                  <select value={u.panel || 'sicrep'} onChange={(e) => cambiar(u, 'panel', e.target.value)} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)' }}>
                    {PANELES.map((p) => <option key={p} value={p}>{PANEL_LABEL[p]}</option>)}
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
                  <button className="btn btn-sm btn-outline" onClick={() => abrirLlaves(u)}>
                    {Number(u.num_llaves_usb) > 0 ? `${u.num_llaves_usb} registrada${u.num_llaves_usb > 1 ? 's' : ''}` : 'Registrar'}
                  </button>
                </td>
                <td>
                  {/* Ya no hay estado "pendiente" atascado esperando un correo:
                      el alta deja la cuenta activa de inmediato con
                      must_reset_password=true. Este botón sirve igual como
                      recuperación general (el correo de reset tampoco es
                      confiable), así que no se limita por estado. */}
                  <button className="btn btn-sm btn-outline" onClick={() => reenviar(u)}>Generar contraseña nueva</button>
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
            <p className="muted">Se genera una contraseña temporal que se muestra una sola vez al crear la cuenta. No hay auto-registro; la persona debe cambiarla en su primer inicio de sesión.</p>
            <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="field"><label>Nombre</label><input value={modal.nombre} onChange={(e) => setModal({ ...modal, nombre: e.target.value })} /></div>
              <div className="field"><label>Email</label><input value={modal.email} onChange={(e) => setModal({ ...modal, email: e.target.value })} /></div>
              <div className="field"><label>Rol</label><select value={modal.rol} onChange={(e) => setModal({ ...modal, rol: e.target.value })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></div>
              <div className="field"><label>Panel</label><select value={modal.panel} onChange={(e) => setModal({ ...modal, panel: e.target.value })}>{PANELES.map((p) => <option key={p} value={p}>{PANEL_LABEL[p]}</option>)}</select></div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setModal(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={crear}>Crear usuario</button>
            </div>
          </div>
        </div>
      )}

      {llavesModal && (
        <div className="modal-bg" onClick={(e) => e.target.className === 'modal-bg' && setLlavesModal(null)}>
          <div className="modal" style={{ maxWidth: 480 }}>
            <h2 style={{ marginTop: 0 }}>Llaves USB de {llavesModal.usuario.nombre}</h2>
            <p className="muted" style={{ fontSize: 13 }}>
              Login sin contraseña con una llave USB FIDO2 con sensor biométrico (YubiKey Bio,
              Kensington VeriMark, Feitian BioPass). La verificación se hace dentro de la llave: este
              panel nunca la recibe, solo una firma que confirma que su dueño la tocó.
            </p>

            {llavesModal.llaves.length > 0 && (
              <table className="data" style={{ marginBottom: 16 }}>
                <thead><tr><th>Nombre</th><th>Registrada</th><th>Último uso</th><th></th></tr></thead>
                <tbody>
                  {llavesModal.llaves.map((l) => (
                    <tr key={l.id}>
                      <td>{l.nombre_dispositivo || '—'}</td>
                      <td className="muted" style={{ fontSize: 13 }}>{fmtFecha(l.created_at)}</td>
                      <td className="muted" style={{ fontSize: 13 }}>{l.last_used_at ? fmtFecha(l.last_used_at) : 'Nunca'}</td>
                      <td><button className="btn btn-sm btn-outline" onClick={() => eliminarLlave(l.id)}>Eliminar</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="field" style={{ marginBottom: 14 }}>
              <label>Nombre de la llave nueva (opcional)</label>
              <input
                value={nombreLlaveNueva}
                onChange={(e) => setNombreLlaveNueva(e.target.value)}
                placeholder={`YubiKey de ${llavesModal.usuario.nombre}`}
              />
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setLlavesModal(null)}>Cerrar</button>
              <button className="btn btn-primary" onClick={registrarLlave} disabled={registrandoLlave}>
                {registrandoLlave ? <span className="spinner" /> : 'Conectar y registrar llave'}
              </button>
            </div>
          </div>
        </div>
      )}

      {pwdResultado && (
        <div className="modal-bg" onClick={(e) => e.target.className === 'modal-bg' && setPwdResultado(null)}>
          <div className="modal" style={{ maxWidth: 440 }}>
            <h2 style={{ marginTop: 0 }}>{pwdResultado.titulo}</h2>
            <PasswordUnaVez password={pwdResultado.password} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <button className="btn btn-outline" onClick={() => setPwdResultado(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.err ? 'err' : ''}`} style={toast.persist ? { maxWidth: 500, wordBreak: 'break-all', cursor: 'pointer' } : {}} onClick={() => toast.persist && setToast(null)}>{toast.msg}</div>}
    </div>
  );
}
