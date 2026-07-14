import { useState } from 'react';
import { api, fmt, fmtInt, fmtFecha } from '../api.js';
import { Icon } from '../components/icons.jsx';

// Búsqueda unificada por RUT / texto con cruces de clientes.
export default function Buscar() {
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  async function buscar(e) {
    e?.preventDefault();
    if (q.trim().length < 3) { setError('Escribe al menos 3 caracteres.'); return; }
    setCargando(true); setError(null);
    try { setData(await api.buscar(q.trim())); }
    catch (err) { setError(err.message); setData(null); }
    finally { setCargando(false); }
  }

  const nada = data && !data.clientes.length && !data.sesiones.length && !data.facturas.length
    && !data.documentos.length && !(data.cruces && (data.cruces.recibe_de.length || data.cruces.emite_a.length || data.cruces.como_cliente.n_sesiones));

  return (
    <div>
      <div className="admin-head">
        <div>
          <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: 'var(--green-600)' }}><Icon.Search size={24} /></span> Búsqueda
          </h1>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>
            Un RUT, un N° de documento, un archivo o una empresa — todas sus apariciones y sus cruces.
          </p>
        </div>
      </div>

      <form onSubmit={buscar} className="card card-pad" style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="RUT · N° de venta · N° DIN / MIC-DTA · nombre de empresa…" style={{ flex: 1 }} />
          <button className="btn btn-primary" type="submit" disabled={cargando}>
            {cargando ? <span className="spinner" /> : 'Buscar'}
          </button>
        </div>
        {error && <div className="muted" style={{ color: '#b91c1c', fontSize: 13, marginTop: 8 }}>{error}</div>}
      </form>

      {nada && <div className="card card-pad muted" style={{ textAlign: 'center', padding: 40 }}>Sin resultados para “{data.q}”.</div>}

      {/* ---------- Cruces del RUT ---------- */}
      {data?.cruces && !nada && (
        <>
          <h2 style={{ fontSize: 17, margin: '6px 0 10px' }}>Cruces del RUT</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14, marginBottom: 16 }}>
            <div className="card card-pad">
              <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase' }}>Como cliente sicr3p</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--green-600)' }}>{fmtInt(data.cruces.como_cliente.n_sesiones)}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                sesiones · {fmt(data.cruces.como_cliente.total_co2e, 2)} t CO2e
                {data.cruces.como_cliente.ultima_sesion ? ` · última ${fmtFecha(data.cruces.como_cliente.ultima_sesion)}` : ''}
              </div>
            </div>
            <div className="card card-pad">
              <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase' }}>Proveedores (recibe de)</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--green-600)' }}>{fmtInt(data.cruces.recibe_de.length)}</div>
              <div className="muted" style={{ fontSize: 12 }}>{fmt(data.cruces.recibe_de.reduce((a, x) => a + (x.total_co2e || 0), 0), 2)} t CO2e aguas arriba</div>
            </div>
            <div className="card card-pad">
              <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase' }}>Clientes (emite a)</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--green-600)' }}>{fmtInt(data.cruces.emite_a.length)}</div>
              <div className="muted" style={{ fontSize: 12 }}>{fmt(data.cruces.emite_a.reduce((a, x) => a + (x.total_co2e || 0), 0), 2)} t CO2e aguas abajo</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, marginBottom: 20 }}>
            {data.cruces.recibe_de.length > 0 && (
              <div className="card">
                <div style={{ padding: '14px 16px 0', fontWeight: 700 }}>Recibe documentos de (proveedores)</div>
                <table className="data">
                  <thead><tr><th>RUT emisor</th><th className="num">Docs</th><th className="num">t CO2e</th></tr></thead>
                  <tbody>
                    {data.cruces.recibe_de.map((p) => (
                      <tr key={p.rut_emisor}><td><b>{p.rut_emisor}</b></td><td className="num">{p.n_documentos}</td><td className="num">{fmt(p.total_co2e, 3)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.cruces.emite_a.length > 0 && (
              <div className="card">
                <div style={{ padding: '14px 16px 0', fontWeight: 700 }}>Emite documentos a (clientes)</div>
                <table className="data">
                  <thead><tr><th>RUT receptor</th><th>Empresa</th><th className="num">Docs</th><th className="num">t CO2e</th></tr></thead>
                  <tbody>
                    {data.cruces.emite_a.map((p) => (
                      <tr key={p.rut_receptor}><td><b>{p.rut_receptor}</b></td><td className="muted" style={{ fontSize: 13 }}>{p.empresa || '—'}</td><td className="num">{p.n_documentos}</td><td className="num">{fmt(p.total_co2e, 3)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ---------- Apariciones ---------- */}
      {data && !nada && (
        <div style={{ display: 'grid', gap: 16 }}>
          {data.clientes.length > 0 && (
            <div className="card">
              <div style={{ padding: '14px 16px 0', fontWeight: 700 }}>Clientes ({data.clientes.length})</div>
              <table className="data">
                <thead><tr><th>Empresa</th><th>RUT</th><th>Contrato</th><th>Plan</th></tr></thead>
                <tbody>
                  {data.clientes.map((c) => (
                    <tr key={c.id}><td><b>{c.nombre_empresa}</b></td><td>{c.rut}</td>
                      <td><span className={`badge ${c.estado_contrato === 'activo' ? 'badge-green' : c.estado_contrato === 'piloto' ? 'badge-amber' : 'badge-gray'}`}>{c.estado_contrato}</span></td>
                      <td className="muted">{c.plan}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.facturas.length > 0 && (
            <div className="card">
              <div style={{ padding: '14px 16px 0', fontWeight: 700 }}>Documentos procesados ({data.facturas.length})</div>
              <table className="data">
                <thead><tr><th>Fecha</th><th>Documento</th><th>Emisor → Receptor</th><th>Cliente</th><th className="num">t CO2e</th></tr></thead>
                <tbody>
                  {data.facturas.map((f) => (
                    <tr key={f.id}>
                      <td className="muted" style={{ fontSize: 13 }}>{fmtFecha(f.created_at)}</td>
                      <td><b>{f.numero_venta || '—'}</b><div className="muted" style={{ fontSize: 12 }}>{f.archivo_original}</div></td>
                      <td className="muted" style={{ fontSize: 13 }}>{f.rut_emisor || '—'} → {f.rut_receptor || '—'}</td>
                      <td className="muted" style={{ fontSize: 13 }}>{f.nombre_cliente || '—'}</td>
                      <td className="num">{fmt(f.total_co2e, 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.documentos.length > 0 && (
            <div className="card">
              <div style={{ padding: '14px 16px 0', fontWeight: 700 }}>Corredor Bioceánico ({data.documentos.length})</div>
              <table className="data">
                <thead><tr><th>Fecha</th><th>Tramo</th><th>Tipo</th><th>N°</th><th>Estado</th><th className="num">t CO2e</th></tr></thead>
                <tbody>
                  {data.documentos.map((d) => (
                    <tr key={d.id}>
                      <td className="muted" style={{ fontSize: 13 }}>{fmtFecha(d.created_at)}</td>
                      <td>{d.pais_origen} → {d.pais_destino}{d.tramo ? <div className="muted" style={{ fontSize: 12 }}>{d.tramo}</div> : null}</td>
                      <td><span className="badge badge-gray">{d.tipo_documento}</span></td>
                      <td className="muted" style={{ fontSize: 13 }}>{d.numero_documento || '—'}</td>
                      <td><span className={`badge ${d.estado === 'procesado' ? 'badge-green' : 'badge-gray'}`}>{d.estado}</span></td>
                      <td className="num">{d.estado === 'procesado' ? fmt(d.total_co2e, 3) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.sesiones.length > 0 && (
            <div className="card">
              <div style={{ padding: '14px 16px 0', fontWeight: 700 }}>Sesiones ({data.sesiones.length})</div>
              <table className="data">
                <thead><tr><th>Fecha</th><th>Empresa</th><th>RUT</th><th>Email</th><th className="num">t CO2e</th></tr></thead>
                <tbody>
                  {data.sesiones.map((s) => (
                    <tr key={s.id}>
                      <td className="muted" style={{ fontSize: 13 }}>{fmtFecha(s.created_at)}</td>
                      <td><b>{s.nombre_cliente}</b></td><td>{s.rut_cliente}</td>
                      <td className="muted" style={{ fontSize: 13 }}>{s.email_cliente}</td>
                      <td className="num">{fmt(s.total_co2e, 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
