import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Icon } from '../components/icons.jsx';

// ============================================================
// Campañas de cobro: importar la lista, mandar el link de pago y ver
// quién pagó. El acceso lo entrega el backend solo al confirmarse el
// pago — desde acá no se entrega nada a mano salvo el reenvío de una
// clave que ya se emitió.
//
// LA PANTALLA GIRA EN TORNO A LA VISTA PREVIA. La lista real que motivó
// esto es una base de contactos de ferias: 6 pestañas, tres SIN fila de
// títulos, y hasta tres columnas de correo por fila. El backend propone
// qué columna es cuál, pero la última palabra la tiene quien mira —
// importar 7.000 filas con las columnas corridas es mucho más caro de
// deshacer que de revisar.
// ============================================================

const CAMPOS = [
  { k: 'email', label: 'Correo', obligatorio: true },
  { k: 'empresa', label: 'Empresa' },
  { k: 'contacto', label: 'Contacto' },
  { k: 'rut', label: 'RUT' },
  { k: 'monto', label: 'Monto' },
];

const ESTADOS = {
  pendiente: { label: 'Sin enviar', badge: 'badge-gray' },
  enviado: { label: 'Link enviado', badge: 'badge-amber' },
  pagado: { label: 'Pagado · falta la clave', badge: 'badge-amber' },
  entregado: { label: 'Pagado y entregado', badge: 'badge-green' },
  anulado: { label: 'Anulado', badge: 'badge-red' },
};

const clp = (n) => `$ ${Number(n || 0).toLocaleString('es-CL')}`;
const fecha = (s) => (s ? new Date(s).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }) : '—');

