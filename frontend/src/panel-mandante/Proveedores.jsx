import { useEffect, useState } from 'react';
import { api, fmt, fmtInt, fmtFecha } from '../api.js';
import { Donut } from '../components/Charts.jsx';

// Proveedores que le han emitido documentos a ESTE mandante (backend ya
// filtra por su propio RUT receptor — nunca ve datos de otro mandante) +
// exportables de apoyo (Alcance 3 GHG Protocol, CBAM) que ya calcula
// pasaporteOrigen.js/alcanceGhg.js — este panel solo los expone.
export default function Proveedores() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [seleccionado, setSeleccionado] = useState(null);
  const [resumen, setResumen] = useState(null);
  const [cargandoResumen, setCargandoResumen] = useState(false);
  const [errorResumen, setErrorResumen] = useState('');
  const [exportando, setExportando] = useState('');
  const [errorExport, setErrorExport] = useState('');

  useEffect(() => {
    api.mandanteProveedores().then(setData).catch((e) => setError(e.message));
  }, []);

  async function abrir(rut) {
    setSeleccionado(rut);
    setResumen(null);
    setErrorResumen('');
    setCargandoResumen(true);
    try {
      const r = await api.mandanteProveedorResumen(rut);
      setResumen(r);
    } catch (e) {
      setErrorResumen(e.message);
    } finally {
      setCargandoResumen(false);
    }
  }

  async function exportar(fn, nombre) {
    setExportando(nombre);
    setErrorExport('');
    try { await fn(); } catch (e) { setErrorExport(e.message); }
    finally { setExportando(''); }
  }

  if (error) return <div className="badge badge-red" style={{ display: 'block', padding: 14 }}>{error}</div>;
  if (!data) return <div style={{ padding: 40, textAlign: 'center' }}><span className="spinner dark" /> Cargando…</div>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Proveedores de {data.mandante.empresa}</h1>
      <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>
        Empresas que te han emitido documentos con CO2e calculado, RUT receptor {data.mandante.rut}.
      </p>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Exportar datos de apoyo</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Datos de apoyo para tu propia declaración — no sustituyen una verificación de tercera parte acreditada.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-sm btn-outline" disabled={!!exportando}
            onClick={() => exportar(() => api.mandanteExportarAlcance3Csv(), 'alcance3')}>
            {exportando === 'alcance3' ? <span className="spinner" /> : 'Alcance 3 (CSV)'}
          </button>
          <button className="btn btn-sm btn-outline" disabled={!!exportando}
            onClick={() => exportar(() => api.mandanteExportarCbamCsv(), 'cbam-csv')}>
            {exportando === 'cbam-csv' ? <span className="spinner" /> : 'CBAM (CSV)'}
          </button>
          <button className="btn btn-sm btn-outline" disabled={!!exportando}
            onClick={() => exportar(() => api.mandanteExportarCbamPdf(), 'cbam-pdf')}>
            {exportando === 'cbam-pdf' ? <span className="spinner" /> : 'CBAM (PDF)'}
          </button>
        </div>
        {errorExport && <div className="badge badge-red" style={{ display: 'block', marginTop: 10, padding: 10 }}>{errorExport}</div>}
      </div>

      {data.proveedores.length > 0 && (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0, fontSize: 15 }}>t CO2e por proveedor</h3>
          <Donut data={data.proveedores.map((p) => ({ label: p.rut_proveedor, value: p.total_co2e }))} />
        </div>
      )}

      <div className="two-col-grid" style={{ gap: 16, alignItems: 'flex-start' }}>
        <div className="card card-pad">
          {!data.proveedores.length ? (
            <p className="muted" style={{ fontSize: 13 }}>Sin proveedores con documentos emitidos todavía.</p>
          ) : (
            <div className="table-scroll">
              <table className="data">
                <thead><tr><th>RUT proveedor</th><th>Documentos</th><th>t CO2e</th><th>Último</th><th></th></tr></thead>
                <tbody>
                  {data.proveedores.map((p) => (
                    <tr key={p.rut_proveedor} className={seleccionado === p.rut_proveedor ? 'active' : ''}>
                      <td style={{ fontFamily: 'monospace' }}>{p.rut_proveedor}</td>
                      <td>{fmtInt(p.n_documentos)}</td>
                      <td>{fmt(p.total_co2e, 2)}</td>
                      <td>{fmtFecha(p.ultimo_documento)}</td>
                      <td><button className="btn btn-sm btn-outline" onClick={() => abrir(p.rut_proveedor)}>Ver</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card card-pad">
          {!seleccionado ? (
            <p className="muted" style={{ fontSize: 13 }}>Selecciona un proveedor para ver el detalle de sus documentos.</p>
          ) : cargandoResumen ? (
            <div style={{ textAlign: 'center', padding: 20 }}><span className="spinner dark" /> Cargando…</div>
          ) : errorResumen ? (
            <div className="badge badge-red" style={{ display: 'block', padding: 12 }}>{errorResumen}</div>
          ) : resumen && (
            <>
              <h3 style={{ marginTop: 0 }}>{resumen.proveedor}</h3>
              <p className="muted" style={{ fontSize: 13 }}>
                {fmtInt(resumen.n_documentos)} documento{resumen.n_documentos === 1 ? '' : 's'} · {fmt(resumen.total_co2e, 2)} t CO2e
              </p>
              <div className="table-scroll">
                <table className="data">
                  <thead><tr><th>Documento</th><th>Categoría</th><th>t CO2e</th><th>Fecha</th></tr></thead>
                  <tbody>
                    {resumen.documentos.map((d, i) => (
                      <tr key={i}>
                        <td>{d.numero_venta}</td>
                        <td>{d.categoria}</td>
                        <td>{fmt(d.total_co2e, 4)}</td>
                        <td>{fmtFecha(d.created_at)}</td>
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
