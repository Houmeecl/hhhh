import { useEffect, useState } from 'react';
import { api, fmt, fmtFecha } from '../api.js';

export default function Sesiones() {
  const [sesiones, setSesiones] = useState([]);
  const [q, setQ] = useState('');
  const [detalle, setDetalle] = useState(null);

  const cargar = (qs = '') => api.sesiones(qs).then((r) => setSesiones(r.sesiones)).catch(() => {});
  useEffect(() => { cargar(); }, []);

  function buscar(e) {
    e.preventDefault();
    cargar(q ? `?q=${encodeURIComponent(q)}` : '');
  }
  async function ver(id) {
    const d = await api.sesionAdmin(id);
    setDetalle(d);
  }

  return (
    <div>
      <div className="admin-head">
        <h1>Sesiones e informes</h1>
        <form onSubmit={buscar} style={{ display: 'flex', gap: 8 }}>
          <input className="field" style={{ padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 9 }} placeholder="Buscar por empresa o RUT" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn btn-outline btn-sm">Buscar</button>
        </form>
      </div>

      <div className="card">
        <table className="data">
          <thead><tr><th>Fecha</th><th>Empresa</th><th>RUT</th><th className="num">Facturas</th><th className="num">t CO2e</th><th></th></tr></thead>
          <tbody>
            {sesiones.map((s) => (
              <tr key={s.id}>
                <td>{fmtFecha(s.created_at)}</td>
                <td><b>{s.nombre_cliente}</b></td>
                <td className="muted">{s.rut_cliente}</td>
                <td className="num">{s.n_facturas}</td>
                <td className="num">{fmt(s.total_co2e, 3)}</td>
                <td>
                  <button className="btn btn-ghost btn-sm" onClick={() => ver(s.id)}>Ver</button>
                  <a className="btn btn-ghost btn-sm" href={api.informeUrl(s.id)} target="_blank" rel="noreferrer">PDF</a>
                </td>
              </tr>
            ))}
            {sesiones.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 30 }}>Sin sesiones.</td></tr>}
          </tbody>
        </table>
      </div>

      {detalle && (
        <div className="modal-bg" onClick={(e) => e.target.className === 'modal-bg' && setDetalle(null)}>
          <div className="modal" style={{ maxWidth: 720 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>{detalle.sesion.nombre_cliente}</h2>
              <a className="btn btn-primary btn-sm" href={api.informeUrl(detalle.sesion.id)} target="_blank" rel="noreferrer">Descargar informe</a>
            </div>
            <p className="muted">{detalle.sesion.rut_cliente} · {fmtFecha(detalle.sesion.created_at)} · Total {fmt(detalle.sesion.total_co2e, 3)} t CO2e</p>
            <table className="data">
              <thead><tr><th>N° venta</th><th>Categoría</th><th>Emisor</th><th className="num">t CO2e</th><th>Motor</th><th></th></tr></thead>
              <tbody>
                {detalle.facturas.map((f) => (
                  <tr key={f.id}>
                    <td>{f.numero_venta}</td>
                    <td><span className="badge badge-green">{f.categoria}</span></td>
                    <td className="muted">{f.rut_emisor}</td>
                    <td className="num">{fmt(f.total_co2e, 3)}</td>
                    <td><span className={`badge ${f.motor === 'propio' ? 'badge-green' : 'badge-gray'}`}>{f.motor === 'propio' ? 'Propio' : 'Externo'}</span></td>
                    <td><a className="btn btn-ghost btn-sm" href={api.etiquetaUrl(f.id)} target="_blank" rel="noreferrer">Etiqueta</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ textAlign: 'right', marginTop: 12 }}><button className="btn btn-outline" onClick={() => setDetalle(null)}>Cerrar</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