export default function Cobros() {
  const [campanas, setCampanas] = useState([]);
  const [pasarela, setPasarela] = useState('manual');
  const [envio, setEnvio] = useState({ ok: true });
  const [sel, setSel] = useState(null);
  const [msg, setMsg] = useState(null);
  const [nueva, setNueva] = useState(null);

  const flash = (t, malo = false) => { setMsg({ t, malo }); setTimeout(() => setMsg(null), 6000); };

  async function cargar() {
    try {
      const r = await api.campanasCobro();
      setCampanas(r.campanas);
      setPasarela(r.pasarela);
      setEnvio(r.envio);
    } catch (e) { flash(e.message, true); }
  }
  useEffect(() => { cargar(); }, []);

  async function crear(e) {
    e.preventDefault();
    try {
      const r = await api.crearCampanaCobro({
        nombre: nueva.nombre,
        descripcion: nueva.descripcion,
        monto_clp: Number(nueva.monto_clp),
        creditos: Number(nueva.creditos),
      });
      setNueva(null);
      await cargar();
      setSel(r.campana);
      flash('Campaña creada. Ahora sube la lista de destinatarios.');
    } catch (e2) { flash(e2.message, true); }
  }

  if (sel) {
    return <Detalle campana={sel} volver={() => { setSel(null); cargar(); }} flash={flash} msg={msg} envio={envio} />;
  }

  return (
    <div>
      <div className="admin-head">
        <h1>Cobros y campañas</h1>
        <button className="btn btn-primary" onClick={() => setNueva({ nombre: '', descripcion: '', monto_clp: 49000, creditos: 20 })}>
          + Nueva campaña
        </button>
      </div>

      {msg && <div className={`alert ${msg.malo ? 'alert-error' : 'alert-ok'}`} style={{ marginBottom: 16 }}>{msg.t}</div>}

      {/* Estado de la pasarela. Se muestra siempre: sin esto, un admin
          manda 500 correos y recién en el primer reclamo descubre que el
          link no lleva a ninguna parte. */}
      <div className="card" style={{ marginBottom: 20, padding: '14px 16px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <Icon.Tag size={18} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>Forma de pago: {pasarela === 'flow' ? 'Flow (pasarela en línea)' : 'Transferencia bancaria'}</b>
            <div className="muted" style={{ fontSize: 13 }}>
              {pasarela === 'flow'
                ? 'El comprador paga en línea y el acceso se entrega solo, sin que nadie confirme nada.'
                : 'El correo lleva los datos de la cuenta. Cuando llegue la transferencia, confírmala acá y el acceso sale automáticamente.'}
            </div>
          </div>
        </div>
        {!envio.ok && (
          <div className="alert alert-error" style={{ marginTop: 12, marginBottom: 0 }}>{envio.error}</div>
        )}
      </div>

      {nueva && (
        <form className="card" style={{ marginBottom: 20, padding: 16 }} onSubmit={crear}>
          <b>Nueva campaña</b>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, marginTop: 12 }}>
            <label>Nombre
              <input value={nueva.nombre} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })}
                placeholder="Acceso 2026 — rubro minero" required />
            </label>
            <label>Precio (CLP)
              <input type="number" min="1" value={nueva.monto_clp}
                onChange={(e) => setNueva({ ...nueva, monto_clp: e.target.value })} required />
            </label>
            <label>Documentos incluidos
              <input type="number" min="1" max="1000" value={nueva.creditos}
                onChange={(e) => setNueva({ ...nueva, creditos: e.target.value })} required />
            </label>
          </div>
          <label style={{ display: 'block', marginTop: 12 }}>Descripción (opcional, se ve en la página de pago)
            <input value={nueva.descripcion} onChange={(e) => setNueva({ ...nueva, descripcion: e.target.value })} />
          </label>
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-primary" type="submit">Crear campaña</button>{' '}
            <button className="btn btn-ghost" type="button" onClick={() => setNueva(null)}>Cancelar</button>
          </div>
        </form>
      )}

      <div className="card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Campaña</th><th>Precio</th><th>Incluye</th>
                <th>Sin enviar</th><th>Enviados</th><th>Pagados</th><th>Recaudado</th><th></th>
              </tr>
            </thead>
            <tbody>
              {campanas.map((k) => (
                <tr key={k.id}>
                  <td>
                    <b>{k.nombre}</b>
                    {!k.activa && <span className="badge badge-gray" style={{ marginLeft: 6 }}>pausada</span>}
                    <div className="muted" style={{ fontSize: 12 }}>{k.total} destinatario{k.total === 1 ? '' : 's'}</div>
                  </td>
                  <td>{clp(k.monto_clp)}</td>
                  <td>{k.creditos} doc.</td>
                  <td>{k.pendientes}</td>
                  <td>{k.enviados}</td>
                  <td>
                    {k.entregados}
                    {k.pagados_sin_entregar > 0 && (
                      <span className="badge badge-red" style={{ marginLeft: 6 }}>
                        {k.pagados_sin_entregar} sin clave
                      </span>
                    )}
                  </td>
                  <td><b>{clp(k.recaudado_clp)}</b></td>
                  <td><button className="btn btn-outline btn-sm" onClick={() => setSel(k)}>Abrir</button></td>
                </tr>
              ))}
              {!campanas.length && (
                <tr><td colSpan="8" className="muted" style={{ textAlign: 'center', padding: 24 }}>
                  Todavía no hay campañas. Crea una y sube tu planilla de contactos.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------- detalle de una campaña ----------

function Detalle({ campana, volver, flash, msg, envio }) {
  const [previa, setPrevia] = useState(null);
  const [archivo, setArchivo] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [cobros, setCobros] = useState([]);
  const [filtro, setFiltro] = useState('');
  const [k, setK] = useState(campana);

  async function cargarCobros() {
    try { setCobros((await api.cobrosDeCampana(k.id, filtro)).cobros); }
    catch (e) { flash(e.message, true); }
  }
  useEffect(() => { cargarCobros(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filtro, k.id]);

  async function refrescarCampana() {
    const r = await api.campanasCobro();
    const actual = r.campanas.find((c) => c.id === k.id);
    if (actual) setK(actual);
  }

  async function previsualizar(opciones = {}) {
    if (!archivo) return;
    setCargando(true);
    try {
      setPrevia(await api.previsualizarCobros(k.id, { archivo, ...opciones }));
    } catch (e) { flash(e.message, true); setPrevia(null); }
    finally { setCargando(false); }
  }

  async function importar() {
    setCargando(true);
    try {
      const r = await api.importarCobros(k.id, {
        archivo, hoja: previa.hoja, mapeo: previa.mapeo, desde: previa.desde,
      });
      flash(`Importados ${r.insertados}. Ya estaban ${r.ya_estaban}. Sin correo válido: ${r.omitidos}.`);
      setPrevia(null); setArchivo(null);
      await Promise.all([cargarCobros(), refrescarCampana()]);
    } catch (e) { flash(e.message, true); }
    finally { setCargando(false); }
  }

  async function enviarTanda() {
    setCargando(true);
    try {
      const r = await api.enviarTandaCobros(k.id);
      flash(`Enviados ${r.enviados}. Fallaron ${r.fallidos.length}. Dados de baja ${r.dados_de_baja}. Quedan ${r.quedan_pendientes} pendientes.`);
      await Promise.all([cargarCobros(), refrescarCampana()]);
    } catch (e) { flash(e.message, true); }
    finally { setCargando(false); }
  }

  async function confirmarPago(c) {
    const ref = prompt(`Confirmar el pago de ${c.empresa || c.email} por ${clp(c.monto_clp)}.\n\nNúmero de operación o comprobante (opcional):`);
    if (ref === null) return;
    try {
      const r = await api.marcarCobroPagado(c.id, ref);
      flash(r.ya_estaba
        ? 'Este pago ya estaba registrado; no se emitió otro código.'
        : `Pago registrado. Código ${r.codigo} ${r.correo_ok ? 'enviado por correo.' : '— OJO: el correo falló, reenvíalo.'}`,
      !r.ya_estaba && !r.correo_ok);
      await Promise.all([cargarCobros(), refrescarCampana()]);
    } catch (e) { flash(e.message, true); }
  }

  async function reenviar(c) {
    try {
      const r = await api.reenviarCredenciales(c.id);
      flash(r.ok ? 'Clave reenviada.' : `No se pudo enviar: ${r.error}`, !r.ok);
    } catch (e) { flash(e.message, true); }
  }

  return (
    <div>
      <div className="admin-head">
        <div>
          <button className="btn btn-ghost btn-sm" onClick={volver}>← Campañas</button>
          <h1 style={{ marginTop: 6 }}>{k.nombre}</h1>
          <div className="muted">{clp(k.monto_clp)} · {k.creditos} documentos · {k.total} destinatarios</div>
        </div>
        <button className="btn btn-primary" disabled={cargando || !k.pendientes || !envio.ok} onClick={enviarTanda}>
          Enviar tanda ({k.pendientes} pendientes)
        </button>
      </div>

      {msg && <div className={`alert ${msg.malo ? 'alert-error' : 'alert-ok'}`} style={{ marginBottom: 16 }}>{msg.t}</div>}

      {/* ---------- importar ---------- */}
      <div className="card" style={{ marginBottom: 20, padding: 16 }}>
        <b>Subir la lista de destinatarios</b>
        <div className="muted" style={{ fontSize: 13, margin: '4px 0 12px' }}>
          Excel (.xlsx) o CSV. Primero se muestra qué se entendió; nada se guarda hasta que lo confirmes.
        </div>
        <input type="file" accept=".xlsx,.csv,.tsv,.txt"
          onChange={(e) => { setArchivo(e.target.files[0] || null); setPrevia(null); }} />
        {archivo && !previa && (
          <button className="btn btn-outline" style={{ marginLeft: 10 }} disabled={cargando} onClick={() => previsualizar()}>
            {cargando ? 'Leyendo…' : 'Ver qué contiene'}
          </button>
        )}

        {previa && (
          <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            {previa.hojas.length > 1 && (
              <label style={{ display: 'block', marginBottom: 12 }}>Hoja del libro
                <select value={previa.hoja} onChange={(e) => previsualizar({ hoja: e.target.value })}>
                  {previa.hojas.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            )}

            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
              <span><b>{previa.filas.toLocaleString('es-CL')}</b> filas</span>
              <span className="badge badge-green">{previa.resumen.admitidos.toLocaleString('es-CL')} con correo</span>
              {previa.resumen.duplicados > 0 && (
                <span className="badge badge-gray">{previa.resumen.duplicados} repetidos en la planilla</span>
              )}
              {previa.resumen.omitidos > 0 && (
                <span className="badge badge-amber">{previa.resumen.omitidos} sin correo</span>
              )}
              <span className="muted" style={{ fontSize: 13 }}>
                {previa.encabezado ? 'La fila 1 son títulos.' : 'La fila 1 ya es un dato: no hay encabezados.'}
              </span>
            </div>

            {/* Selector de columnas. Es el corazón de la pantalla: la
                propuesta del backend es solo eso, una propuesta. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10 }}>
              {CAMPOS.map((campo) => (
                <label key={campo.k} style={{ fontSize: 13 }}>
                  {campo.label}{campo.obligatorio && <span style={{ color: '#b91c1c' }}> *</span>}
                  <select
                    value={previa.mapeo[campo.k] ?? ''}
                    onChange={(e) => {
                      const v = e.target.value === '' ? undefined : Number(e.target.value);
                      const mapeo = { ...previa.mapeo };
                      if (v === undefined) delete mapeo[campo.k]; else mapeo[campo.k] = v;
                      previsualizar({ hoja: previa.hoja, mapeo, desde: previa.desde });
                    }}
                  >
                    <option value="">— sin usar —</option>
                    {previa.columnas.map((c, i) => <option key={i} value={i}>{c}</option>)}
                  </select>
                </label>
              ))}
            </div>

            {previa.ejemplos.length > 0 && (
              <div className="table-scroll" style={{ marginTop: 14 }}>
                <table>
                  <thead><tr><th>Fila</th><th>Empresa</th><th>Contacto</th><th>Correo</th><th>RUT</th><th>Monto</th></tr></thead>
                  <tbody>
                    {previa.ejemplos.map((d) => (
                      <tr key={d.fila}>
                        <td className="muted">{d.fila}</td>
                        <td>{d.empresa || <span className="muted">—</span>}</td>
                        <td>{d.contacto || <span className="muted">—</span>}</td>
                        <td>{d.email}</td>
                        <td>{d.rut || <span className="muted">—</span>}</td>
                        <td>{clp(d.monto_clp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {previa.omitidos.length > 0 && (
              <details style={{ marginTop: 12 }}>
                <summary className="muted" style={{ fontSize: 13, cursor: 'pointer' }}>
                  Ver las primeras {previa.omitidos.length} filas descartadas
                </summary>
                <ul className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                  {previa.omitidos.map((o) => (
                    <li key={o.fila}>Fila {o.fila}: {o.motivo}{o.dato ? ` — ${o.dato}` : ''}</li>
                  ))}
                </ul>
              </details>
            )}

            <div style={{ marginTop: 14 }}>
              <button className="btn btn-primary" disabled={cargando || previa.mapeo.email == null} onClick={importar}>
                {cargando ? 'Importando…' : `Importar ${previa.resumen.admitidos.toLocaleString('es-CL')} destinatarios`}
              </button>{' '}
              <button className="btn btn-ghost" onClick={() => { setPrevia(null); setArchivo(null); }}>Cancelar</button>
              {previa.mapeo.email == null && (
                <div className="muted" style={{ fontSize: 12, marginTop: 6, color: '#b91c1c' }}>
                  Elige qué columna tiene el correo.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ---------- destinatarios ---------- */}
      <div className="card">
        <div style={{ padding: '14px 16px 0', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <b>Destinatarios</b>
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(ESTADOS).map(([v, e]) => <option key={v} value={v}>{e.label}</option>)}
          </select>
          <span className="muted" style={{ fontSize: 12 }}>se muestran hasta 500</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Empresa</th><th>Correo</th><th>Monto</th><th>Estado</th><th>Clave entregada</th><th>Enviado</th><th></th></tr>
            </thead>
            <tbody>
              {cobros.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.empresa || <span className="muted">—</span>}
                    {c.contacto && <div className="muted" style={{ fontSize: 12 }}>{c.contacto}</div>}
                  </td>
                  <td style={{ fontSize: 13 }}>{c.email}</td>
                  <td>{clp(c.monto_clp)}</td>
                  <td>
                    <span className={`badge ${ESTADOS[c.estado]?.badge || 'badge-gray'}`}>
                      {ESTADOS[c.estado]?.label || c.estado}
                    </span>
                    {c.fallo_envio_clave && (
                      <div className="muted" style={{ fontSize: 11, color: '#b91c1c' }}>el correo con la clave falló</div>
                    )}
                    {c.notas && <div className="muted" style={{ fontSize: 11 }}>{c.notas}</div>}
                  </td>
                  {/* `codigo_entregado` solo viene con rol admin (ver
                      routes/cobros.js). Un operador ve que se entregó,
                      no la clave. */}
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {c.codigo_entregado || (c.tiene_codigo ? <span className="muted">entregada</span> : '—')}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>{fecha(c.enviado_at)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {['pendiente', 'enviado'].includes(c.estado) && (
                      <button className="btn btn-outline btn-sm" onClick={() => confirmarPago(c)}>Confirmar pago</button>
                    )}
                    {c.tiene_codigo && (
                      <button className="btn btn-ghost btn-sm" onClick={() => reenviar(c)}>Reenviar clave</button>
                    )}
                  </td>
                </tr>
              ))}
              {!cobros.length && (
                <tr><td colSpan="7" className="muted" style={{ textAlign: 'center', padding: 24 }}>
                  Sin destinatarios{filtro ? ' en ese estado' : ' todavía'}.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
