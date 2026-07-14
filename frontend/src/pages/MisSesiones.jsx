import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';
import { api, clienteAuth, fmt, fmtFecha } from '../api.js';

// Historial del cliente (acceso vía magic link).
export default function MisSesiones() {
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!clienteAuth.token) { nav('/ingresar', { replace: true }); return; }
    api.misSesiones()
      .then(setData)
      .catch((e) => {
        // Token vencido → pedir uno nuevo.
        clienteAuth.clear();
        setError(e.message);
      });
  }, []);

  function salir() { clienteAuth.clear(); nav('/'); }

  if (error) {
    return (
      <PublicLayout>
        <div className="narrow-page" style={{ textAlign: 'center' }}>
          <div className="card card-pad">
            <p className="muted">{error}</p>
            <Link to="/ingresar" className="btn btn-primary">Ingresar de nuevo</Link>
          </div>
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <div style={{ maxWidth: 900, margin: '40px auto', padding: '0 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 26 }}>Mi historial</h1>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>{data?.email}</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Link to="/cargar" className="btn btn-primary btn-sm">+ Nueva carga</Link>
            <button className="btn btn-outline btn-sm" onClick={salir}>Salir</button>
          </div>
        </div>

        {!data ? (
          <div className="card card-pad" style={{ marginTop: 20 }}><span className="spinner dark" /> Cargando…</div>
        ) : data.sesiones.length === 0 ? (
          <div className="card card-pad" style={{ marginTop: 20, textAlign: 'center', padding: 40 }}>
            <p className="muted">Aún no hay cargas asociadas a este correo.</p>
            <Link to="/cargar" className="btn btn-primary">Sube tus primeras facturas</Link>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 16, marginTop: 20 }}>
            {data.sesiones.map((s) => (
              <div className="card card-pad" key={s.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <b>{fmtFecha(s.created_at)}</b>
                    <span className="muted" style={{ fontSize: 13 }}> · {s.nombre_cliente} · {s.rut_cliente}</span>
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--green-600)' }}>
                    {fmt(s.total_co2e, 3)} <span style={{ fontSize: 12, color: 'var(--gray, #64748b)' }}>t CO2e</span>
                  </div>
                </div>
                <table className="data" style={{ marginTop: 10 }}>
                  <tbody>
                    {s.facturas.map((f) => (
                      <tr key={f.id}>
                        <td><b>{f.numero_venta || '—'}</b><div className="muted" style={{ fontSize: 12 }}>{f.archivo_original}</div></td>
                        <td><span className="badge badge-gray">{f.categoria}</span></td>
                        <td className="num">{fmt(f.total_co2e, 3)}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <a className="btn btn-outline btn-sm" href={api.etiquetaUrl(f.id)} target="_blank" rel="noreferrer">Etiqueta</a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                  <a className="btn btn-primary btn-sm" href={api.informeUrl(s.id)} target="_blank" rel="noreferrer">Informe (PDF)</a>
                  <Link className="btn btn-outline btn-sm" to={`/resultado/${s.id}`}>Ver resultados</Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PublicLayout>
  );
}
