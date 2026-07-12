import { useEffect, useState } from 'react';
import { api, fmt, fmtInt } from '../api.js';
import { Donut, Sparkbars } from '../components/Charts.jsx';

// Barra horizontal simple (sin librerías externas).
function Bar({ value, max, label, right }) {
  const pct = max > 0 ? Math.max(3, (value / max) * 100) : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
        <span>{label}</span><span className="muted">{right}</span>
      </div>
      <div className="progress-bar"><div style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

export default function Metricas() {
  const [m, setM] = useState(null);
  useEffect(() => { api.metricas().then(setM).catch(() => {}); }, []);
  if (!m) return <div><span className="spinner dark" /> Cargando…</div>;

  const maxCliente = Math.max(...m.co2e_por_cliente.map((c) => c.co2e), 1);
  const maxCat = Math.max(...m.por_categoria.map((c) => c.co2e), 1);
  const maxSerie = Math.max(...m.serie_mensual.map((s) => s.co2e), 1);

  return (
    <div>
      <div className="admin-head"><h1>Métricas</h1></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>CO2e por cliente</h3>
          {m.co2e_por_cliente.map((c, i) => (
            <Bar key={i} value={c.co2e} max={maxCliente} label={c.nombre_cliente} right={`${fmt(c.co2e, 2)} t · ${c.sesiones} ses.`} />
          ))}
          {m.co2e_por_cliente.length === 0 && <p className="muted">Sin datos.</p>}
        </div>

        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>CO2e por categoría</h3>
          <Donut data={m.por_categoria.map((c) => ({ label: c.categoria, value: c.co2e }))} unit="t CO2e" />
        </div>

        <div className="card card-pad" style={{ gridColumn: '1 / -1' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Serie mensual (facturas y CO2e)</h3>
            <div style={{ width: 220 }}><Sparkbars values={m.serie_mensual.map((s) => s.co2e)} height={40} /></div>
          </div>
          <table className="data">
            <thead><tr><th>Mes</th><th className="num">Facturas</th><th className="num">t CO2e</th><th>Tendencia</th></tr></thead>
            <tbody>
              {m.serie_mensual.map((s, i) => (
                <tr key={i}>
                  <td>{s.mes}</td>
                  <td className="num">{fmtInt(s.facturas)}</td>
                  <td className="num">{fmt(s.co2e, 3)}</td>
                  <td style={{ width: '40%' }}><div className="progress-bar"><div style={{ width: `${(s.co2e / maxSerie) * 100}%` }} /></div></td>
                </tr>
              ))}
              {m.serie_mensual.length === 0 && <tr><td colSpan={4} className="muted">Sin datos.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
