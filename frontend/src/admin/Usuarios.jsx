import { useEffect, useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { api, fmtFecha } from '../api.js';
import PasswordUnaVez from '../components/PasswordUnaVez.jsx';
import { SECCIONES_ADMIN_NAV } from './secciones.js';

// Checkboxes de secciones del panel (migración 092), agrupados igual que
// el propio sidebar que se está configurando. Dashboard va siempre
// marcado y deshabilitado: toda cuenta necesita un landing tras el login.
function SelectorSecciones({ valor, onChange }) {
  const set = new Set(valor || []);
  const toggle = (slug) => {
    const s = new Set(set);
    if (s.has(slug)) s.delete(slug); else s.add(slug);
    s.add('dashboard');
    onChange([...s]);
  };
  const marcarGrupo = (grupo, marcar) => {
    const s = new Set(set);
    for (const item of grupo.items) { if (marcar) s.add(item.slug); else if (!item.siempre) s.delete(item.slug); }
    s.add('dashboard');
    onChange([...s]);
  };
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {SECCIONES_ADMIN_NAV.map((grupo) => (
        <div key={grupo.titulo} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <b style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--gray)' }}>{grupo.titulo}</b>
            <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => marcarGrupo(grupo, true)}>todas</button>
            <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => marcarGrupo(grupo, false)}>ninguna</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 4 }}>
            {grupo.items.map((item) => (
              <label key={item.slug} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, fontWeight: 400, cursor: item.siempre ? 'default' : 'pointer' }}>
                <input
                  type="checkbox"
                  checked={item.siempre || set.has(item.slug)}
                  disabled={item.siempre}
                  onChange={() => toggle(item.slug)}
                />
                {item.label}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const ROLES = ['admin', 'operador', 'cliente'];
// Paneles internos: el alta es directa y el rol se elige. Los 5 paneles
// externos también se dan de alta desde acá (pantalla única de cuentas),
// pero exigen elegir la entidad (puerto/mandante/…) y su rol es fijo
// 'operador' — lo que varía es nivel_acceso (lectura | operador).
const PANELES_INTERNOS = ['sicrep', 'aduana_verde'];
const PANEL_LABEL = {
  sicrep: 'sicrep', aduana_verde: 'sicr3p (terreno)',
  puerto: 'Puerto', mandante: 'Mandante', agencia: 'Agencia', trazador: 'Trazador', proveedor: 'Proveedor',
};
const PANELES_EXTERNOS = [
  { valor: 'puerto', lista: (d) => d.puertos, cargar: () => api.puertos(), nombre: (e) => e.nombre },
  { valor: 'mandante', lista: (d) => d.mandantes, cargar: () => api.mandantes(), nombre: (e) => e.nombre_empresa },
  { valor: 'agencia', lista: (d) => d.agencias, cargar: () => api.agencias(), nombre: (e) => e.nombre },
  { valor: 'trazador', lista: (d) => d.trazadores, cargar: () => api.accesosTrazadores(), nombre: (e) => e.nombre },
  { valor: 'proveedor', lista: (d) => d.proveedores, cargar: () => api.accesosProveedores(), nombre: (e) => e.nombre_empresa },
];
const TODOS_PANELES = [...PANELES_INTERNOS, ...PANELES_EXTERNOS.map((p) => p.valor)];

export default function Usuarios({ yo }) {
  const [usuarios, setUsuarios] = useState([]);
  const [modal, setModal] = useState(null);
  const [filtroPanel, setFiltroPanel] = useState('');
  // Entidades del panel externo elegido en el modal de alta: null mientras cargan.
  const [entidadesModal, setEntidadesModal] = useState(null);
  const [toast, setToast] = useState(null);
  // Contraseña temporal a mostrar una sola vez (creación o "generar nueva").
  // Distinto del `toast`: esto no se autocierra, porque el valor no vuelve
  // a estar disponible una vez cerrado.
  const [pwdResultado, setPwdResultado] = useState(null);
  // Llaves USB de huella (WebAuthn/FIDO2) de un usuario, más las llaves
  // de archivo (ver migración 068): { usuario, llaves, llavesArchivo }.
  const [llavesModal, setLlavesModal] = useState(null);
  const [nombreLlaveNueva, setNombreLlaveNueva] = useState('');
  const [registrandoLlave, setRegistrandoLlave] = useState(false);
  const [nombreArchivoNueva, setNombreArchivoNueva] = useState('');
  const [emitiendoArchivo, setEmitiendoArchivo] = useState(false);
  // PIN de una llave de archivo recién emitida — se muestra UNA sola vez,
  // igual que la contraseña temporal (no se autocierra ni se puede recuperar).
  const [pinResultado, setPinResultado] = useState(null); // {serial, pin}
  // Editor de secciones del panel de una cuenta sicrep: {usuario, valor}.
  const [seccionesModal, setSeccionesModal] = useState(null);

  const cargar = () => api.usuarios().then((r) => setUsuarios(r.usuarios)).catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);
  function flash(msg, err = false, persist = false) { setToast({ msg, err, persist }); if (!persist) setTimeout(() => setToast(null), 3500); }

  const cfgExterno = modal ? PANELES_EXTERNOS.find((p) => p.valor === modal.panel) : null;

  useEffect(() => {
    setEntidadesModal(null);
    if (!cfgExterno) return;
    let vigente = true;
    cfgExterno.cargar()
      .then((d) => { if (vigente) setEntidadesModal((cfgExterno.lista(d) || []).filter((e) => e.activo !== false)); })
      .catch((e) => { if (vigente) { setEntidadesModal([]); flash(e.message, true); } });
    return () => { vigente = false; };
  }, [modal?.panel]);

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

  // Orden con lógica en vez del orden de creación: agrupado por panel
  // (sicrep → terreno → externos, mismo orden que el selector) y dentro
  // de cada panel por jerarquía (superadmin → admin → operador → cliente)
  // y nombre. Así "¿quiénes pueden entrar a X?" se responde de un vistazo.
  const RANGO_ROL = { admin: 0, operador: 1, cliente: 2 };
  const visibles = usuarios.filter((u) => !filtroPanel || (u.panel || 'sicrep') === filtroPanel);
  const grupos = TODOS_PANELES
    .map((panel) => ({
      panel,
      usuarios: visibles
        .filter((u) => (u.panel || 'sicrep') === panel)
        .sort((a, b) =>
          (b.es_superadmin === true) - (a.es_superadmin === true)
          || (RANGO_ROL[a.rol] ?? 9) - (RANGO_ROL[b.rol] ?? 9)
          || String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es')),
    }))
    .filter((g) => g.usuarios.length > 0);

  // ---------- Llaves USB de huella (WebAuthn/FIDO2) ----------
  async function abrirLlaves(u) {
    setNombreLlaveNueva(''); setNombreArchivoNueva('');
    try {
      const [r, ra] = await Promise.all([api.llavesUsb(u.id), api.llavesArchivo(u.id)]);
      setLlavesModal({ usuario: u, llaves: r.llaves, llavesArchivo: ra.llaves });
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

  // ---------- Llaves de archivo (.sicr3p-llave en un pendrive) ----------
  // El archivo Y el PIN viajan en claro UNA sola vez, acá: el archivo se
  // descarga de inmediato y el PIN se muestra en pantalla, igual que una
  // contraseña temporal.
  async function emitirLlaveArchivo() {
    if (!llavesModal) return;
    setEmitiendoArchivo(true);
    try {
      const r = await api.emitirLlaveArchivo(llavesModal.usuario.id, nombreArchivoNueva.trim() || null);
      const blob = new Blob([JSON.stringify(r.archivo, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `sicr3p-llave-${r.archivo.serial}.sicr3p-llave`;
      a.click();
      URL.revokeObjectURL(url);
      setPinResultado({ serial: r.archivo.serial, pin: r.pin });
      setNombreArchivoNueva('');
      await abrirLlaves(llavesModal.usuario);
      cargar();
    } catch (e) { flash(e.message, true); }
    finally { setEmitiendoArchivo(false); }
  }

  async function revocarLlaveArchivo(credencialId) {
    if (!llavesModal) return;
    if (!confirm('¿Revocar esta llave de archivo? No se puede reactivar; habría que emitir una nueva.')) return;
    try {
      await api.revocarLlaveArchivo(llavesModal.usuario.id, credencialId);
      flash('Llave revocada.');
      await abrirLlaves(llavesModal.usuario);
      cargar();
    } catch (e) { flash(e.message, true); }
  }

  const estadoLlaveArchivo = (l) => {
    if (!l.activo) return 'revocada';
    if (l.bloqueado_hasta && new Date(l.bloqueado_hasta) > new Date()) return 'bloqueada';
    return 'activa';
  };

  return (
    <div>
      <div className="admin-head">
        <h1>Usuarios y roles</h1>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <select value={filtroPanel} onChange={(e) => setFiltroPanel(e.target.value)} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)' }}>
            <option value="">Todos los paneles</option>
            {TODOS_PANELES.map((p) => <option key={p} value={p}>{PANEL_LABEL[p]}</option>)}
          </select>
          <button className="btn btn-primary" onClick={() => setModal({ email: '', nombre: '', rol: 'operador', panel: 'sicrep', entidad_id: '', nivel_acceso: 'operador', secciones_admin: ['dashboard'] })}>+ Nuevo usuario</button>
        </div>
      </div>

      <div className="card">
        <div className="table-scroll">
        <table className="data">
          <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Panel</th><th>Nivel</th><th>Estado</th><th>Cliente</th><th>Último acceso</th><th>Llaves</th><th></th></tr></thead>
          <tbody>
            {grupos.map((g) => [
              <tr key={`sec-${g.panel}`}>
                <td colSpan={10} style={{ background: 'var(--bg)', fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#64748b', padding: '8px 12px' }}>
                  {PANEL_LABEL[g.panel]} · {g.usuarios.length} cuenta{g.usuarios.length === 1 ? '' : 's'}
                </td>
              </tr>,
              ...g.usuarios.map((u) => {
              const esInterno = PANELES_INTERNOS.includes(u.panel || 'sicrep');
              return (
              <tr key={u.id}>
                <td>
                  <b>{u.nombre}</b>
                  {u.es_superadmin && <span className="badge badge-amber" style={{ marginLeft: 6 }}>superadmin</span>}
                  {/* Solo otro superadmin puede otorgar/quitar la marca, y solo
                      sobre una cuenta admin de sicrep (CHECK migración 069). */}
                  {yo?.es_superadmin && u.panel === 'sicrep' && u.rol === 'admin' && u.id !== yo.id && (
                    <button className="btn btn-sm btn-outline" style={{ marginLeft: 6, fontSize: 11, padding: '2px 6px' }}
                      onClick={() => cambiar(u, 'es_superadmin', !u.es_superadmin)}>
                      {u.es_superadmin ? 'Quitar superadmin' : 'Hacer superadmin'}
                    </button>
                  )}
                </td>
                <td className="muted">{u.email}</td>
                <td>
                  {esInterno ? (
                    <select value={u.rol} onChange={(e) => cambiar(u, 'rol', e.target.value)} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)' }}>
                      {ROLES.map((r) => <option key={r}>{r}</option>)}
                    </select>
                  ) : <span className="muted">{u.rol}</span>}
                </td>
                <td>
                  {/* Cuentas externas: el panel está atado a su entidad (FK +
                      CHECK en la BD) — no se cambia desde acá. */}
                  {esInterno ? (
                    <select value={u.panel || 'sicrep'} onChange={(e) => cambiar(u, 'panel', e.target.value)} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)' }}>
                      {PANELES_INTERNOS.map((p) => <option key={p} value={p}>{PANEL_LABEL[p]}</option>)}
                    </select>
                  ) : <span className="muted">{PANEL_LABEL[u.panel] || u.panel}</span>}
                </td>
                <td>
                  {/* Solo se ofrece en los paneles externos: ahí hay
                      mutaciones que requireNivelOperador restringe de
                      verdad. En sicrep/terreno lo que manda es el rol, y
                      un selector aquí prometería un límite inexistente. */}
                  {esInterno ? (
                    <span className="muted" title="En este panel el permiso lo define el rol">—</span>
                  ) : (
                    <select value={u.nivel_acceso || 'operador'} onChange={(e) => cambiar(u, 'nivel_acceso', e.target.value)} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)' }}>
                      <option value="operador">operador</option>
                      <option value="lectura">solo lectura</option>
                    </select>
                  )}
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
                    {(() => {
                      const total = Number(u.num_llaves_usb || 0) + Number(u.num_llaves_archivo || 0);
                      return total > 0 ? `${total} registrada${total > 1 ? 's' : ''}` : 'Registrar';
                    })()}
                  </button>
                </td>
                <td>
                  {/* Ya no hay estado "pendiente" atascado esperando un correo:
                      el alta deja la cuenta activa de inmediato con
                      must_reset_password=true. Este botón sirve igual como
                      recuperación general (el correo de reset tampoco es
                      confiable), así que no se limita por estado. */}
                  <button className="btn btn-sm btn-outline" onClick={() => reenviar(u)}>Generar contraseña nueva</button>
                  {(u.panel || 'sicrep') === 'sicrep' && !u.es_superadmin && (
                    <button className="btn btn-sm btn-outline" style={{ marginLeft: 6 }}
                      onClick={() => setSeccionesModal({ usuario: u, valor: u.secciones_admin || [] })}>
                      Secciones ({(u.secciones_admin || []).length})
                    </button>
                  )}
                </td>
              </tr>
              );
              }),
            ])}
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
              <div className="field"><label>Panel</label>
                {/* Al cambiar de panel, el nivel parte en el default lógico:
                    consulta (puerto/mandante/trazador) → solo lectura;
                    agencia y proveedor → operador, porque su función central
                    escribe (capturar expediente / operar sus propios datos).
                    El admin puede cambiarlo. */}
                <select value={modal.panel} onChange={(e) => setModal({
                  ...modal, panel: e.target.value, entidad_id: '',
                  nivel_acceso: ['proveedor', 'agencia', ...PANELES_INTERNOS].includes(e.target.value) ? 'operador' : 'lectura',
                })}>
                  {TODOS_PANELES.map((p) => <option key={p} value={p}>{PANEL_LABEL[p]}</option>)}
                </select>
              </div>
              {cfgExterno ? (
                <div className="field"><label>Entidad ({PANEL_LABEL[modal.panel]})</label>
                  <select value={modal.entidad_id} onChange={(e) => setModal({ ...modal, entidad_id: e.target.value })}>
                    <option value="">{entidadesModal ? (entidadesModal.length ? 'Elegir…' : 'Sin entidades activas') : 'Cargando…'}</option>
                    {(entidadesModal || []).map((e) => <option key={e.id} value={e.id}>{cfgExterno.nombre(e)}</option>)}
                  </select>
                </div>
              ) : (
                <div className="field"><label>Rol</label><select value={modal.rol} onChange={(e) => setModal({ ...modal, rol: e.target.value })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></div>
              )}
              {/* Igual que en la tabla: el nivel de acceso solo tiene efecto
                  real en los paneles externos. */}
              {cfgExterno && (
                <div className="field"><label>Nivel de acceso</label>
                  <select value={modal.nivel_acceso} onChange={(e) => setModal({ ...modal, nivel_acceso: e.target.value })}>
                    <option value="lectura">solo lectura</option>
                    <option value="operador">operador (puede escribir)</option>
                  </select>
                  {!['proveedor', 'agencia'].includes(modal.panel) && modal.nivel_acceso === 'lectura' && (
                    <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
                      Los paneles de consulta parten en solo lectura; sube a operador solo si esta cuenta debe escribir.
                    </p>
                  )}
                </div>
              )}
            </div>
            {cfgExterno && (
              <p className="muted" style={{ fontSize: 13 }}>
                La cuenta queda atada a la entidad elegida y solo ve SUS datos, con rol fijo de operador
                del panel. Las entidades se crean en «Accesos externos».
              </p>
            )}
            {/* Secciones del panel (solo sicrep): qué partes del panel verá
                esta cuenta. Sin marcar nada, solo ve el Dashboard. */}
            {modal.panel === 'sicrep' && (
              <div className="field" style={{ marginTop: 8 }}>
                <label>Secciones del panel que esta cuenta puede ver</label>
                <SelectorSecciones valor={modal.secciones_admin} onChange={(v) => setModal({ ...modal, secciones_admin: v })} />
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn btn-outline" onClick={() => setModal(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={crear} disabled={cfgExterno && !modal.entidad_id}>Crear usuario</button>
            </div>
          </div>
        </div>
      )}

      {seccionesModal && (
        <div className="modal-bg" onClick={(e) => e.target.className === 'modal-bg' && setSeccionesModal(null)}>
          <div className="modal" style={{ maxWidth: 560 }}>
            <h2 style={{ marginTop: 0 }}>Secciones de {seccionesModal.usuario.nombre}</h2>
            <p className="muted" style={{ fontSize: 13 }}>
              Qué partes del panel ve y usa esta cuenta. El cambio se aplica al guardar; la sesión
              activa de la persona lo toma en su próximo inicio de sesión o refresco de token.
            </p>
            <SelectorSecciones valor={seccionesModal.valor} onChange={(v) => setSeccionesModal({ ...seccionesModal, valor: v })} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="btn btn-outline" onClick={() => setSeccionesModal(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={async () => {
                await cambiar(seccionesModal.usuario, 'secciones_admin', seccionesModal.valor);
                setSeccionesModal(null);
              }}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {llavesModal && (
        <div className="modal-bg" onClick={(e) => e.target.className === 'modal-bg' && setLlavesModal(null)}>
          <div className="modal" style={{ maxWidth: 480 }}>
            <h2 style={{ marginTop: 0 }}>Llaves FIDO2 de {llavesModal.usuario.nombre}</h2>
            <p className="muted" style={{ fontSize: 13 }}>
              Login sin contraseña con una llave FIDO2 con sensor biométrico (YubiKey Bio,
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

            <hr style={{ margin: '22px 0', border: 'none', borderTop: '1px solid var(--border)' }} />

            <h2 style={{ marginTop: 0 }}>Llaves de archivo</h2>
            <p className="muted" style={{ fontSize: 13 }}>
              Un archivo <code>.sicr3p-llave</code> guardado en un pendrive común, más un PIN. Es más
              simple de repartir que una llave USB — y por eso <b>menos segura</b>: cualquiera que
              copie el archivo Y conozca el PIN puede entrar. Revócala si el pendrive se pierde. Para
              cambiar el PIN no hay edición: revoca y emite una nueva.
            </p>

            {llavesModal.llavesArchivo.length > 0 && (
              <table className="data" style={{ marginBottom: 16 }}>
                <thead><tr><th>Nombre</th><th>Serial</th><th>Emitida</th><th>Último uso</th><th>Estado</th><th></th></tr></thead>
                <tbody>
                  {llavesModal.llavesArchivo.map((l) => (
                    <tr key={l.id}>
                      <td>{l.nombre || '—'}</td>
                      <td className="muted" style={{ fontSize: 13 }}>{l.serial}</td>
                      <td className="muted" style={{ fontSize: 13 }}>{fmtFecha(l.created_at)}</td>
                      <td className="muted" style={{ fontSize: 13 }}>{l.last_used_at ? fmtFecha(l.last_used_at) : 'Nunca'}</td>
                      <td><span className={`badge ${estadoLlaveArchivo(l) === 'activa' ? 'badge-green' : estadoLlaveArchivo(l) === 'bloqueada' ? 'badge-amber' : 'badge-red'}`}>{estadoLlaveArchivo(l)}</span></td>
                      <td>{l.activo && <button className="btn btn-sm btn-outline" onClick={() => revocarLlaveArchivo(l.id)}>Revocar</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="field" style={{ marginBottom: 14 }}>
              <label>Nombre de la llave nueva (opcional)</label>
              <input
                value={nombreArchivoNueva}
                onChange={(e) => setNombreArchivoNueva(e.target.value)}
                placeholder="USB azul de oficina"
              />
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={emitirLlaveArchivo} disabled={emitiendoArchivo}>
                {emitiendoArchivo ? <span className="spinner" /> : 'Emitir y descargar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {pinResultado && (
        <div className="modal-bg" onClick={(e) => e.target.className === 'modal-bg' && setPinResultado(null)}>
          <div className="modal" style={{ maxWidth: 440 }}>
            <h2 style={{ marginTop: 0 }}>PIN de la llave {pinResultado.serial}</h2>
            <p className="muted" style={{ fontSize: 13 }}>El archivo ya se descargó.</p>
            <PasswordUnaVez
              password={pinResultado.pin}
              mensaje="Copia este PIN ahora — no volverá a mostrarse. Entrégalo por un canal distinto al del archivo (no los guardes juntos)."
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <button className="btn btn-outline" onClick={() => setPinResultado(null)}>Cerrar</button>
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
