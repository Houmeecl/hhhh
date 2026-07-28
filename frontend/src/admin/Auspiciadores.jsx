import { useEffect, useState } from 'react';
import { api, fmtFecha } from '../api.js';

// Auspiciadores del programa Ruta sicr3p: banco, leasing, automotora u otro
// que aporta vehículo, dinero o difusión. No son clientes —no compran el
// servicio— así que viven en su propia tabla y firman sus propios
// documentos: el Convenio Marco y, si aportan vehículo, el Comodato.
const VACIO = {
  rut: '', nombre_empresa: '', contacto_email: '', aporta_vehiculo: false,
  vehiculo: { marca: '', modelo: '', patente: '', anio: '' },
  fecha_inicio: '', fecha_fin: '',
};

const ETIQUETA = { auspicio: 'Convenio marco', comodato: 'Comodato de vehículo' };

// Las tres formas de aporte que distingue el convenio marco. El orden es el
// del formulario público, para que la postulación se lea igual acá.
const APORTES = [
  ['aporta_vehiculo', 'Vehículo'],
  ['aporta_monetario', 'Aporte monetario'],
  ['aporta_difusion', 'Difusión'],
];

export default function Auspiciadores({ rol }) {
  const [lista, setLista] = useState([]);
  const [solicitudes, setSolicitudes] = useState([]);
  const [modal, setModal] = useState(null);
  const [revision, setRevision] = useState(null);
  const [toast, setToast] = useState(null);
  const esAdmin = rol === 'admin';

  const cargar = () => {
    api.auspiciadores().then((r) => setLista(r.auspiciadores)).catch((e) => flash(e.message, true));
    api.solicitudesAuspicio('pendiente').then((r) => setSolicitudes(r.solicitudes)).catch((e) => flash(e.message, true));
  };
  useEffect(() => { cargar(); }, []);
  function flash(msg, err = false) { setToast({ msg, err }); setTimeout(() => setToast(null), 4000); }

  async function guardar() {
    try {
      const r = await api.crearAuspiciador(modal.data);
      setModal(null); cargar();
      flash(`Auspiciador guardado. ${r.contratos.length} contrato(s) en borrador: ${r.contratos.map((c) => c.numero).join(', ')}.`);
    } catch (e) { flash(e.message, true); }
  }

  // Aceptar una postulación crea el auspiciador y sus contratos de una vez
  // —lo hace el backend en una sola transacción—, así que acá solo faltan
  // las fechas de vigencia: son lo único que se negocia y que el formulario
  // público no pregunta.
  async function aceptar() {
    try {
      const { fecha_inicio, fecha_fin } = revision;
      const r = await api.aceptarAuspicio(revision.sol.id, { fecha_inicio: fecha_inicio || null, fecha_fin: fecha_fin || null });
      setRevision(null); cargar();
      flash(`${r.auspiciador.nombre_empresa} aceptado. ${r.contratos.length} contrato(s) en borrador: ${r.contratos.map((c) => c.numero).join(', ')}.`);
    } catch (e) { flash(e.message, true); }
  }

  async function rechazar() {
    try {
      await api.rechazarAuspicio(revision.sol.id, revision.motivo);
      setRevision(null); cargar();
      flash('Postulación rechazada.');
    } catch (e) { flash(e.message, true); }
  }

  // El comodato puede faltar si el vehículo se acordó después del alta.
  async function emitirFaltante(a, tipo) {
    try {
      const r = await api.emitirContratoAuspicio(a.id, tipo);
      flash(`${ETIQUETA[tipo]} ${r.contrato.numero} generado en borrador.`); cargar();
    } catch (e) { flash(e.message, true); }
  }

  const tiene = (a, tipo) => (a.contratos || []).some((c) => c.tipo === tipo);

  return (
    <div>
      <div className="admin-head">
        <h1>Auspiciadores</h1>
        {esAdmin && <button className="btn btn-primary" onClick={() => setModal({ data: { ...VACIO, vehiculo: { ...VACIO.vehiculo } } })}>+ Nuevo auspiciador</button>}
      </div>

      {solicitudes.length > 0 && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="card-pad" style={{ paddingBottom: 4 }}>
            <h2 style={{ margin: 0 }}>Postulaciones pendientes <span className="badge badge-amber">{solicitudes.length}</span></h2>
            <p className="muted" style={{ marginBottom: 0 }}>
              Llegaron desde el formulario público. Aceptar una crea el auspiciador y emite sus
              contratos en borrador; recibirla no la aprueba.
            </p>
          </div>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr><th>Empresa</th><th>Contacto</th><th>Ofrece aportar</th><th>Ciudades</th><th>Recibida</th><th></th></tr>
              </thead>
              <tbody>
                {solicitudes.map((s) => (
                  <tr key={s.id}>
                    <td><b>{s.nombre_empresa}</b><div className="muted" style={{ fontSize: 13 }}>{s.rut}</div></td>
                    <td>
                      {s.contacto_nombre || <span className="muted">Sin nombre</span>}
                      <div className="muted" style={{ fontSize: 13 }}>{s.contacto_email}{s.contacto_telefono ? ` · ${s.contacto_telefono}` : ''}</div>
                    </td>
                    <td>
                      {APORTES.filter(([k]) => s[k]).map(([k, etiqueta]) => <div key={k}>{etiqueta}</div>)}
                      {s.aporta_vehiculo && (
                        <div className="muted" style={{ fontSize: 13 }}>
                          {[s.vehiculo?.marca, s.vehiculo?.modelo, s.vehiculo?.patente, s.vehiculo?.anio].filter(Boolean).join(' · ') || 'sin detalle'}
                        </div>
                      )}
                    </td>
                    <td className="muted" style={{ fontSize: 13, maxWidth: 200 }}>{s.ciudades || '—'}</td>
                    <td className="muted" style={{ fontSize: 13 }}>{fmtFecha(s.created_at)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setRevision({ modo: 'ver', sol: s })}>Ver</button>
                      {esAdmin && <>
                        <button className="btn btn-ghost btn-sm" onClick={() => setRevision({ modo: 'aceptar', sol: s, fecha_inicio: '', fecha_fin: '' })}>Aceptar</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setRevision({ modo: 'rechazar', sol: s, motivo: '' })}>Rechazar</button>
                      </>}
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
            <thead>
              <tr><th>Auspiciador</th><th>RUT</th><th>Aporte</th><th>Vigencia</th><th>Contratos</th></tr>
            </thead>
            <tbody>
              {lista.map((a) => (
                <tr key={a.id}>
                  <td><b>{a.nombre_empresa}</b><div className="muted" style={{ fontSize: 13 }}>{a.contacto_email || '—'}</div></td>
                  <td>{a.rut}</td>
                  <td>{a.aporta_vehiculo
                    ? <>Vehículo <span className="muted">{[a.vehiculo?.marca, a.vehiculo?.modelo, a.vehiculo?.patente].filter(Boolean).join(' · ') || 'sin detalle'}</span></>
                    : <span className="muted">Sin vehículo</span>}</td>
                  <td className="muted" style={{ fontSize: 13 }}>{fmtFecha(a.fecha_inicio)} → {fmtFecha(a.fecha_fin)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {['auspicio', 'comodato'].map((tipo) => (
                      tiene(a, tipo)
                        ? <button key={tipo} className="btn btn-ghost btn-sm" onClick={() => api.abrirContratoAuspicioPdf(a.id, tipo).catch((e) => flash(e.message, true))}>{ETIQUETA[tipo]}</button>
                        : (esAdmin && (tipo === 'auspicio' || a.aporta_vehiculo)
                            ? <button key={tipo} className="btn btn-ghost btn-sm muted" onClick={() => emitirFaltante(a, tipo)}>+ {ETIQUETA[tipo]}</button>
                            : null)
                    ))}
                  </td>
                </tr>
              ))}
              {lista.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 30 }}>Sin auspiciadores aún.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div className="modal-bg" onClick={(e) => e.target.className === 'modal-bg' && setModal(null)}>
          <div className="modal">
            <h2 style={{ marginTop: 0 }}>Nuevo auspiciador</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Al guardar se emite el <b>Convenio Marco</b> y, si aporta vehículo, además el <b>Comodato</b>.
              Ambos salen en <b>borrador</b>: la plantilla tiene puntos pendientes de revisión legal.
            </p>
            <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="field"><label>RUT</label><input value={modal.data.rut} onChange={(e) => setModal({ ...modal, data: { ...modal.data, rut: e.target.value } })} /></div>
              <div className="field"><label>Empresa</label><input value={modal.data.nombre_empresa} onChange={(e) => setModal({ ...modal, data: { ...modal.data, nombre_empresa: e.target.value } })} /></div>
              <div className="field"><label>Email de contacto</label><input value={modal.data.contacto_email} onChange={(e) => setModal({ ...modal, data: { ...modal.data, contacto_email: e.target.value } })} /></div>
              <div className="field"><label>Aporta vehículo</label>
                <select value={modal.data.aporta_vehiculo ? 'si' : 'no'} onChange={(e) => setModal({ ...modal, data: { ...modal.data, aporta_vehiculo: e.target.value === 'si' } })}>
                  <option value="no">No</option><option value="si">Sí</option>
                </select>
              </div>
              <div className="field"><label>Inicio</label><input type="date" value={modal.data.fecha_inicio} onChange={(e) => setModal({ ...modal, data: { ...modal.data, fecha_inicio: e.target.value } })} /></div>
              <div className="field"><label>Fin</label><input type="date" value={modal.data.fecha_fin} onChange={(e) => setModal({ ...modal, data: { ...modal.data, fecha_fin: e.target.value } })} /></div>
            </div>
            {modal.data.aporta_vehiculo && (
              <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr' }}>
                {['marca', 'modelo', 'patente', 'anio'].map((k) => (
                  <div className="field" key={k}>
                    <label>{k === 'anio' ? 'Año' : k[0].toUpperCase() + k.slice(1)}</label>
                    <input value={modal.data.vehiculo[k]} onChange={(e) => setModal({ ...modal, data: { ...modal.data, vehiculo: { ...modal.data.vehiculo, [k]: e.target.value } } })} />
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setModal(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardar}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {revision && (
        <div className="modal-bg" onClick={(e) => e.target.className === 'modal-bg' && setRevision(null)}>
          <div className="modal">
            <h2 style={{ marginTop: 0 }}>{revision.sol.nombre_empresa}</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              {revision.sol.rut} · {revision.sol.contacto_email}
              {revision.sol.contacto_telefono ? ` · ${revision.sol.contacto_telefono}` : ''}
            </p>

            <div className="result-box" style={{ marginBottom: 16 }}>
              <div><b>Ofrece aportar:</b> {APORTES.filter(([k]) => revision.sol[k]).map(([, e]) => e).join(', ')}</div>
              {revision.sol.aporta_vehiculo && (
                <div className="muted" style={{ fontSize: 13 }}>
                  Vehículo: {[revision.sol.vehiculo?.marca, revision.sol.vehiculo?.modelo, revision.sol.vehiculo?.patente, revision.sol.vehiculo?.anio].filter(Boolean).join(' · ') || 'sin detalle'}
                </div>
              )}
              {revision.sol.ciudades && <div style={{ marginTop: 8 }}><b>Ciudades:</b> {revision.sol.ciudades}</div>}
              {revision.sol.mensaje && <div style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{revision.sol.mensaje}</div>}
            </div>

            {revision.modo === 'aceptar' && <>
              <p className="muted" style={{ marginTop: 0 }}>
                Al aceptar se crea el auspiciador y se emite el <b>Convenio Marco</b>
                {revision.sol.aporta_vehiculo ? <> y el <b>Comodato</b></> : null}, en <b>borrador</b>:
                la plantilla tiene puntos pendientes de revisión legal. La vigencia es lo único que el
                formulario público no pregunta.
              </p>
              <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="field"><label>Inicio</label><input type="date" value={revision.fecha_inicio} onChange={(e) => setRevision({ ...revision, fecha_inicio: e.target.value })} /></div>
                <div className="field"><label>Fin</label><input type="date" value={revision.fecha_fin} onChange={(e) => setRevision({ ...revision, fecha_fin: e.target.value })} /></div>
              </div>
            </>}

            {revision.modo === 'rechazar' && (
              <div className="field">
                <label>Motivo (queda en el registro, no se le envía)</label>
                <textarea rows={3} value={revision.motivo} onChange={(e) => setRevision({ ...revision, motivo: e.target.value })} />
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setRevision(null)}>{revision.modo === 'ver' ? 'Cerrar' : 'Cancelar'}</button>
              {revision.modo === 'aceptar' && <button className="btn btn-primary" onClick={aceptar}>Aceptar y emitir contratos</button>}
              {revision.modo === 'rechazar' && <button className="btn btn-primary" onClick={rechazar}>Rechazar</button>}
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.err ? 'toast-err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}
