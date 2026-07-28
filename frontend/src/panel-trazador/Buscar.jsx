import { useEffect, useState } from 'react';
import { api, fmt, fmtInt, fmtFecha } from '../api.js';

// El trazador solo puede consultar los RUT que el admin le autorizó desde
// Accesos.jsx (whitelist) — por eso esta pantalla no es un buscador libre:
// se elige un RUT de la propia lista y se piden sus cruces (mismo dato que
// ya usa el buscador interno: como cliente sicr3p, quién le emite
// documentos, a quién le emite él).
export default function Buscar() {
  const [permitidos, setPermitidos] = useState(null);
  const [error, setError] = useState('');
  const [seleccionado, setSeleccionado] = useState(null);
  const [cruces, setCruces] = useState(null);
  const [cargandoCruces, setCargandoCruces] = useState(false);
  const [errorCruces, setErrorCruces] = useState('');

  useEffect(() => {
    api.trazadorRutasPermitidas().then(setPermitidos).catch((e) => setError(e.message));
  }, []);

  async function abrir(rut) {
    setSeleccionado(rut);
    setCruces(null);
    setErrorCruces('');
    setCargandoCruces(true);
    try {
      const r = await api.trazadorBuscar(rut);
      setCruces(r.cruces);
    } catch (e) {
      setErrorCruces(e.message);
    } finally {
      setCargandoCruces(false);
    }
  }

  if (error) return <div className="badge badge-red" style={{ display: 'block', padding: 14 }}>{error}</div>;
  if (!permitidos) return <div style={{ padding: 40, textAlign: 'center' }}><span className="spinner dark" /> Cargando…</div>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Hola, {permitidos.trazador.nombre}</h1>
      <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>
        Solo puedes consultar los RUT que el administrador te autorizó.
      </p>

      {permitidos.ruts.length === 0 ? (
        <div className="card card-pad muted" style={{ textAlign: 'center', padding: 40 }}>
          Tu cuenta todavía no tiene RUT autorizados — pide al administrador que te agregue uno desde Accesos.
        </div>
      ) : (
        <div className="two-col-grid" style={{ gap: 16, alignItems: 'flex-start' }}>
          <div className="card card-pad">
            <h3 style={{ marginTop: 0, fontSize: 15 }}>RUT autorizados</h3>
            <div className="table-scroll">
              <table className="data">
                <thead><tr><th>RUT</th><th></th></tr></thead>
                <tbody>
                  {permitidos.ruts.map((rut) => (
                    <tr key={rut} className={seleccionado === rut ? 'active' : ''}>
                      <td style={{ fontFamily: 'monospace' }}>{rut}</td>
                      <td><button className="btn btn-sm btn-outline" onClick={() => abrir(rut)}>Ver cruces</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card card-pad">
            {!seleccionado ? (
              <p className="muted" style={{ fontSize: 13 }}>Selecciona un RUT de tu lista para ver sus cruces.</p>
            ) : cargandoCruces ? (
              <div style={{ textAlign: 'center', padding: 20 }}><span className="spinner dark" /> Cargando…</div>
            ) : errorCruces ? (
              <div className="badge badge-red" style={{ display: 'block', padding: 12 }}>{errorCruces}</div>
            ) : cruces && (
              <>
                <h3 style={{ marginTop: 0, fontFamily: 'monospace' }}>{cruces.rut}</h3>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
                  <div className="card card-pad">
                    <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>Como cliente sicr3p</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--green-600)' }}>{fmtInt(cruces.como_cliente.n_sesiones)}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      sesiones · {fmt(cruces.como_cliente.total_co2e, 2)} t CO2e
                      {cruces.como_cliente.ultima_sesion ? ` · última ${fmtFecha(cruces.como_cliente.ultima_sesion)}` : ''}
                    </div>
                  </div>
                  <div className="card card-pad">
                    <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>Le emiten (recibe de)</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--green-600)' }}>{fmtInt(cruces.recibe_de.length)}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{fmt(cruces.recibe_de.reduce((a, x) => a + (x.total_co2e || 0), 0), 2)} t CO2e</div>
                  </div>
                  <div className="card card-pad">
                    <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>Emite a</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--green-600)' }}>{fmtInt(cruces.emite_a.length)}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{fmt(cruces.emite_a.reduce((a, x) => a + (x.total_co2e || 0), 0), 2)} t CO2e</div>
                  </div>
                </div>

                {cruces.recibe_de.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>Recibe documentos de</div>
                    <div className="table-scroll">
                      <table className="data">
                        <thead><tr><th>RUT emisor</th><th className="num">Docs</th><th className="num">t CO2e</th></tr></thead>
                        <tbody>
                          {cruces.recibe_de.map((p) => (
                            <tr key={p.rut_emisor}><td style={{ fontFamily: 'monospace' }}>{p.rut_emisor}</td><td className="num">{fmtInt(p.n_documentos)}</td><td className="num">{fmt(p.total_co2e, 3)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {cruces.emite_a.length > 0 && (
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>Emite documentos a</div>
                    <div className="table-scroll">
                      <table className="data">
                        <thead><tr><th>RUT receptor</th><th>Empresa</th><th className="num">Docs</th><th className="num">t CO2e</th></tr></thead>
                        <tbody>
                          {cruces.emite_a.map((p) => (
                            <tr key={p.rut_receptor}><td style={{ fontFamily: 'monospace' }}>{p.rut_receptor}</td><td className="muted" style={{ fontSize: 13 }}>{p.empresa || '—'}</td><td className="num">{fmtInt(p.n_documentos)}</td><td className="num">{fmt(p.total_co2e, 3)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {cruces.recibe_de.length === 0 && cruces.emite_a.length === 0 && cruces.como_cliente.n_sesiones === 0 && (
                  <p className="muted" style={{ fontSize: 13 }}>Sin movimientos registrados todavía para este RUT.</p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
