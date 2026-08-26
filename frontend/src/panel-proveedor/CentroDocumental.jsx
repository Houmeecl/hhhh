import { useEffect, useMemo, useState } from 'react';
import { api, authProveedor, fmtFecha } from '../api.js';

const CATEGORIA_NOMBRE = {
  xml_combustible: 'XML combustible',
  reporte_gps: 'Reporte GPS',
  horometro: 'Horómetro',
  contrato: 'Contrato',
  calculo: 'Cálculo declarado',
  ficha_activo: 'Ficha del activo',
  otro: 'Otro respaldo',
};

const ESTADO = {
  pendiente: ['Pendiente', 'badge-amber'],
  aprobado: ['Aprobado', 'badge-green'],
  con_observaciones: ['Con observaciones', 'badge-amber'],
  rechazado: ['Rechazado', 'badge-red'],
};

async function docRequest(path, options = {}) {
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${authProveedor.access}` };
  const res = await fetch(`/api/panel-proveedor/documentos${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'No se pudo completar la operación.');
  return data;
}

export default function CentroDocumental() {
  const [expedientes, setExpedientes] = useState([]);
  const [documentos, setDocumentos] = useState([]);
  const [resumen, setResumen] = useState({ total: 0, revisados: 0, pendientes: 0, con_observaciones: 0, avance: 0 });
  const [filtro, setFiltro] = useState('todos');
  const [expedienteFiltro, setExpedienteFiltro] = useState('');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const [form, setForm] = useState({ expediente_id: '', categoria: 'xml_combustible', descripcion: '', archivo: null });
  const [votando, setVotando] = useState(null);
  const [voto, setVoto] = useState({ decision: 'aprobar', comentario: '' });

  async function cargar() {
    setCargando(true); setError('');
    try {
      const qs = expedienteFiltro ? `?expediente_id=${encodeURIComponent(expedienteFiltro)}` : '';
      const [docs, exps] = await Promise.all([
        docRequest(qs),
        api.proveedorExpedientes(),
      ]);
      setDocumentos(docs.documentos || []);
      setResumen(docs.resumen || {});
      const lista = exps.expedientes || [];
      setExpedientes(lista);
      if (!form.expediente_id && lista[0]?.id) setForm((f) => ({ ...f, expediente_id: lista[0].id }));
    } catch (e) { setError(e.message); }
    finally { setCargando(false); }
  }

  useEffect(() => { cargar(); }, [expedienteFiltro]);

  const visibles = useMemo(() => documentos.filter((d) => {
    if (filtro === 'todos') return true;
    if (filtro === 'revisados') return Number(d.votos_total) > 0;
    if (filtro === 'pendientes') return d.estado_revision === 'pendiente';
    if (filtro === 'observaciones') return ['con_observaciones', 'rechazado'].includes(d.estado_revision);
    return true;
  }), [documentos, filtro]);

  async function subir(e) {
    e.preventDefault();
    if (!form.expediente_id || !form.archivo) return setError('Selecciona un expediente y un archivo.');
    setSubiendo(true); setError('');
    try {
      const fd = new FormData();
      fd.append('archivo', form.archivo);
      fd.append('categoria', form.categoria);
      if (form.descripcion.trim()) fd.append('descripcion', form.descripcion.trim());
      await docRequest(`/${form.expediente_id}`, { method: 'POST', body: fd });
      setForm((f) => ({ ...f, descripcion: '', archivo: null }));
      const input = document.getElementById('centro-doc-archivo');
      if (input) input.value = '';
      await cargar();
    } catch (e2) { setError(e2.message); }
    finally { setSubiendo(false); }
  }

  async function verArchivo(doc) {
    setError('');
    try {
      const res = await fetch(`/api/panel-proveedor/documentos/${doc.id}/archivo`, {
        headers: { Authorization: `Bearer ${authProveedor.access}` },
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'No se pudo abrir el archivo.');
      }
      const url = URL.createObjectURL(await res.blob());
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { setError(e.message); }
  }

  async function guardarVoto() {
    if (!votando) return;
    setError('');
    try {
      await docRequest(`/${votando.id}/voto`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(voto),
      });
      setVotando(null); setVoto({ decision: 'aprobar', comentario: '' });
      await cargar();
    } catch (e) { setError(e.message); }
  }

  function nombreExpediente(e) {
    const oc = e.orden_compra ? ` · OC ${e.orden_compra}` : '';
    const periodo = e.periodo ? ` · ${e.periodo}` : '';
    return `${e.cliente_nombre}${oc}${periodo}`;
  }

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <div className="eyebrow">Evidencia</div>
          <h1 style={{ margin: '4px 0 6px' }}>Centro documental</h1>
          <p className="muted" style={{ margin: 0, maxWidth: 720 }}>
            Carga, revisa y sigue el avance de los documentos del expediente. El archivo original queda privado, con hash SHA-256 y trazabilidad de revisión.
          </p>
        </div>
        <select className="input" value={expedienteFiltro} onChange={(e) => setExpedienteFiltro(e.target.value)} style={{ minWidth: 270 }}>
          <option value="">Todos los expedientes</option>
          {expedientes.map((e) => <option key={e.id} value={e.id}>{nombreExpediente(e)}</option>)}
        </select>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(155px,1fr))', gap: 12, marginBottom: 18 }}>
        <Metric titulo="Avance" valor={`${resumen.avance || 0}%`} detalle={`${resumen.revisados || 0} revisados de ${resumen.total || 0}`} />
        <Metric titulo="Documentos" valor={resumen.total || 0} detalle="archivos conservados" />
        <Metric titulo="Pendientes" valor={resumen.pendientes || 0} detalle="sin voto todavía" />
        <Metric titulo="Observaciones" valor={resumen.con_observaciones || 0} detalle="requieren atención" />
      </div>

      <div className="card" style={{ padding: 18, marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <strong>Avance de revisión</strong><span className="muted">{resumen.revisados || 0} de {resumen.total || 0}</span>
        </div>
        <div style={{ height: 10, background: '#e8edf2', borderRadius: 99, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${resumen.avance || 0}%`, background: '#16a36a', transition: 'width .2s' }} />
        </div>
      </div>

      <form className="card" onSubmit={subir} style={{ padding: 18, marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Subir documentación</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 2fr', gap: 12 }}>
          <label>Expediente
            <select className="input" value={form.expediente_id} onChange={(e) => setForm({ ...form, expediente_id: e.target.value })}>
              <option value="">Seleccionar…</option>
              {expedientes.map((e) => <option key={e.id} value={e.id}>{nombreExpediente(e)}</option>)}
            </select>
          </label>
          <label>Categoría
            <select className="input" value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}>
              {Object.entries(CATEGORIA_NOMBRE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label>Archivo
            <input id="centro-doc-archivo" className="input" type="file" accept=".xml,.pdf,.jpg,.jpeg,.png" onChange={(e) => setForm({ ...form, archivo: e.target.files?.[0] || null })} />
          </label>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', marginTop: 12 }}>
          <label style={{ flex: 1 }}>Descripción opcional
            <input className="input" value={form.descripcion} maxLength={300} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} placeholder="Ej.: XML combustible — julio 2026" />
          </label>
          <button className="btn btn-primary" disabled={subiendo || !expedientes.length}>{subiendo ? 'Subiendo…' : 'Subir archivo'}</button>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>XML, PDF, JPG o PNG · máximo 15 MB · no se publica en el QR.</div>
      </form>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {[
          ['todos', 'Todos'], ['pendientes', 'Pendientes'], ['revisados', 'Revisados'], ['observaciones', 'Con observaciones'],
        ].map(([k, label]) => (
          <button key={k} type="button" className={`btn btn-sm ${filtro === k ? 'btn-primary' : 'btn-outline'}`} onClick={() => setFiltro(k)}>{label}</button>
        ))}
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        {cargando ? <div style={{ padding: 30 }}><span className="spinner dark" /> Cargando documentos…</div> : visibles.length === 0 ? (
          <div style={{ padding: 34, textAlign: 'center' }} className="muted">Todavía no hay documentos en este filtro.</div>
        ) : (
          <table className="table" style={{ width: '100%' }}>
            <thead><tr><th>Archivo</th><th>Expediente</th><th>Categoría</th><th>Estado</th><th>Votos</th><th>Fecha</th><th>Acciones</th></tr></thead>
            <tbody>{visibles.map((d) => {
              const [etiqueta, badge] = ESTADO[d.estado_revision] || ESTADO.pendiente;
              return <tr key={d.id}>
                <td><strong>{d.archivo_original}</strong><div className="muted" style={{ fontSize: 11 }}>SHA {String(d.sha256).slice(0, 12)}… · v{d.version}</div></td>
                <td>{d.cliente_nombre}<div className="muted" style={{ fontSize: 11 }}>{d.orden_compra ? `OC ${d.orden_compra}` : d.periodo || '—'}</div></td>
                <td>{CATEGORIA_NOMBRE[d.categoria] || d.categoria}</td>
                <td><span className={`badge ${badge}`}>{etiqueta}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>✓ {d.aprobar || 0} · ! {d.observar || 0} · × {d.rechazar || 0}</td>
                <td>{fmtFecha(d.created_at)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-outline btn-sm" type="button" onClick={() => verArchivo(d)}>Ver archivo</button>{' '}
                  <button className="btn btn-primary btn-sm" type="button" onClick={() => { setVotando(d); setVoto({ decision: 'aprobar', comentario: '' }); }}>Revisar / votar</button>
                </td>
              </tr>;
            })}</tbody>
          </table>
        )}
      </div>

      {votando && <div style={overlayStyle} onMouseDown={(e) => { if (e.target === e.currentTarget) setVotando(null); }}>
        <div className="card" style={{ width: 'min(520px,92vw)', padding: 22 }}>
          <h3 style={{ marginTop: 0 }}>Revisar documento</h3>
          <p style={{ marginTop: 0 }}><strong>{votando.archivo_original}</strong></p>
          <label>Decisión
            <select className="input" value={voto.decision} onChange={(e) => setVoto({ ...voto, decision: e.target.value })}>
              <option value="aprobar">Aprobar</option>
              <option value="observar">Agregar observación</option>
              <option value="rechazar">Rechazar</option>
            </select>
          </label>
          <label style={{ display: 'block', marginTop: 12 }}>Comentario
            <textarea className="input" rows={4} value={voto.comentario} onChange={(e) => setVoto({ ...voto, comentario: e.target.value })} placeholder={voto.decision === 'aprobar' ? 'Opcional' : 'Indica qué falta o qué debe corregirse'} />
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button type="button" className="btn btn-outline" onClick={() => setVotando(null)}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={guardarVoto}>Guardar revisión</button>
          </div>
        </div>
      </div>}
    </section>
  );
}

function Metric({ titulo, valor, detalle }) {
  return <div className="card" style={{ padding: 16 }}>
    <div className="muted" style={{ fontSize: 12 }}>{titulo}</div>
    <div style={{ fontSize: 28, fontWeight: 800, margin: '4px 0' }}>{valor}</div>
    <div className="muted" style={{ fontSize: 11 }}>{detalle}</div>
  </div>;
}

const overlayStyle = {
  position: 'fixed', inset: 0, background: 'rgba(10,20,35,.55)', zIndex: 1000,
  display: 'grid', placeItems: 'center', padding: 20,
};
