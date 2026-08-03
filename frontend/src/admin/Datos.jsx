import { useEffect, useState } from 'react';
import { api, fmtFecha } from '../api.js';

// Protección de datos personales (Ley 21.719): la bandeja de derechos del
// titular y la política de retención.
//
// Lo importante de esta pantalla es que al resolver una supresión muestra
// qué queda retenido y por qué ANTES de confirmar, para que la respuesta
// al titular salga del sistema y no de la memoria de quien atiende.

function Solicitudes({ rol, flash }) {
  const [datos, setDatos] = useState(null);
  const [modal, setModal] = useState(null);
  const esAdmin = rol === 'admin';

  const cargar = () => api.solicitudesArcop().then(setDatos).catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);

  async function abrir(sol) {
    setModal({ sol, resolucion: '', estado: 'resuelta', datos: null, limites: null, cargando: true });
    try {
      // Para acceso y portabilidad se trae lo que hay del titular; para
      // supresión, los límites. Son las dos cosas que hay que tener a la
      // vista para poder responder.
      const [paquete, limites] = await Promise.all([
        ['acceso', 'portabilidad'].includes(sol.derecho) ? api.datosArcop(sol.id) : Promise.resolve(null),
        sol.derecho === 'supresion' ? api.limitesSupresion() : Promise.resolve(null),
      ]);
      setModal((m) => (m && m.sol.id === sol.id ? { ...m, datos: paquete, limites, cargando: false } : m));
    } catch (e) {
      flash(e.message, true);
      setModal((m) => (m ? { ...m, cargando: false } : m));
    }
  }

  async function resolver() {
    try {
      await api.resolverArcop(modal.sol.id, { estado: modal.estado, resolucion: modal.resolucion });
      setModal(null); cargar();
      flash('Solicitud resuelta. Queda registrada la respuesta.');
    } catch (e) { flash(e.message, true); }
  }

  function descargar() {
    const blob = new Blob([JSON.stringify(modal.datos, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `datos-${modal.sol.rut || modal.sol.email}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!datos) return <div className="card card-pad muted"><span className="spinner dark" /> Cargando…</div>;
  const pendientes = datos.solicitudes.filter((s) => s.estado === 'pendiente');

  return (
    <>
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-pad" style={{ paddingBottom: 4 }}>
          <h2 style={{ margin: 0 }}>
            Derechos del titular {pendientes.length > 0 && <span className="badge badge-amber">{pendientes.length}</span>}
          </h2>
          <p className="muted" style={{ marginBottom: 0 }}>
            Acceso, rectificación, supresión, oposición y portabilidad. El plazo de
            respuesta es de {datos.plazo_dias} días; las más antiguas van primero.
          </p>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr><th>Derecho</th><th>Titular</th><th>Recibida</th><th>Estado</th><th></th></tr>
            </thead>
            <tbody>
              {datos.solicitudes.map((s) => (
                <tr key={s.id}>
                  <td><b>{(datos.derechos[s.derecho] || s.derecho).split('—')[0].trim()}</b></td>
                  <td>
                    {s.nombre || <span className="muted">Sin nombre</span>}
                    <div className="muted" style={{ fontSize: 13 }}>{[s.rut, s.email].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td className="muted" style={{ fontSize: 13 }}>
                    {fmtFecha(s.created_at)}
                    {s.estado === 'pendiente' && (
                      <div className={s.fuera_de_plazo ? 'badge badge-red' : 'muted'} style={{ fontSize: 12 }}>
                        {s.dias_esperando} día(s){s.fuera_de_plazo ? ' — fuera de plazo' : ''}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${s.estado === 'pendiente' ? 'badge-amber' : s.estado === 'resuelta' ? 'badge-green' : 'badge-gray'}`}>
                      {s.estado}
                    </span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {s.estado === 'pendiente' && esAdmin
                      ? <button className="btn btn-ghost btn-sm" onClick={() => abrir(s)}>Atender</button>
                      : <span className="muted" style={{ fontSize: 13 }}>{s.resuelta_por_nombre || ''}</span>}
                  </td>
                </tr>
              ))}
              {datos.solicitudes.length === 0 && (
                <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 30 }}>Sin solicitudes.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div className="modal-bg" onClick={(e) => e.target.className === 'modal-bg' && setModal(null)}>
          <div className="modal" style={{ maxWidth: 720 }}>
            <h2 style={{ marginTop: 0 }}>{datos.derechos[modal.sol.derecho] || modal.sol.derecho}</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              {[modal.sol.nombre, modal.sol.rut, modal.sol.email].filter(Boolean).join(' · ')}
            </p>
            {modal.sol.detalle && (
              <div className="result-box" style={{ marginBottom: 16, whiteSpace: 'pre-wrap' }}>{modal.sol.detalle}</div>
            )}

            {modal.cargando && <p className="muted"><span className="spinner dark" /> Buscando…</p>}

            {modal.datos && (
              <div className="result-box" style={{ marginBottom: 16 }}>
                <b>{modal.datos.total_registros} registro(s)</b> en {modal.datos.secciones.length} tabla(s).
                {modal.datos.nota && <div className="muted" style={{ fontSize: 13 }}>{modal.datos.nota}</div>}
                <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13 }}>
                  {modal.datos.secciones.map((s) => (
                    <li key={s.tabla}>
                      <b>{s.tabla}</b> — {s.registros.length} · <span className="muted">{s.finalidad}</span>
                    </li>
                  ))}
                </ul>
                {modal.datos.total_registros > 0 && (
                  <button className="btn btn-outline btn-sm" style={{ marginTop: 10 }} onClick={descargar}>
                    Descargar para entregárselo
                  </button>
                )}
              </div>
            )}

            {modal.limites && (
              <div className="result-box" style={{ marginBottom: 16 }}>
                <b>Qué se puede eliminar y qué no</b>
                <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>{modal.limites.explicacion}</p>
                <div style={{ fontSize: 13 }}>
                  <div><b>Se elimina o anonimiza:</b> {modal.limites.borrable.join(', ')}</div>
                  <div style={{ marginTop: 6 }}><b>Queda retenido:</b></div>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {modal.limites.retenido.map((r) => (
                      <li key={r.tabla}><b>{r.tabla}</b> — <span className="muted">{r.motivo}</span></li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <div className="field">
              <label>Qué se le respondió al titular *</label>
              <textarea
                rows={4} value={modal.resolucion}
                onChange={(e) => setModal({ ...modal, resolucion: e.target.value })}
                placeholder="Queda en el registro como prueba de que la solicitud se atendió."
              />
            </div>
            <div className="field">
              <label>Resultado</label>
              <select value={modal.estado} onChange={(e) => setModal({ ...modal, estado: e.target.value })}>
                <option value="resuelta">Atendida</option>
                <option value="rechazada">Rechazada</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setModal(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={resolver} disabled={!modal.resolucion.trim()}>
                Registrar respuesta
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Retencion({ rol, flash }) {
  const [datos, setDatos] = useState(null);
  const [purgando, setPurgando] = useState(false);
  const esAdmin = rol === 'admin';

  const cargar = () => api.retencion().then(setDatos).catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);

  async function purgar() {
    setPurgando(true);
    try {
      const r = await api.purgarAhora();
      flash(`Purga completa: ${r.filas} fila(s).`); cargar();
    } catch (e) { flash(e.message, true); }
    finally { setPurgando(false); }
  }

  if (!datos) return null;

  return (
    <div className="card">
      <div className="card-pad" style={{ paddingBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>Retención</h2>
          <p className="muted" style={{ marginBottom: 0 }}>
            Corre sola una vez al día. {datos.nota_plazos}
          </p>
        </div>
        {esAdmin && (
          <button className="btn btn-outline btn-sm" onClick={purgar} disabled={purgando}>
            {purgando ? <span className="spinner dark" /> : 'Purgar ahora'}
          </button>
        )}
      </div>

      <div className="card-pad" style={{ paddingTop: 12 }}>
        <div className="table-scroll">
          <table className="data">
            <thead><tr><th>Dato</th><th>Qué se hace</th><th>Pasados</th></tr></thead>
            <tbody>
              {datos.tareas.map((t) => (
                <tr key={t.nombre}>
                  <td>{t.nombre}</td>
                  <td>
                    <span className={`badge ${t.accion === 'anonimizar' ? 'badge-green' : 'badge-gray'}`}>{t.accion}</span>
                  </td>
                  <td className="muted">{t.dias} días</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 style={{ marginBottom: 4 }}>Lo que no se elimina, y por qué</h3>
        <ul className="muted" style={{ fontSize: 13, marginTop: 0, paddingLeft: 18 }}>
          {datos.retenido_por_ley.map((r) => (
            <li key={r.tabla}><b>{r.tabla}</b> — {r.motivo}</li>
          ))}
        </ul>

        {datos.purgas.length > 0 && (
          <>
            <h3 style={{ marginBottom: 4 }}>Últimas purgas</h3>
            <div className="table-scroll">
              <table className="data">
                <thead><tr><th>Cuándo</th><th>Origen</th><th>Filas</th><th>Duración</th></tr></thead>
                <tbody>
                  {datos.purgas.slice(0, 10).map((p) => (
                    <tr key={p.id}>
                      <td className="muted">{fmtFecha(p.created_at)}</td>
                      <td>{p.origen}{p.usuario_email ? ` · ${p.usuario_email}` : ''}</td>
                      <td>{p.filas}</td>
                      <td className="muted">{p.duracion_ms} ms{p.error ? ' · con errores' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const RIESGO_BADGE = { alto: 'badge-red', medio: 'badge-amber', bajo: 'badge-gray', por_evaluar: 'badge-gray' };
const VACIA = { titulo: '', descripcion: '', ocurrida_at: '', datos_afectados: '', titulares_afectados: '', riesgo: 'por_evaluar' };

function Brechas({ rol, flash }) {
  const [lista, setLista] = useState(null);
  const [modal, setModal] = useState(null);
  const esAdmin = rol === 'admin';

  const cargar = () => api.brechas().then((r) => setLista(r.brechas)).catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);

  async function registrar() {
    try {
      await api.registrarBrecha(modal.data);
      setModal(null); cargar();
      flash('Brecha registrada. Anota las notificaciones a medida que ocurran.');
    } catch (e) { flash(e.message, true); }
  }

  // Marcar un aviso deja la fecha en que se hizo: en una brecha la
  // cronología es la defensa.
  async function marcar(b, campo) {
    try {
      await api.actualizarBrecha(b.id, { [campo]: new Date().toISOString() });
      cargar(); flash('Anotado.');
    } catch (e) { flash(e.message, true); }
  }

  if (!lista) return null;

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-pad" style={{ paddingBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>Brechas de seguridad</h2>
          <p className="muted" style={{ marginBottom: 0 }}>
            Se registran a mano: no hay detección automática. Lo que importa acá es la
            cronología — cuándo ocurrió, cuándo se supo y cuándo se avisó.
          </p>
        </div>
        {esAdmin && (
          <button className="btn btn-outline btn-sm" onClick={() => setModal({ data: { ...VACIA } })}>
            + Registrar
          </button>
        )}
      </div>

      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr><th>Qué pasó</th><th>Detectada</th><th>Riesgo</th><th>Avisos</th><th>Estado</th></tr>
          </thead>
          <tbody>
            {lista.map((b) => (
              <tr key={b.id}>
                <td>
                  <b>{b.titulo}</b>
                  {b.titulares_afectados != null && (
                    <div className="muted" style={{ fontSize: 13 }}>{b.titulares_afectados} titular(es)</div>
                  )}
                </td>
                <td className="muted" style={{ fontSize: 13 }}>{fmtFecha(b.detectada_at)}</td>
                <td><span className={`badge ${RIESGO_BADGE[b.riesgo]}`}>{b.riesgo.replace('_', ' ')}</span></td>
                <td style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                  <div>
                    Agencia: {b.notificada_agencia_at
                      ? <b>{fmtFecha(b.notificada_agencia_at)}</b>
                      : esAdmin
                        ? <button className="btn btn-ghost btn-sm" onClick={() => marcar(b, 'notificada_agencia_at')}>marcar</button>
                        : <span className="muted">pendiente</span>}
                  </div>
                  <div>
                    Titulares: {b.notificados_titulares_at
                      ? <b>{fmtFecha(b.notificados_titulares_at)}</b>
                      : esAdmin
                        ? <button className="btn btn-ghost btn-sm" onClick={() => marcar(b, 'notificados_titulares_at')}>marcar</button>
                        : <span className="muted">pendiente</span>}
                  </div>
                </td>
                <td><span className={`badge ${b.estado === 'cerrada' ? 'badge-green' : 'badge-amber'}`}>{b.estado}</span></td>
              </tr>
            ))}
            {lista.length === 0 && (
              <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 30 }}>
                Sin brechas registradas.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="modal-bg" onClick={(e) => e.target.className === 'modal-bg' && setModal(null)}>
          <div className="modal">
            <h2 style={{ marginTop: 0 }}>Registrar una brecha</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Describe qué categorías de datos se vieron comprometidas, no los datos mismos.
            </p>
            <div className="field"><label>Qué pasó *</label>
              <input value={modal.data.titulo} onChange={(e) => setModal({ ...modal, data: { ...modal.data, titulo: e.target.value } })} /></div>
            <div className="field"><label>Descripción *</label>
              <textarea rows={3} value={modal.data.descripcion} onChange={(e) => setModal({ ...modal, data: { ...modal.data, descripcion: e.target.value } })} /></div>
            <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="field"><label>Cuándo ocurrió</label>
                <input type="date" value={modal.data.ocurrida_at} onChange={(e) => setModal({ ...modal, data: { ...modal.data, ocurrida_at: e.target.value } })} /></div>
              <div className="field"><label>Titulares afectados</label>
                <input type="number" value={modal.data.titulares_afectados} onChange={(e) => setModal({ ...modal, data: { ...modal.data, titulares_afectados: e.target.value } })} /></div>
              <div className="field"><label>Qué datos</label>
                <input placeholder="correos de contacto, RUT…" value={modal.data.datos_afectados} onChange={(e) => setModal({ ...modal, data: { ...modal.data, datos_afectados: e.target.value } })} /></div>
              <div className="field"><label>Riesgo</label>
                <select value={modal.data.riesgo} onChange={(e) => setModal({ ...modal, data: { ...modal.data, riesgo: e.target.value } })}>
                  <option value="por_evaluar">Por evaluar</option>
                  <option value="bajo">Bajo</option><option value="medio">Medio</option><option value="alto">Alto</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setModal(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={registrar}
                disabled={!modal.data.titulo.trim() || !modal.data.descripcion.trim()}>Registrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Datos({ rol }) {
  const [toast, setToast] = useState(null);
  function flash(msg, err = false) { setToast({ msg, err }); setTimeout(() => setToast(null), 4000); }

  return (
    <div>
      <div className="admin-head"><h1>Protección de datos</h1></div>
      <Solicitudes rol={rol} flash={flash} />
      <Retencion rol={rol} flash={flash} />
      <Brechas rol={rol} flash={flash} />
      {toast && <div className={`toast ${toast.err ? 'toast-err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}
