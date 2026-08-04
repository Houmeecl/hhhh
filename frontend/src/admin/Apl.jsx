import { useEffect, useState } from 'react';
import { Icon } from '../components/icons.jsx';
import { api } from '../api.js';

// ============================================================
// APL — Acuerdos de Producción Limpia. Registro de a qué APL
// adhirió cada cliente y el avance de sus metas, con la evidencia
// que la plataforma ya puede respaldar. El módulo NO certifica
// cumplimiento (eso lo hace la auditoría del sistema APL): la copy
// de la página lo dice y el PDF lo repite.
// ============================================================

const ESTADOS_ACUERDO = {
  adherido: ['Adherido', 'badge-gray'],
  en_implementacion: ['En implementación', 'badge-blue'],
  en_auditoria: ['En auditoría', 'badge-yellow'],
  certificado: ['Certificado', 'badge-green'],
  cerrado: ['Cerrado', 'badge-gray'],
};
const ESTADOS_META = {
  pendiente: ['Pendiente', 'badge-gray'],
  en_avance: ['En avance', 'badge-blue'],
  cumplida: ['Cumplida', 'badge-green'],
  no_aplica: ['No aplica', 'badge-gray'],
};
const TIPOS_META = {
  energia: 'Energía', residuos: 'Residuos', agua: 'Agua', emisiones: 'Emisiones GEI',
  capacitacion: 'Capacitación', gestion: 'Gestión', otro: 'Otro',
};
const FUENTES = {
  informe_mensual: 'Informe mensual sicr3p',
  alcance3: 'Export Alcance 3',
  rep_declaraciones: 'Declaraciones REP',
  capacitacion: 'Constancias de cursos',
  cadena_hash: 'Cadena de integridad',
  otra: 'Otra',
};

const ACUERDO_VACIO = { cliente_id: '', nombre: '', sector: '', fecha_adhesion: '', plazo_meses: '', notas: '' };
const META_VACIA = { numero: '', descripcion: '', tipo: 'otro', fuente_evidencia: '', evidencia: '' };

