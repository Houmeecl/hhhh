import { useEffect, useState } from 'react';
import { api, fmtInt } from '../api.js';
import { validarRut } from '../lib/rut.js';
import { normalizarPeriodo, periodoValido } from '../lib/periodo.js';
import AnalisisSiiVista from '../components/AnalisisSiiVista.jsx';

// Sección admin "SII" en DOS pasos:
//   1. Iniciar sesión con la API del SII: RUT + clave tributaria de la
//      PERSONA que ingresa al SII (se validan contra /sii/auth/validar).
//   2. Con la sesión iniciada, elegir/agregar la empresa y GENERAR — la
//      descarga usa las mismas credenciales validadas y el RUT de la
//      empresa sale de la fila de la empresa, nunca del formulario.
// Las credenciales viven SOLO en memoria mientras la pantalla está
// abierta: no se guardan ni acá ni en el servidor.
function periodoAnterior() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function Sii() {
  const [sesion, setSesion] = useState(null); // { rut, password } validados (solo memoria)
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
        Primero inicia sesión con la API del SII (RUT y clave de la persona que ingresa al SII).
        Después elige una empresa y genera: sicr3p descarga los documentos del período, extrae el
        detalle y calcula la estimación referencial de emisiones. La clave se usa solo mientras esta
        pantalla está abierta y no se guarda.
      </p>

      <SesionSii sesion={sesion} onSesion={setSesion} flash={flash} />

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
                        disabled={!sesion && seleccion?.id !== e.id}
                        title={!sesion ? 'Primero inicia sesión con la API del SII' : undefined}
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
          {!sesion && (
            <p className="muted" style={{ fontSize: 13, margin: '10px 4px 0' }}>
              Para generar, primero inicia sesión con la API del SII (arriba).
            </p>
          )}
        </div>
      )}

      {seleccion && sesion && (
        <GenerarEmpresa key={seleccion.id} empresa={seleccion} sesion={sesion} flash={flash} onDescargado={cargar} />
      )}

      {altaOpen && (
        <AltaEmpresa
          onClose={() => setAltaOpen(false)}
          onCreada={(emp) => { setAltaOpen(false); cargar(); setSeleccion(emp); flash(sesion ? 'Empresa agregada — puedes generar de inmediato.' : 'Empresa agregada — inicia sesión con la API del SII para generar.'); }}
          flash={flash}
        />
      )}
      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}

// PASO 1 — iniciar sesión con la API del SII (validar credenciales de la
// persona). Al validar, las credenciales quedan solo en el estado de la
// página para las descargas siguientes.
function SesionSii({ sesion, onSesion, flash }) {
  const [rut, setRut] = useState('');
  const [clave, setClave] = useState('');
  const [validando, setValidando] = useState(false);

  async function iniciar(e) {
    e.preventDefault();
    if (!validarRut(rut)) { flash('El RUT no es válido — es el de la persona que ingresa al SII.', true); return; }
    if (!clave) { flash('Ingresa la clave tributaria.', true); return; }
    setValidando(true);
    try {
      await api.adminSiiSesion({ rut, password: clave });
      onSesion({ rut, password: clave });
      setClave('');
      flash('Sesión SII iniciada — ahora elige una empresa y genera.');
    } catch (err) {
      flash(err.message, true);
    } finally {
      setValidando(false);
    }
  }

  if (sesion) {
    return (
      <div className="card" style={{ marginBottom: 20, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="badge badge-green">Paso 1 listo</span>
        <span>Sesión SII iniciada como <strong style={{ fontFamily: 'monospace' }}>{sesion.rut}</strong></span>
        <span className="muted" style={{ fontSize: 13 }}>La clave queda solo en esta pantalla; al salir se descarta.</span>
        <button className="btn btn-outline btn-sm" style={{ marginLeft: 'auto' }} onClick={() => onSesion(null)}>Cerrar sesión SII</button>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h2 style={{ marginTop: 0, fontSize: 16 }}>Paso 1 — Iniciar sesión con la API del SII</h2>
      <form onSubmit={iniciar} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ margin: 0 }}>
          <label>RUT que ingresa al SII (persona)</label>
          <input value={rut} onChange={(e) => setRut(e.target.value)} placeholder="12345678-9" required />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Clave tributaria (no se guarda)</label>
          <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="off" placeholder="••••••••" required />
        </div>
        <button className="btn btn-primary" type="submit" disabled={validando}>
          {validando ? <><span className="spinner" /> Validando…</> : 'Iniciar sesión SII'}
        </button>
      </form>
      <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 8 }}>
        🔒 Es el RUT de la persona (o representante) que entra al SII con su clave — no el RUT de la
        empresa. Se valida contra el SII antes de habilitar las descargas y no se guarda.
      </p>
      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--muted)' }}>¿El SII rechaza las credenciales?</summary>
        <div className="muted" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.6 }}>
          Para descargar el RCV de una empresa, usa el <strong>RUT de la empresa y su Clave
          Tributaria</strong> (la que abre sesión en sii.cl digitando directo el RUT de la empresa),
          no la clave del representante legal. Si solo tienes la del representante, créale clave a la
          empresa en sii.cl → Servicios Online → «Clave tributaria y representantes electrónicos».
          Otras causas del rechazo: clave provisoria sin cambiar, clave bloqueada por reintentos, o
          RUT mal escrito. Prueba primero entrando a sii.cl con ese RUT y esa clave.
        </div>
      </details>
    </div>
  );
}

// PASO 2 — generación para la empresa elegida + análisis resultante. Usa
// las credenciales ya validadas de la sesión (no se vuelven a pedir).
function GenerarEmpresa({ empresa, sesion, flash, onDescargado }) {
  const [periodo, setPeriodo] = useState(periodoAnterior());
  const [generando, setGenerando] = useState(false);
  const [analisis, setAnalisis] = useState(null);
  const [periodos, setPeriodos] = useState([]);

  useEffect(() => {
    api.adminSiiPeriodos(empresa.id).then((d) => setPeriodos(d.periodos)).catch(() => {});
  }, [empresa.id]);

  async function generar(e) {
    e.preventDefault();
    const p = normalizarPeriodo(periodo);
    if (!periodoValido(p)) { flash('Período inválido: usa AAAA-MM (ej: 2026-06).', true); return; }
    if (p !== periodo) setPeriodo(p);
    setGenerando(true);
    try {
      const d = await api.adminSiiDescargar(empresa.id, { rut: sesion.rut, password: sesion.password, periodo: p });
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
      <h2 style={{ marginTop: 0, fontSize: 16 }}>
        Paso 2 — Generar: {empresa.nombre_empresa} <span className="muted" style={{ fontFamily: 'monospace', fontSize: 13 }}>{empresa.rut}</span>
      </h2>
      <form onSubmit={generar} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ margin: 0 }}>
          <label>Período</label>
          <input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} required />
        </div>
        <button className="btn btn-primary" type="submit" disabled={generando}>
          {generando ? <><span className="spinner" /> Generando…</> : 'Generar'}
        </button>
      </form>
      <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 8 }}>
        Descarga con la sesión SII de <span style={{ fontFamily: 'monospace' }}>{sesion.rut}</span>; el RUT de la
        empresa consultada es el registrado ({empresa.rut}).
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
