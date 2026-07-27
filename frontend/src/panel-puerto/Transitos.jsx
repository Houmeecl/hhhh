import { useEffect, useState } from 'react';
import { api, fmtFecha } from '../api.js';
import { Icon } from '../components/icons.jsx';

// Lista de tránsitos del Corredor Bioceánico que pasan por el punto de
// ESTE puerto (backend ya filtra por punto_id de la sesión — nunca se
// ve el tránsito de otro punto) + detalle con la cadena de custodia y
// su verificación de integridad.
export default function Transitos() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [seleccionado, setSeleccionado] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [errorDetalle, setErrorDetalle] = useState('');

  useEffect(() => {
    api.puertoTransitos().then(setData).catch((e) => setError(e.message));
  }, []);

  async function abrir(codigo) {
    setSeleccionado(codigo);
    setDetalle(null);
    setErrorDetalle('');
    setCargandoDetalle(true);
    try {
      const d = await api.puertoTransito(codigo);
      setDetalle(d);
    } catch (e) {
      setErrorDetalle(e.message);
    } finally {
      setCargandoDetalle(false);
    }
  }

  if (error) return <div className="badge badge-red" style={{ display: 'block', padding: 14 }}>{error}</div>;
  if (!data) return <div style={{ padding: 40, textAlign: 'center' }}><span className="spinner dark" /> Cargando…</div>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Tránsitos por {data.puerto.nombre}</h1>
      <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>
        Punto del Corredor: <code>{data.puerto.punto_id}</code> — solo se muestran los lotes que ya sellaron un
        eslabón en este punto.
      </p>

      <div className="two-col-grid" style={{ gap: 16, alignItems: 'flex-start' }}>
        <div className="card card-pad">
          {!data.transitos.length ? (
            <p className="muted" style={{ fontSize: 13 }}>Sin tránsitos registrados por este punto todavía.</p>
          ) : (
            <div className="table-scroll">
              <table className="data">
                <thead><tr><th>Código</th><th>Material</th><th>Estado</th><th>Eslabones</th><th>Actualizado</th><th></th></tr></thead>
                <tbody>
                  {data.transitos.map((t) => (
                    <tr key={t.id} className={seleccionado === t.codigo ? 'active' : ''}>
                      <td style={{ fontFamily: 'monospace' }}>{t.codigo}</td>
                      <td>{t.material}</td>
                      <td><span className={`badge ${t.estado === 'abierto' ? 'badge-green' : 'badge-gray'}`}>{t.estado}</span></td>
                      <td>{t.n_eslabones}</td>
                      <td>{fmtFecha(t.updated_at)}</td>
                      <td><button className="btn btn-sm btn-outline" onClick={() => abrir(t.codigo)}>Ver</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card card-pad">
          {!seleccionado ? (
            <p className="muted" style={{ fontSize: 13 }}>Selecciona un tránsito para ver su cadena de custodia.</p>
          ) : cargandoDetalle ? (
            <div style={{ textAlign: 'center', padding: 20 }}><span className="spinner dark" /> Cargando…</div>
          ) : errorDetalle ? (
            <div className="badge badge-red" style={{ display: 'block', padding: 12 }}>{errorDetalle}</div>
          ) : detalle && (
            <>
              <h3 style={{ marginTop: 0 }}>{detalle.lote.codigo}</h3>
              <p className="muted" style={{ fontSize: 13 }}>
                {detalle.lote.material} · {detalle.lote.cantidad} {detalle.lote.unidad} · origen {detalle.lote.pais_origen}
              </p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                <span className={`badge ${detalle.integridad.valido ? 'badge-green' : 'badge-red'}`}>
                  <Icon.Shield size={12} /> {detalle.integridad.valido ? 'Cadena íntegra' : 'Cadena alterada'}
                </span>
                <span className="muted" style={{ fontSize: 12 }}>{detalle.integridad.total_eslabones} eslabones</span>
              </div>
              <div className="table-scroll">
                <table className="data">
                  <thead><tr><th>#</th><th>Rol</th><th>Empresa</th><th>País</th><th>Fecha</th></tr></thead>
                  <tbody>
                    {detalle.eslabones.map((e) => (
                      <tr key={e.eslabon}>
                        <td>{e.eslabon}</td>
                        <td>{e.rol}</td>
                        <td>{e.nombre_empresa || '—'}</td>
                        <td>{e.pais}</td>
                        <td>{fmtFecha(e.fecha)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
