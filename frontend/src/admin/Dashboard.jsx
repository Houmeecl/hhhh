import { useEffect, useState } from 'react';
import { api, fmt, fmtInt, fmtFecha } from '../api.js';
import { Icon } from '../components/icons.jsx';
import { Donut } from '../components/Charts.jsx';
import { SkeletonCards } from '../components/Skeleton.jsx';

export default function Dashboard() {
  const [d, setD] = useState(null);
  const [alertas, setAlertas] = useState([]);
  const [cadena, setCadena] = useState(null);
  const [verificacion, setVerificacion] = useState(null); // null | 'cargando' | resultado
  const [err, setErr] = useState('');

  useEffect(() => {
    api.dashboard().then(setD).catch((e) => setErr(e.message));
    api.alertasContratos().then((r) => setAlertas(r.alertas)).catch(() => {});
    api.cadenaEstado().then((r) => setCadena(r.estado)).catch(() => {});
  }, []);

  async function verificarCadena() {
    setVerificacion('cargando');
    try { setVerificacion(await api.cadenaVerificar()); }
    catch (e) { setVerificacion({ valido: false, motivo: e.message }); }
  }

  if (err) return <div className="badge badge-red" style={{ padding: 14 }}>{err}</div>;
  if (!d) return <div><div className="admin-head"><h1>Dashboard</h1></div><SkeletonCards n={4} /></div>;

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
          <Donut
            size={150}
            unit="clientes"
            data={[
              { label: 'Activo', value: est.activo || 0 },
              { label: 'Piloto', value: est.piloto || 0 },
              { label: 'Vencido', value: est.vencido || 0 },
            ]}
          />
        </div>

        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Motor externo</h3>
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

      {cadena && (
        <div className="card card-pad" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Cadena de integridad</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span className="badge badge-green">● {fmtInt(cadena.n_eslabones)} eslabón{cadena.n_eslabones === 1 ? '' : 'es'}</span>
            <span className="muted" style={{ fontSize: 13 }}>hash SHA-256 encadenado por documento, interno</span>
            <button className="btn btn-outline btn-sm" onClick={verificarCadena} disabled={verificacion === 'cargando'}>
              {verificacion === 'cargando' ? <span className="spinner" /> : 'Verificar cadena completa'}
            </button>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 10, fontFamily: 'monospace', wordBreak: 'break-all' }}>
            Último hash: {cadena.ultimo_hash}
          </div>
          {verificacion && verificacion !== 'cargando' && (
            <div className={`badge ${verificacion.valido ? 'badge-green' : 'badge-red'}`} style={{ display: 'inline-block', marginTop: 10 }}>
              {verificacion.valido
                ? `✓ Cadena íntegra — ${fmtInt(verificacion.total_eslabones)} eslabones verificados`
                : `⚠ Cadena rota en factura ${verificacion.rompe_en || '?'} (${verificacion.motivo || 'error'})`}
            </div>
          )}
        </div>
      )}

      {alertas.length > 0 && (
        <div className="card card-pad" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8, color: '#b45309' }}><Icon.Alert size={18} /> <span style={{ color: 'var(--navy)' }}>Contratos por vencer / vencidos</span></h3>
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
