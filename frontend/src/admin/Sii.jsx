import { useEffect, useState } from 'react';
import { api, fmtInt } from '../api.js';
import { validarRut } from '../lib/rut.js';
import AnalisisSiiVista from '../components/AnalisisSiiVista.jsx';

// Sección admin "SII": las empresas (proveedores) en un solo lugar, con su
// estado SII, alta rápida y el botón GENERAR — el admin ingresa las
// credenciales SII de la empresa EN EL MOMENTO (por-request, nunca se
// guardan desde acá) y sicr3p descarga los DTE del período y calcula todo.
function periodoAnterior() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function Sii() {
  const [empresas, setEmpresas] = useState(null);
  const [seleccion, setSeleccion] = useState(null); // empresa elegida
  const [toast, setToast] = useState(null);
  const [altaOpen, setAltaOpen] = useState(false);
  const flash = (msg, err = false) => { setToast({ msg, err }); setTimeout(() => setToast(null), 4000); };

  const cargar = () => api.adminSiiEmpresas().then((d) => setEmpresas(d.empresas)).catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);

  return (
    <div>
      <div className="admin-head">
        <h1>SII — compras y ventas</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setAltaOpen(true)}>+ Agregar empresa</button>
      </div>
      <p className="muted" style={{ fontSize: 14, maxWidth: 760, marginTop: 0 }}>
        Elige una empresa, ingresa sus credenciales del SII y genera: sicr3p descarga los documentos del
        período, extrae el detalle y calcula la estimación referencial de emisiones. La clave se usa solo
        para esa descarga y no se guarda.
      </p>

      {!empresas ? (
        <div style={{ padding: 40 }}><span className="spinner dark" /> Cargando…</div>
      ) : (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="table-scroll">
            <table className="data">
              <thead><tr><th>Empresa</th><th>RUT</th><th>Credenciales</th><th>Períodos</th><th>Último</th><th></th></tr></thead>
              <tbody>
                {empresas.map((e) => (
                  <tr key={e.id} style={seleccion?.id === e.id ? { background: 'var(--bg)' } : undefined}>
                    <td>{e.nombre_empresa}{!e.activo && <span className="badge badge-red" style={{ marginLeft: 6 }}>inactiva</span>}</td>
                    <td style={{ fontFamily: 'monospace' }}>{e.rut}</td>
                    <td>{e.tiene_credenciales
                      ? <span className="badge badge-green">guardadas por la empresa</span>
                      : <span className="muted" style={{ fontSize: 13 }}>—</span>}</td>
                    <td>{fmtInt(e.n_periodos)}</td>
                    <td style={{ fontFamily: 'monospace' }}>{e.ultimo_periodo || '—'}</td>
                    <td>
                      <button className={`btn btn-sm ${seleccion?.id === e.id ? 'btn-primary' : 'btn-outline'}`}
                        onClick={() => setSeleccion(seleccion?.id === e.id ? null : e)}>
                        {seleccion?.id === e.id ? 'Cerrar' : 'Generar'}
                      </button>
                    </td>
                  </tr>
                ))}
                {empresas.length === 0 && (
                  <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 30 }}>
                    Sin empresas todavía — usa "+ Agregar empresa".
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {seleccion && <GenerarEmpresa key={seleccion.id} empresa={seleccion} flash={flash} onDescargado={cargar} />}

      {altaOpen && (
        <AltaEmpresa
          onClose={() => setAltaOpen(false)}
          onCreada={(emp) => { setAltaOpen(false); cargar(); setSeleccion(emp); flash('Empresa agregada — puedes generar de inmediato.'); }}
          flash={flash}
        />
      )}
      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}

// Formulario de generación para la empresa elegida + análisis resultante.
function GenerarEmpresa({ empresa, flash, onDescargado }) {
  const [periodo, setPeriodo] = useState(periodoAnterior());
  const [rut, setRut] = useState(empresa.rut || '');
  const [clave, setClave] = useState('');
  const [generando, setGenerando] = useState(false);
  const [analisis, setAnalisis] = useState(null);
  const [periodos, setPeriodos] = useState([]);

  useEffect(() => {
    api.adminSiiPeriodos(empresa.id).then((d) => setPeriodos(d.periodos)).catch(() => {});
  }, [empresa.id]);

  async function generar(e) {
    e.preventDefault();
    if (!clave) { flash('Ingresa la clave tributaria de la empresa.', true); return; }
    if (!validarRut(rut)) { flash('El RUT no es válido — revísalo antes de generar.', true); return; }
    setGenerando(true);
    try {
      const d = await api.adminSiiDescargar(empresa.id, { rut, password: clave, periodo });
      setClave(''); // la clave no se retiene
      setAnalisis(d.analisis);
      flash(`Listo: ${fmtInt(d.documentos)} documentos del período ${d.periodo}.`);
      api.adminSiiPeriodos(empresa.id).then((r) => setPeriodos(r.periodos)).catch(() => {});
      onDescargado();
    } catch (err) {
      flash(err.message, true);
    } finally {
      setGenerando(false);
    }
  }

  async function verPeriodo(p) {
    setPeriodo(p);
    try {
      const d = await api.adminSiiAnalisis(empresa.id, p);
      setAnalisis(d.analisis);
    } catch (err) { flash(err.message, true); }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h2 style={{ marginTop: 0, fontSize: 16 }}>{empresa.nombre_empresa} <span className="muted" style={{ fontFamily: 'monospace', fontSize: 13 }}>{empresa.rut}</span></h2>
      <form onSubmit={generar} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ margin: 0 }}>
          <label>Período</label>
          <input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} required />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>RUT que ingresa al SII</label>
          <input value={rut} onChange={(e) => setRut(e.target.value)} placeholder="76000000-0" required />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Clave tributaria (no se guarda)</label>
          <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="off" placeholder="••••••••" />
        </div>
        <button className="btn btn-primary" type="submit" disabled={generando}>
          {generando ? <><span className="spinner" /> Generando…</> : 'Generar'}
        </button>
      </form>
      <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 8 }}>
        🔒 La clave se usa una única vez para esta descarga y se descarta — desde acá nunca se guarda.
      </p>

      {periodos.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
          <span className="muted" style={{ fontSize: 13, alignSelf: 'center' }}>Períodos ya descargados:</span>
          {periodos.map((p) => (
            <button key={p.periodo} className={`btn btn-sm ${analisis?.periodo === p.periodo ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => verPeriodo(p.periodo)}>
              {p.periodo} ({fmtInt(p.n_docs)})
            </button>
          ))}
        </div>
      )}

      {analisis && <div style={{ marginTop: 16 }}><AnalisisSiiVista a={analisis} /></div>}
    </div>
  );
}

// Alta rápida de empresa (proveedor) para poder generar sin salir de acá.
function AltaEmpresa({ onClose, onCreada, flash }) {
  const [nombre, setNombre] = useState('');
  const [rut, setRut] = useState('');
  const [creando, setCreando] = useState(false);

  async function crear() {
    if (!validarRut(rut)) { flash('El RUT no es válido.', true); return; }
    setCreando(true);
    try {
      const r = await api.adminSiiCrearEmpresa({ nombre_empresa: nombre, rut });
      if (r.ya_existia) flash('Ese RUT ya estaba registrado — se abre la empresa existente (no se renombró).');
      onCreada(r.empresa);
    } catch (e) {
      flash(e.message, true);
    } finally {
      setCreando(false);
    }
  }

  return (
    <div className="modal-bg" onClick={(e) => e.target.className === 'modal-bg' && onClose()}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <h2 style={{ marginTop: 0 }}>Agregar empresa</h2>
        <div className="field"><label>Nombre de la empresa</label><input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Empresa SpA" /></div>
        <div className="field" style={{ marginBottom: 14 }}><label>RUT</label><input value={rut} onChange={(e) => setRut(e.target.value)} placeholder="76000000-0" /></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={crear} disabled={creando || !nombre || !rut}>
            {creando ? <span className="spinner" /> : 'Agregar'}
          </button>
          <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
