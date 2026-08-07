import { useEffect, useState } from 'react';
import { api, fmtInt } from '../api.js';
import { validarRut } from '../lib/rut.js';
import { normalizarPeriodo, periodoValido } from '../lib/periodo.js';
import AnalisisSiiVista from '../components/AnalisisSiiVista.jsx';

// Compras y ventas del proveedor traídas del SII (RCV/DTE) y analizadas.
// El proveedor puede GUARDAR su clave tributaria (cifrada en el servidor)
// para que el botón "descargar" funcione sin reescribirla; o borrarla.
// La vista del análisis vive en components/AnalisisSiiVista.jsx (compartida
// con la sección admin "SII").

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
    const p = normalizarPeriodo(periodo);
    if (!periodoValido(p)) { flash('Período inválido: usa AAAA-MM (ej: 2026-06).', true); return; }
    if (p !== periodo) setPeriodo(p);
    await bajarPeriodo(p);
  }

  // Baja (o vuelve a bajar) un período. Se comparte con el botón de
  // reclasificación: volver a descargar es exactamente la misma operación —
  // el UPSERT del backend es idempotente y repuebla `categoria`.
  async function bajarPeriodo(p) {
    // Si NO hay credenciales guardadas, exigimos clave + RUT válido acá.
    if (!guardadas) {
      if (!clave) { flash('Escribe tu clave tributaria para descargar.', true); return; }
      if (!validarRut(rut)) { flash('El RUT no es válido — revísalo antes de descargar.', true); return; }
    }
    setDescargando(true);
    try {
      const body = guardadas && !clave
        ? { periodo: p }                                   // usa la clave guardada
        : { periodo: p, rut, password: clave, guardar };   // clave nueva (y se guarda si corresponde)
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

  // Solo se ofrece volver a bajar el período por los documentos que la bajada
  // SÍ arregla: los anteriores a la clasificación por alcance, sin versión del
  // motor estampada. No se pueden reclasificar desde la base — el RCV nunca
  // guardó los ítems — así que volver a bajarlos es la única salida.
  // Los demás motivos (clasificado por el nombre del proveedor, sin
  // coincidencia en el motor, nota de crédito) NO cuentan acá: volver a
  // bajarlos da el mismo resultado y el botón sería una promesa falsa.
  //
  // Y aun con documentos así, el botón exige que el proveedor de datos del SII
  // activo PUEDA traer el detalle. Con simpleapi o apigateway no puede: volver
  // a bajar mueve esos documentos de "descargados antes" a "clasificados por
  // el nombre del proveedor", el contador baja a cero, el alcance sigue sin
  // existir, y el usuario queda creyendo que lo arregló.
  const puedeReintentar = analisis?.proveedor_sii?.puede_traer_detalle === true;
  const sinClasificar = puedeReintentar
    ? (analisis?.emisiones?.por_alcance?.sin_clasificar?.descarga_antigua || 0)
    : 0;

  if (error) return <div className="badge badge-red" role="alert" style={{ display: 'block', padding: 12 }}>{error}</div>;
  if (!estado) return <div style={{ padding: 40 }}><span className="spinner dark" /> Cargando…</div>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Compras y ventas (SII)</h1>
      <p className="muted" style={{ fontSize: 14, maxWidth: 720 }}>
        Descarga tu Registro de Compras y Ventas del SII y sicr3p lo analiza: resumen del período,
        con quién compras y vendes, y tu contabilidad de carbono a partir del detalle de tus compras.
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
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--muted)' }}>¿El SII rechaza tu clave?</summary>
          <div className="muted" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.6 }}>
            Usa el <strong>RUT de tu empresa y su Clave Tributaria</strong> (la que abre sesión en
            sii.cl digitando directo el RUT de la empresa), no la del representante legal. Si solo
            tienes la del representante, crea la clave de la empresa en sii.cl → Servicios Online →
            «Clave tributaria y representantes electrónicos». Revisa también que la clave no sea
            provisoria ni esté bloqueada: prueba primero entrando a sii.cl.
          </div>
        </details>
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

      {analisis && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 8 }}>
            {sinClasificar > 0 && (
              <button className="btn btn-outline btn-sm" disabled={descargando}
                onClick={() => { setPeriodo(analisis.periodo); bajarPeriodo(analisis.periodo); }}
                title="Los documentos sin clasificar se bajaron antes de que existiera el desglose por alcance. Al volver a bajarlos, el motor los clasifica.">
                {descargando ? <><span className="spinner dark" /> Descargando…</> : `Clasificar ${fmtInt(sinClasificar)} documento${sinClasificar === 1 ? '' : 's'} sin alcance`}
              </button>
            )}
            <button className="btn btn-outline btn-sm"
              onClick={() => api.descargarProveedorInformeCarbonoPdf(analisis.periodo).catch((e) => flash(e.message, true))}>
              Descargar informe (PDF)
            </button>
          </div>
          <AnalisisSiiVista a={analisis} />
        </div>
      )}
      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}
