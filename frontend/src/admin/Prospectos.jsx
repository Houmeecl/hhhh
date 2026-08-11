import { useEffect, useState } from 'react';
import { api, fmt, fmtFecha } from '../api.js';
import { Icon } from '../components/icons.jsx';

const ETAPAS = ['nuevo', 'contactado', 'demo', 'piloto', 'ganado', 'perdido'];
const VACIO = { nombre_empresa: '', rut: '', contacto: '', etapa: 'nuevo', origen: '', notas: '', proxima_accion: '' };

// Etiqueta visible del origen de un interesado (catálogo de la migración 091).
const ORIGEN_LABEL = {
  calculadora: 'Calculadora', corredor: 'Corredor', instituto: 'Instituto',
  prueba: 'Códigos de prueba', magic_sin_historial: 'Acceso sin historial', otro: 'Sitio web',
};

// Próxima acción vencida = fecha de hoy o anterior en un prospecto que
// sigue vivo (ni ganado ni perdido). Antes el campo era decorativo: nada
// lo destacaba al vencer y el seguimiento dependía de la memoria.
const accionVencida = (p) =>
  p.proxima_accion && !['ganado', 'perdido'].includes(p.etapa)
  && new Date(p.proxima_accion) <= new Date();

export default function Prospectos() {
  const [items, setItems] = useState([]);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const flash = (msg, err = false) => { setToast({ msg, err }); setTimeout(() => setToast(null), 3500); };

  const [inscripciones, setInscripciones] = useState([]);
  const [interesados, setInteresados] = useState([]);

  const cargar = () => {
    api.prospectos().then((r) => setItems(r.prospectos)).catch((e) => flash(e.message, true));
    api.solicitudesInscripcion('pendiente').then((r) => setInscripciones(r.solicitudes)).catch(() => {});
    api.interesados().then((r) => setInteresados(r.interesados)).catch(() => {});
  };
  useEffect(() => { cargar(); }, []);

  async function marcarInteresado(i, estado) {
    try { await api.estadoInteresado(i.id, estado); cargar(); }
    catch (e) { flash(e.message, true); }
  }

  async function convertir(id) {
    try { await api.convertirInscripcion(id); cargar(); flash('Inscripción convertida en prospecto.'); }
    catch (e) { flash(e.message, true); }
  }
  async function descartar(id) {
    if (!confirm('¿Descartar esta inscripción?')) return;
    try { await api.descartarInscripcion(id); cargar(); flash('Inscripción descartada.'); }
    catch (e) { flash(e.message, true); }
  }
  async function enrolar(id) {
    try {
      const r = await api.enrolarInscripcion(id);
      cargar();
      if (r.tenia_cuenta) flash(`Empresa enrolada — ya tenía acceso web, no se reenvió invitación.`);
      else if (r.correo_enviado === false) flash('Empresa enrolada; el correo no pudo enviarse — comparte el enlace de respaldo desde Enrolar empresa.', true);
      else flash('Empresa enrolada e invitación enviada por correo.');
    } catch (e) { flash(e.message, true); }
  }

  async function guardar() {
    try {
      if (modal.id) await api.editarProspecto(modal.id, modal);
      else await api.crearProspecto(modal);
      setModal(null); cargar(); flash('Prospecto guardado.');
    } catch (e) { flash(e.message, true); }
  }
  async function mover(p, etapa) {
    try { await api.editarProspecto(p.id, { ...p, etapa }); cargar(); }
    catch (e) { flash(e.message, true); }
  }
  async function eliminar(id) {
    if (!confirm('¿Eliminar prospecto?')) return;
    try { await api.eliminarProspecto(id); cargar(); flash('Prospecto eliminado.'); }
    catch (e) { flash(e.message, true); }
  }

  const badge = (e) => e === 'ganado' ? 'badge-green' : e === 'perdido' ? 'badge-red' : e === 'piloto' || e === 'demo' ? 'badge-amber' : 'badge-gray';

  return (
    <div>
      <div className="admin-head">
        <h1>Prospectos</h1>
        <button className="btn btn-primary" onClick={() => setModal({ ...VACIO })}>+ Nuevo prospecto</button>
      </div>

      {/* Pipeline por columnas — se desplaza horizontal en pantallas angostas en vez de apretar las columnas */}
      <div style={{ overflowX: 'auto', marginBottom: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${ETAPAS.length}, minmax(140px, 1fr))`, gap: 10, minWidth: 720 }}>
        {ETAPAS.map((et) => (
          <div key={et} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 10, minHeight: 120 }}>
            <div style={{ fontWeight: 700, fontSize: 12, textTransform: 'uppercase', color: 'var(--gray)', marginBottom: 8 }}>{et} · {items.filter((p) => p.etapa === et).length}</div>
            {items.filter((p) => p.etapa === et).map((p) => (
              <div key={p.id} style={{ background: 'var(--bg)', borderRadius: 8, padding: 8, marginBottom: 6, fontSize: 13 }}>
                <div style={{ fontWeight: 600 }}>{p.nombre_empresa}</div>
                <div className="muted" style={{ fontSize: 11 }}>{p.contacto || '—'}</div>
                {p.proxima_accion && (
                  <div className="muted" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, ...(accionVencida(p) ? { color: '#b91c1c', fontWeight: 700 } : {}) }}>
                    <Icon.Calendar size={12} /> {fmtFecha(p.proxima_accion)}{accionVencida(p) ? ' · vencida' : ''}
                  </div>
                )}
                <div style={{ marginTop: 4 }}>
                  <span style={{ cursor: 'pointer', fontSize: 11 }} onClick={() => setModal({ ...p, proxima_accion: p.proxima_accion?.slice(0,10) || '' })}>editar</span>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      </div>

      {/* Inscripciones recibidas desde el formulario público /inscripcion.
          Convertir crea el prospecto en el pipeline de arriba; nada se
          crea solo. */}
      {inscripciones.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ padding: '14px 16px 0' }}>
            <b>Inscripciones recibidas</b>
            <span className="muted" style={{ fontSize: 13 }}> · formulario público /inscripcion · {inscripciones.length} pendiente{inscripciones.length === 1 ? '' : 's'}</span>
          </div>
          <div className="table-scroll">
          <table className="data">
            <thead><tr><th>Empresa</th><th>Contacto</th><th>Interés</th><th>Mensaje</th><th>Recibida</th><th></th></tr></thead>
            <tbody>
              {inscripciones.map((s) => (
                <tr key={s.id}>
                  <td><b>{s.nombre_empresa}</b><div className="muted" style={{ fontSize: 12 }}>{s.rut}</div></td>
                  <td>
                    {s.contacto_nombre}{s.contacto_cargo ? ` · ${s.contacto_cargo}` : ''}
                    <div className="muted" style={{ fontSize: 12 }}>{s.contacto_email}{s.contacto_telefono ? ` · ${s.contacto_telefono}` : ''}</div>
                  </td>
                  <td className="muted" style={{ fontSize: 13 }}>{(Array.isArray(s.intereses) ? s.intereses : []).join(', ')}</td>
                  <td className="muted" style={{ fontSize: 13, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.mensaje || ''}>{s.mensaje || '—'}</td>
                  <td>{fmtFecha(s.created_at)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-primary btn-sm" onClick={() => enrolar(s.id)}>Enrolar y enviar invitación</button>{' '}
                    <button className="btn btn-outline btn-sm" onClick={() => convertir(s.id)}>Solo convertir en prospecto</button>{' '}
                    <button className="btn btn-ghost btn-sm" style={{ color: '#b91c1c' }} onClick={() => descartar(s.id)}>Descartar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Interesados livianos capturados en el sitio (formularios cortos de
          las landings + calculadora de la portada) — sin RUT: el equipo los
          contacta y decide si pasan al pipeline. */}
      {interesados.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ padding: '14px 16px 0' }}>
            <b>Interesados del sitio</b>
            <span className="muted" style={{ fontSize: 13 }}> · formularios de las landings y la calculadora · {interesados.filter((i) => i.estado === 'nuevo').length} nuevo{interesados.filter((i) => i.estado === 'nuevo').length === 1 ? '' : 's'}</span>
          </div>
          <div className="table-scroll">
          <table className="data">
            <thead><tr><th>Origen</th><th>Contacto</th><th>Mensaje / estimación</th><th>Recibido</th><th>Estado</th></tr></thead>
            <tbody>
              {interesados.map((i) => (
                <tr key={i.id} style={i.estado === 'descartado' ? { opacity: 0.55 } : {}}>
                  <td><span className="badge badge-gray">{ORIGEN_LABEL[i.origen] || i.origen}</span></td>
                  <td>
                    {i.nombre || <span className="muted">—</span>}{i.empresa ? ` · ${i.empresa}` : ''}
                    <div className="muted" style={{ fontSize: 12 }}>{i.email}{i.telefono ? ` · ${i.telefono}` : ''}</div>
                  </td>
                  <td className="muted" style={{ fontSize: 13, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={i.mensaje || ''}>
                    {i.estimacion?.total_t != null
                      ? <span className="badge badge-green">≈ {fmt(i.estimacion.total_t, 2)} t CO2e</span>
                      : (i.mensaje || '—')}
                  </td>
                  <td>{fmtFecha(i.created_at)}</td>
                  <td>
                    <select className="badge" value={i.estado} onChange={(e) => marcarInteresado(i, e.target.value)} style={{ border: 'none', background: 'var(--bg)', padding: '4px 8px', borderRadius: 6 }}>
                      {['nuevo', 'contactado', 'descartado'].map((e) => <option key={e} value={e}>{e}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      <div className="card">
        <div className="table-scroll">
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
                <td style={accionVencida(p) ? { color: '#b91c1c', fontWeight: 700 } : {}}>
                  {fmtFecha(p.proxima_accion)}{accionVencida(p) && <span className="badge badge-red" style={{ marginLeft: 6 }}>vencida</span>}
                </td>
                <td><button className="btn btn-ghost btn-sm" style={{ color: '#b91c1c' }} onClick={() => eliminar(p.id)}>Eliminar</button></td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 30 }}>Sin prospectos.</td></tr>}
          </tbody>
        </table>
        </div>
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

      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}
