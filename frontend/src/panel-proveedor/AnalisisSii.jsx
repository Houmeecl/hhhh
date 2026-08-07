import { useEffect, useState } from 'react';
import { api, fmtInt, fmtFecha } from '../api.js';
import { validarRut } from '../lib/rut.js';

// Compras y ventas del proveedor traídas del SII (RCV/DTE) y analizadas.
// El proveedor puede GUARDAR su clave tributaria (cifrada en el servidor)
// para que el botón "descargar" funcione sin reescribirla; o borrarla.
const CLP = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CL')}`;

// Período por defecto: el mes pasado en formato AAAA-MM.
function periodoAnterior() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function AnalisisSii() {
  const [estado, setEstado] = useState(null);
  const [error, setError] = useState('');
  const [periodo, setPeriodo] = useState(periodoAnterior());
  const [rut, setRut] = useState('');
  const [clave, setClave] = useState('');
  const [guardar, setGuardar] = useState(true); // el titular pidió que la clave quede guardada
  const [descargando, setDescargando] = useState(false);
  const [analisis, setAnalisis] = useState(null);
  const [toast, setToast] = useState(null);
  const flash = (msg, err = false) => { setToast({ msg, err }); setTimeout(() => setToast(null), 4000); };

  const cargarEstado = () => api.proveedorSiiEstado().then((d) => {
    setEstado(d);
    if (!rut) setRut(d.credenciales?.rut_sii || d.proveedor?.rut || '');
  });

  useEffect(() => { cargarEstado().catch((e) => setError(e.message)); }, []);

  const guardadas = estado?.credenciales?.guardadas;

  async function descargar(e) {
    e.preventDefault();
    // Si NO hay credenciales guardadas, exigimos clave + RUT válido acá.
    if (!guardadas) {
      if (!clave) { flash('Escribe tu clave tributaria para descargar.', true); return; }
      if (!validarRut(rut)) { flash('El RUT no es válido — revísalo antes de descargar.', true); return; }
    }
    setDescargando(true);
    try {
      const body = guardadas && !clave
        ? { periodo }                                   // usa la clave guardada
        : { periodo, rut, password: clave, guardar };   // clave nueva (y se guarda si corresponde)
      const d = await api.proveedorSiiDescargar(body);
      setClave('');
      setAnalisis(d.analisis);
      flash(`Listo: ${fmtInt(d.documentos)} documentos del período ${d.periodo}.`);
      cargarEstado().catch(() => {});
    } catch (err) {
      flash(err.message, true);
    } finally {
      setDescargando(false);
    }
  }

  async function borrarCredenciales() {
    if (!window.confirm('¿Borrar tu clave guardada? Tendrás que escribirla de nuevo la próxima vez.')) return;
    try {
      await api.proveedorSiiBorrarCredenciales();
      flash('Clave borrada.');
      cargarEstado().catch(() => {});
    } catch (err) { flash(err.message, true); }
  }

  async function verPeriodo(p) {
    setPeriodo(p);
    try { setAnalisis(await api.proveedorSiiAnalisis(p)); }
    catch (err) { flash(err.message, true); }
  }

  if (error) return <div className="badge badge-red" role="alert" style={{ display: 'block', padding: 12 }}>{error}</div>;
  if (!estado) return <div style={{ padding: 40 }}><span className="spinner dark" /> Cargando…</div>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Compras y ventas (SII)</h1>
      <p className="muted" style={{ fontSize: 14, maxWidth: 720 }}>
        Descarga tu Registro de Compras y Ventas del SII y sicr3p lo analiza: resumen del período,
        con quién compras y vendes, y una estimación referencial de emisiones a partir del detalle
        de tus compras.
      </p>

      <div className="card" style={{ marginBottom: 20 }}>
        <form onSubmit={descargar} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Período</label>
            <input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} required />
          </div>
          {guardadas ? (
            <div className="field" style={{ margin: 0 }}>
              <label>Credenciales SII</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 38 }}>
                <span className="badge badge-green">Guardadas ✓</span>
                <span className="muted" style={{ fontSize: 13, fontFamily: 'monospace' }}>{estado.credenciales.rut_sii}</span>
                <button type="button" className="btn btn-outline btn-sm" onClick={borrarCredenciales}>Borrar</button>
              </div>
            </div>
          ) : (
            <>
              <div className="field" style={{ margin: 0 }}>
                <label>RUT que ingresa al SII</label>
                <input value={rut} onChange={(e) => setRut(e.target.value)} placeholder="76000000-0" required />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Clave tributaria</label>
                <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="off" placeholder="••••••••" />
              </div>
            </>
          )}
          <button className="btn btn-primary" type="submit" disabled={descargando}>
            {descargando ? <><span className="spinner" /> Descargando…</> : 'Descargar del SII'}
          </button>
        </form>

        {!guardadas && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginTop: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={guardar} onChange={(e) => setGuardar(e.target.checked)} />
            Guardar mi clave para no escribirla la próxima vez (se guarda cifrada en el servidor).
          </label>
        )}
        <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 8 }}>
          🔒 Tu clave se guarda cifrada y solo se usa para consultar el SII a tu nombre. Puedes borrarla cuando quieras.
        </p>
      </div>

      {estado.periodos?.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
          <span className="muted" style={{ fontSize: 13, alignSelf: 'center' }}>Períodos descargados:</span>
          {estado.periodos.map((p) => (
            <button key={p.periodo} className={`btn btn-sm ${analisis?.periodo === p.periodo ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => verPeriodo(p.periodo)}>
              {p.periodo} ({fmtInt(p.n_docs)})
            </button>
          ))}
        </div>
      )}

      {analisis && <Analisis a={analisis} />}
      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}

function Analisis({ a }) {
  const c = a.resumen.compra, v = a.resumen.venta;
  const em = a.emisiones;
  return (
    <div>
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <div className="stat"><div className="n">{fmtInt(c.n)}</div><div className="l">Documentos de compra</div></div>
        <div className="stat"><div className="n">{CLP(c.total)}</div><div className="l">Total comprado</div></div>
        <div className="stat"><div className="n">{fmtInt(v.n)}</div><div className="l">Documentos de venta</div></div>
        <div className="stat"><div className="n green">{CLP(v.total)}</div><div className="l">Total vendido</div></div>
      </div>

      {em && (
        <div className="card" style={{ marginBottom: 16, borderLeft: '3px solid #f59e0b' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{em.total_co2e_tref} tCO₂e</div>
              <div className="muted" style={{ fontSize: 13 }}>
                Estimación referencial de tus compras — {fmtInt(em.documentos_calculados)} de {fmtInt(em.documentos_totales)} documentos calculados
                {em.metodo_fisico > 0 && ` · ${fmtInt(em.metodo_fisico)} por unidades reales, ${fmtInt(em.metodo_gasto)} por gasto`}
              </div>
            </div>
            <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>referencial — validar</span>
          </div>
          <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 8 }}>
            Calculada extrayendo el detalle de cada compra y corriendo el motor propio (unidades físicas donde el
            documento las trae, gasto si no). Es un orden de magnitud para orientar, no una cifra definitiva ni una certificación.
          </p>
        </div>
      )}

      <ContraparteTabla titulo="Principales proveedores (compras)" filas={a.concentracion.compra} />
      <ContraparteTabla titulo="Principales clientes (ventas)" filas={a.concentracion.venta} />

      <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: 'pointer', fontSize: 14 }}>Ver el detalle de los {fmtInt(a.documentos.length)} documentos</summary>
        <div className="card" style={{ marginTop: 10 }}>
          <div className="table-scroll">
            <table className="data">
              <thead><tr><th>Tipo</th><th>Folio</th><th>Fecha</th><th>Contraparte</th><th style={{ textAlign: 'right' }}>Neto</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>tCO₂e</th></tr></thead>
              <tbody>
                {a.documentos.map((d, i) => (
                  <tr key={i}>
                    <td>{d.tipo === 'compra' ? 'Compra' : 'Venta'}</td>
                    <td style={{ fontFamily: 'monospace' }}>{d.folio}</td>
                    <td>{d.fecha ? fmtFecha(d.fecha) : '—'}</td>
                    <td>{d.razon_social || d.rut_contraparte || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{CLP(d.neto)}</td>
                    <td style={{ textAlign: 'right' }}>{CLP(d.total)}</td>
                    <td style={{ textAlign: 'right' }}>{d.co2e != null ? d.co2e : '—'}</td>
                  </tr>
                ))}
                {a.documentos.length === 0 && (
                  <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 24 }}>Sin documentos en este período.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </div>
  );
}

// Tabla de concentración por contraparte, marcando las que ya están en
// sicr3p (cruce por RUT). Solo un indicador — no expone datos de terceros.
function ContraparteTabla({ titulo, filas }) {
  if (!filas || filas.length === 0) return null;
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h3 style={{ marginTop: 0, fontSize: 15 }}>{titulo}</h3>
      <div className="table-scroll">
        <table className="data">
          <thead><tr><th>Contraparte</th><th>RUT</th><th style={{ textAlign: 'right' }}>Docs</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>%</th><th></th></tr></thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={i}>
                <td>{f.razon_social || '—'}</td>
                <td style={{ fontFamily: 'monospace' }}>{f.rut || '—'}</td>
                <td style={{ textAlign: 'right' }}>{fmtInt(f.n)}</td>
                <td style={{ textAlign: 'right' }}>{CLP(f.total)}</td>
                <td style={{ textAlign: 'right' }}>{f.participacion}%</td>
                <td>{f.en_sicr3p && <span className="badge badge-green" title="Esta contraparte ya está en sicr3p">en sicr3p</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
