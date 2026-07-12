import { useEffect, useState } from 'react';
import { api, fmtInt } from '../api.js';

export default function SimpleApi() {
  const [d, setD] = useState(null);
  useEffect(() => { api.simpleApi().then(setD).catch(() => {}); }, []);
  if (!d) return <div><span className="spinner dark" /> Cargando…</div>;

  return (
    <div>
      <div className="admin-head"><h1>Motor externo (Simple)</h1></div>

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <div className="stat">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className={`badge ${d.estado.ok ? 'badge-green' : 'badge-red'}`}>{d.estado.ok ? '● Operativo' : '● Sin conexión'}</span>
          </div>
          <div className="l" style={{ marginTop: 8 }}>Estado del ping</div>
        </div>
        <div className="stat"><div className="n">{d.estado.mock ? 'MOCK' : 'PROD'}</div><div className="l">Modo de operación</div></div>
        <div className="stat"><div className="n">{d.estado.latencia_ms ?? '—'}<small style={{ fontSize: 14 }}> ms</small></div><div className="l">Latencia último ping</div></div>
        <div className="stat"><div className="n" style={{ color: d.errores > 0 ? '#b91c1c' : undefined }}>{fmtInt(d.errores)}</div><div className="l">Errores (≥400)</div></div>
      </div>

      <div className="card card-pad">
        <h3 style={{ marginTop: 0 }}>Consumo por endpoint</h3>
        <table className="data">
          <thead><tr><th>Endpoint</th><th>Método</th><th className="num">Llamadas</th><th className="num">Latencia prom.</th><th className="num">Costo estimado</th></tr></thead>
          <tbody>
            {d.por_endpoint.map((e, i) => (
              <tr key={i}>
                <td><code>{e.endpoint}</code></td>
                <td><span className="badge badge-gray">{e.metodo}</span></td>
                <td className="num">{fmtInt(e.llamadas)}</td>
                <td className="num">{e.latencia_prom} ms</td>
                <td className="num">${fmtInt(Math.round(e.costo))} CLP</td>
              </tr>
            ))}
            {d.por_endpoint.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 30 }}>Sin llamadas registradas.</td></tr>}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ fontSize: 13, marginTop: 14 }}>
        La clave del motor externo vive solo en el backend. Para pasar a producción: <code>MOCK_SIMPLE=false</code> + una <code>SIMPLE_API_KEY</code> real.
      </p>
    </div>
  );
}