function Badge({ mapa, valor }) {
  const [label, cls] = mapa[valor] || [valor, 'badge-gray'];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export default function Apl() {
  const [acuerdos, setAcuerdos] = useState(null);
  const [clientes, setClientes] = useState([]);
  const [detalle, setDetalle] = useState(null);   // respuesta de aplAcuerdo(id)
  const [nuevo, setNuevo] = useState(null);       // form de acuerdo nuevo
  const [meta, setMeta] = useState(null);         // form de meta nueva
  const [err, setErr] = useState(null);

  const cargar = () => api.aplAcuerdos().then((d) => setAcuerdos(d.acuerdos)).catch((e) => setErr(e.message));
  useEffect(() => { cargar(); api.clientes().then((d) => setClientes(d.clientes || [])).catch(() => {}); }, []);

  const abrir = (id) => { setErr(null); api.aplAcuerdo(id).then(setDetalle).catch((e) => setErr(e.message)); };

  async function guardarAcuerdo() {
    setErr(null);
    try {
      await api.crearAplAcuerdo({ ...nuevo, plazo_meses: nuevo.plazo_meses || null, fecha_adhesion: nuevo.fecha_adhesion || null });
      setNuevo(null); cargar();
    } catch (e) { setErr(e.message); }
  }

  async function guardarMeta() {
    setErr(null);
    try {
      await api.crearAplMeta(detalle.acuerdo.id, { ...meta, fuente_evidencia: meta.fuente_evidencia || null });
      setMeta(null); abrir(detalle.acuerdo.id); cargar();
    } catch (e) { setErr(e.message); }
  }

  async function cambiarEstadoMeta(m, estado) {
    setErr(null);
    try { await api.editarAplMeta(m.id, { estado }); abrir(detalle.acuerdo.id); cargar(); }
    catch (e) { setErr(e.message); }
  }

  async function cambiarEstadoAcuerdo(estado) {
    setErr(null);
    try { await api.editarAplAcuerdo(detalle.acuerdo.id, { estado }); abrir(detalle.acuerdo.id); cargar(); }
    catch (e) { setErr(e.message); }
  }

  // ---------- Detalle de un acuerdo ----------
  if (detalle) {
    const { acuerdo, metas, resumen, evidencia_disponible: ev } = detalle;
    return (
      <div>
        <button className="btn btn-outline btn-sm" onClick={() => setDetalle(null)}>← Volver a APL</button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
          <div>
            <h1 style={{ margin: 0 }}>{acuerdo.nombre}</h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {acuerdo.nombre_empresa} · {acuerdo.cliente_rut}
              {acuerdo.sector ? ` · ${acuerdo.sector}` : ''}
              {acuerdo.plazo_meses ? ` · plazo ${acuerdo.plazo_meses} meses` : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value={acuerdo.estado} onChange={(e) => cambiarEstadoAcuerdo(e.target.value)}>
              {Object.entries(ESTADOS_ACUERDO).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <button className="btn btn-outline btn-sm" onClick={() => api.abrirAplInformePdf(acuerdo.id)}>
              <Icon.Printer size={14} /> Informe PDF
            </button>
          </div>
        </div>

        {err && <div className="badge badge-red" style={{ display: 'block', padding: '10px 14px', margin: '12px 0' }}>{err}</div>}

        <div className="stat-grid" style={{ marginTop: 16 }}>
          <div className="stat-card"><div className="stat-num">{resumen.total}</div><div className="stat-label">metas registradas</div></div>
          <div className="stat-card"><div className="stat-num" style={{ color: 'var(--green)' }}>{resumen.cumplida}</div><div className="stat-label">cumplidas</div></div>
          <div className="stat-card"><div className="stat-num">{resumen.en_avance}</div><div className="stat-label">en avance</div></div>
          <div className="stat-card"><div className="stat-num">{resumen.pendiente}</div><div className="stat-label">pendientes</div></div>
        </div>

        <div className="card card-pad" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Metas y acciones</h2>
            <button className="btn btn-primary btn-sm" onClick={() => setMeta({ ...META_VACIA })}>+ Agregar meta</button>
          </div>

          {meta && (
            <div className="result-box" style={{ marginTop: 12 }}>
              <div className="form-row" style={{ gridTemplateColumns: '110px 1fr 160px' }}>
                <div className="field"><label>N°</label>
                  <input placeholder="1.1" value={meta.numero} onChange={(e) => setMeta({ ...meta, numero: e.target.value })} /></div>
                <div className="field"><label>Descripción *</label>
                  <input value={meta.descripcion} onChange={(e) => setMeta({ ...meta, descripcion: e.target.value })} /></div>
                <div className="field"><label>Tipo</label>
                  <select value={meta.tipo} onChange={(e) => setMeta({ ...meta, tipo: e.target.value })}>
                    {Object.entries(TIPOS_META).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select></div>
              </div>
              <div className="form-row" style={{ gridTemplateColumns: '220px 1fr' }}>
                <div className="field"><label>Respaldo desde la plataforma</label>
                  <select value={meta.fuente_evidencia} onChange={(e) => setMeta({ ...meta, fuente_evidencia: e.target.value })}>
                    <option value="">— sin asociar —</option>
                    {Object.entries(FUENTES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select></div>
                <div className="field"><label>Detalle de la evidencia</label>
                  <input placeholder="p. ej. informe mensual jul-2026, export Alcance 3 año 2026…"
                    value={meta.evidencia} onChange={(e) => setMeta({ ...meta, evidencia: e.target.value })} /></div>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-outline btn-sm" onClick={() => setMeta(null)}>Cancelar</button>
                <button className="btn btn-primary btn-sm" disabled={!meta.descripcion.trim()} onClick={guardarMeta}>Guardar meta</button>
              </div>
            </div>
          )}

          {metas.length === 0 && !meta && <p className="muted" style={{ marginTop: 12 }}>Sin metas todavía. Agrega las metas/acciones del acuerdo al que adhirió el cliente.</p>}
          {metas.length > 0 && (
            <div className="table-scroll" style={{ marginTop: 12 }}>
              <table className="table">
                <thead><tr><th>N°</th><th>Meta / acción</th><th>Tipo</th><th>Estado</th><th>Evidencia</th><th></th></tr></thead>
                <tbody>
                  {metas.map((m) => (
                    <tr key={m.id}>
                      <td>{m.numero || '—'}</td>
                      <td style={{ maxWidth: 340 }}>{m.descripcion}</td>
                      <td>{TIPOS_META[m.tipo] || m.tipo}</td>
                      <td>
                        <select value={m.estado} onChange={(e) => cambiarEstadoMeta(m, e.target.value)}>
                          {Object.entries(ESTADOS_META).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                      </td>
                      <td style={{ maxWidth: 220 }} className="muted">
                        {m.fuente_evidencia ? <b>{FUENTES[m.fuente_evidencia]}</b> : null}
                        {m.fuente_evidencia && m.evidencia ? ' · ' : ''}
                        {m.evidencia || (!m.fuente_evidencia ? '—' : '')}
                      </td>
                      <td>
                        <button className="btn btn-outline btn-sm" title="Eliminar meta"
                          onClick={() => {
                            if (!window.confirm('¿Eliminar esta meta del registro?')) return;
                            api.eliminarAplMeta(m.id).then(() => { abrir(acuerdo.id); cargar(); }).catch((e) => setErr(e.message));
                          }}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card card-pad" style={{ marginTop: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Evidencia disponible en la plataforma</h2>
          <p className="muted" style={{ fontSize: 13 }}>
            Lo que sicr3p ya tiene registrado para el RUT {acuerdo.cliente_rut} y puede respaldar
            documentalmente ante una auditoría del acuerdo:
          </p>
          <div className="stat-grid">
            <div className="stat-card"><div className="stat-num">{ev.documentos}</div><div className="stat-label">documentos procesados</div></div>
            <div className="stat-card"><div className="stat-num">{Number(ev.co2e_total_kg).toLocaleString('es-CL', { maximumFractionDigits: 1 })}</div><div className="stat-label">kg CO2e calculados</div></div>
            <div className="stat-card"><div className="stat-num">{ev.declaraciones_rep}</div><div className="stat-label">declaraciones REP</div></div>
          </div>
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            Este módulo es un registro interno de seguimiento: la certificación de cumplimiento del APL
            la otorga la auditoría de evaluación de conformidad del sistema APL, no sicr3p.
          </p>
        </div>
      </div>
    );
  }

  // ---------- Listado ----------
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0 }}>Acuerdos de Producción Limpia</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Seguimiento del APL de cada cliente: metas, avance y evidencia que la plataforma respalda.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setNuevo({ ...ACUERDO_VACIO })}>+ Registrar APL</button>
      </div>

      {err && <div className="badge badge-red" style={{ display: 'block', padding: '10px 14px', margin: '12px 0' }}>{err}</div>}

      {nuevo && (
        <div className="card card-pad" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Registrar adhesión a un APL</h2>
          <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="field"><label>Cliente *</label>
              <select value={nuevo.cliente_id} onChange={(e) => setNuevo({ ...nuevo, cliente_id: e.target.value })}>
                <option value="">— elegir —</option>
                {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre_empresa} ({c.rut})</option>)}
              </select></div>
            <div className="field"><label>Nombre del APL *</label>
              <input placeholder="p. ej. APL Logístico ..." value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} /></div>
            <div className="field"><label>Sector</label>
              <input placeholder="logística, minería, agroindustria…" value={nuevo.sector} onChange={(e) => setNuevo({ ...nuevo, sector: e.target.value })} /></div>
            <div className="field"><label>Fecha de adhesión</label>
              <input type="date" value={nuevo.fecha_adhesion} onChange={(e) => setNuevo({ ...nuevo, fecha_adhesion: e.target.value })} /></div>
            <div className="field"><label>Plazo de implementación (meses)</label>
              <input type="number" min="1" max="120" placeholder="lo define cada acuerdo"
                value={nuevo.plazo_meses} onChange={(e) => setNuevo({ ...nuevo, plazo_meses: e.target.value })} /></div>
            <div className="field"><label>Notas</label>
              <input value={nuevo.notas} onChange={(e) => setNuevo({ ...nuevo, notas: e.target.value })} /></div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-outline" onClick={() => setNuevo(null)}>Cancelar</button>
            <button className="btn btn-primary" disabled={!nuevo.cliente_id || !nuevo.nombre.trim()} onClick={guardarAcuerdo}>Guardar</button>
          </div>
        </div>
      )}

      {acuerdos === null && <p style={{ marginTop: 20 }}><span className="spinner dark" /> Cargando…</p>}
      {acuerdos?.length === 0 && !nuevo && (
        <div className="card card-pad" style={{ marginTop: 16 }}>
          <p className="muted" style={{ margin: 0 }}>
            Ningún cliente tiene un APL registrado todavía. Cuando un cliente adhiera a un Acuerdo de
            Producción Limpia, regístralo aquí para llevar sus metas y respaldarlas con la evidencia
            de la plataforma (documentos procesados, exports, declaraciones REP).
          </p>
        </div>
      )}
      {acuerdos?.length > 0 && (
        <div className="table-scroll" style={{ marginTop: 16 }}>
          <table className="table">
            <thead><tr><th>Acuerdo</th><th>Cliente</th><th>Estado</th><th>Metas</th><th>Adhesión</th><th></th></tr></thead>
            <tbody>
              {acuerdos.map((a) => (
                <tr key={a.id}>
                  <td style={{ maxWidth: 260 }}><b>{a.nombre}</b>{a.sector ? <span className="muted"> · {a.sector}</span> : null}</td>
                  <td>{a.nombre_empresa}<div className="muted" style={{ fontSize: 12 }}>{a.cliente_rut}</div></td>
                  <td><Badge mapa={ESTADOS_ACUERDO} valor={a.estado} /></td>
                  <td>{a.metas_cumplidas}/{a.metas_total} cumplidas</td>
                  <td>{a.fecha_adhesion ? new Date(a.fecha_adhesion).toLocaleDateString('es-CL') : '—'}</td>
                  <td><button className="btn btn-outline btn-sm" onClick={() => abrir(a.id)}>Abrir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
