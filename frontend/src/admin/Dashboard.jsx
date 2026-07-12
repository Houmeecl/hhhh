import { useEffect, useState } from 'react';
import { api, fmt, fmtInt, fmtFecha } from '../api.js';

export default function Dashboard() {
  const [d, setD] = useState(null);
  const [alertas, setAlertas] = useState([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.dashboard().then(setD).catch((e) => setErr(e.message));
    api.alertasContratos().then((r) => setAlertas(r.alertas)).catch(() => {});
  }, []);

  if (err) return <div className="badge badge-red" style={{ padding: 14 }}>{err}</div>;
  if (!d) return <div><span className="spinner dark" /> Cargando…</div>;

  const est = d.clientes_por_estado;
  return (
    <div>
      <div className="admin-head"><h1>Dashboard</h1></div>

      <div className="stat-grid">
        <div className="stat"><div className="n green">{fmt(d.co2e_acumulado, 2)}</div><div className="l">t CO2e acumulado</div></div>
        <div className="stat"><div className="n">{fmtInt(d.sesiones_mes)}</div><div className="l">Sesiones del mes</div></div>
        <div className="stat"><div className="n">{fmtInt(d.facturas_mes)}</div><div className="l">Facturas del mes</div></div>
        <div className="stat"><div className="n">{fmtInt((est.piloto || 0) + (est.activo || 0) + (est.vencido || 0))}</div><div className="l">Clientes totales</div></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 20 }}>
        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Clientes por estado de contrato</h3>
          <div style={{ display: 'flex', gap: 12 }}>
            <div><span className="badge badge-green">Activo</span><div className="n" style={{ fontSize: 26, fontWeight: 800 }}>{est.activo || 0}</div></div>
            <div><span className="badge badge-amber">Piloto</span><div className="n" style={{ fontSize: 26, fontWeight: 800 }}>{est.piloto || 0}</div></div>
            <div><span className="badge badge-red">Vencido</span><div className="n" style={{ fontSize: 26, fontWeight: 800 }}>{est.vencido || 0}</div></div>
          </div>
        </div>

        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Motor externo (Simple)</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className={`badge ${d.simple_api.ok ? 'badge-green' : 'badge-red'}`}>
              {d.simple_api.ok ? '● Operativo' : '● Sin conexión'}
            </span>
            <span className="badge badge-gray">{d.simple_api.mock ? 'Modo MOCK' : 'Producción'}</span>
            {d.simple_api.latencia_ms != null && <span className="muted" style={{ fontSize: 13 }}>{d.simple_api.latencia_ms} ms</span>}
          </div>
          <div style={{ marginTop: 14 }} className="muted">
            Consumo del mes: <b>{fmtInt(d.consumo_api_mes.llamadas)}</b> llamadas ·
            costo estimado <b>${fmtInt(Math.round(d.consumo_api_mes.costo))} CLP</b>
          </div>
        </div>
      </div>

      {alertas.length > 0 && (
        <div className="card card-pad" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>⚠️ Contratos por vencer / vencidos</h3>
          <table className="data">
            <thead><tr><th>Empresa</th><th>Estado</th><th>Vence</th><th className="num">Días</th></tr></thead>
            <tbody>
              {alertas.map((a) => (
                <tr key={a.id}>
                  <td>{a.nombre_empresa}</td>
                  <td><span className="badge badge-gray">{a.estado_contrato}</span></td>
                  <td>{fmtFecha(a.fecha_fin)}</td>
                  <td className="num">{a.dias_restantes < 0 ? `Vencido hace ${-a.dias_restantes}` : a.dias_restantes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
