import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';
import { api, fmt, fmtFecha } from '../api.js';

export default function Verificar() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.verificar(id).then(setData).catch((e) => setError(e.message));
  }, [id]);

  return (
    <PublicLayout>
      <div className="container" style={{ padding: '48px 24px', maxWidth: 720 }}>
        {error && (
          <div className="card card-pad" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 40 }}>⚠️</div>
            <h2>Documento no encontrado</h2>
            <p className="muted">No pudimos verificar la trazabilidad de este documento.</p>
          </div>
        )}

        {data && (
          <div className="card card-pad">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
              <span className="badge badge-green" style={{ fontSize: 14, padding: '6px 14px' }}>✓ Trazabilidad verificada</span>
            </div>
            <h1 style={{ fontSize: 26, margin: '10px 0 4px' }}>Documento {data.factura.numero_venta}</h1>
            <p className="muted" style={{ marginTop: 0 }}>Verificación pública de trazabilidad · sicr3p</p>

            <div className="result-cards" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <div className="result-card">
                <div className="big">{fmt(data.factura.total_co2e, 3)} <small>t CO2e</small></div>
                <div className="lbl">Resultado incorporado</div>
              </div>
              <div className="result-card">
                <div className="big" style={{ fontSize: 18 }}>{data.factura.categoria}</div>
                <div className="lbl">Categoría</div>
              </div>
              <div className="result-card">
                <div className="big">{data.items.length}</div>
                <div className="lbl">Ítems</div>
              </div>
            </div>

            <div style={{ margin: '18px 0', padding: '16px', background: 'var(--bg)', borderRadius: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 14 }}>
                <div><span className="muted">Cliente</span><br /><b>{data.cliente.nombre}</b></div>
                <div><span className="muted">RUT</span><br /><b>{data.cliente.rut}</b></div>
                <div><span className="muted">Fecha</span><br /><b>{fmtFecha(data.factura.fecha)}</b></div>
                <div><span className="muted">Estado</span><br /><span className="badge badge-green">{data.factura.status}</span></div>
              </div>
            </div>

            <h3 style={{ margin: '0 0 8px' }}>Detalle por ítem</h3>
            <table className="data">
              <thead><tr><th>Descripción</th><th className="num">t CO2e</th><th className="num">% del total</th></tr></thead>
              <tbody>
                {data.items.map((it, i) => (
                  <tr key={i}>
                    <td>{it.descripcion}</td>
                    <td className="num">{fmt(it.co2e, 4)}</td>
                    <td className="num">{fmt(it.porcentaje_total, 1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>
              Esta página confirma la trazabilidad del documento registrado en sicr3p.
              No constituye una verificación de tercera parte acreditada.
            </p>
          </div>
        )}
      </div>
    </PublicLayout>
  );
}
