import { useEffect, useState } from 'react';
import { api, fmtInt } from '../api.js';
import { validarRut, formatearRut } from '../lib/rut.js';
import { normalizarPeriodo, periodoValido } from '../lib/periodo.js';
import AnalisisSiiVista from '../components/AnalisisSiiVista.jsx';

// Sección admin "SII": elegir una empresa y GENERAR en un solo paso. La
// primera vez pide las credenciales que inician sesión en el SII — lo
// recomendado es el RUT de la EMPRESA con su propia Clave Tributaria
// (ver deploy/SII-CREDENCIALES.md); un RUT de persona solo sirve si esa
// persona representa electrónicamente a la empresa en el SII. Se validan
// y quedan en memoria mientras la pantalla está abierta; desde la segunda
// empresa en adelante, "Generar" descarga directo, sin volver a pedirlas.
// El RUT de la empresa consultada sale de la fila, nunca del formulario.
// Las credenciales no se guardan ni acá ni en el servidor.
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
        Elige una empresa y presiona Generar: sicr3p descarga los documentos del período, extrae el
        detalle y genera la contabilidad de carbono. La primera vez te pide el RUT y la Clave
        Tributaria con que se entra al SII (lo recomendado: los de la empresa); el resto de las
        empresas se generan directo, sin volver a pedirla.
      </p>

      {sesion && (
        <div className="card" style={{ marginBottom: 20, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>Conectado al SII como <strong style={{ fontFamily: 'monospace' }}>{formatearRut(sesion.rut)}</strong></span>
          <span className="muted" style={{ fontSize: 13 }}>La clave queda solo en esta pantalla; al salir se descarta.</span>
          <button className="btn btn-outline btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setSesion(null)}>Usar otra cuenta SII</button>
        </div>
      )}

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
                    <td style={{ fontFamily: 'monospace' }}>{formatearRut(e.rut)}</td>
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

      {seleccion && (
        <GenerarEmpresa key={seleccion.id} empresa={seleccion} sesion={sesion} onSesion={setSesion} flash={flash} onDescargado={cargar} />
      )}

      {altaOpen && (
        <AltaEmpresa
          onClose={() => setAltaOpen(false)}
          onCreada={(emp) => { setAltaOpen(false); cargar(); setSeleccion(emp); flash('Empresa agregada — presiona Generar para descargar su período.'); }}
          flash={flash}
        />
      )}
      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}

// Generar para la empresa elegida + análisis resultante, en un solo paso.
// Si no hay sesión SII activa todavía, el mismo formulario pide RUT y
// clave tributaria y, al enviar, valida y descarga en una sola acción
// (sin un botón "Iniciar sesión" separado). Una vez validada, la sesión
// se reutiliza para el resto de las empresas.
function GenerarEmpresa({ empresa, sesion, onSesion, flash, onDescargado }) {
  const [periodo, setPeriodo] = useState(periodoAnterior());
  const [rut, setRut] = useState('');
  const [clave, setClave] = useState('');
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

    let activa = sesion;
    if (!activa) {
      if (!validarRut(rut)) { flash('El RUT no es válido — revisa el dígito verificador (ej: 76520943-9).', true); return; }
      if (!clave) { flash('Ingresa la clave tributaria.', true); return; }
      activa = { rut, password: clave };
    }

    setGenerando(true);
    try {
      if (!sesion) await api.adminSiiSesion({ rut: activa.rut, password: activa.password });
      const d = await api.adminSiiDescargar(empresa.id, { rut: activa.rut, password: activa.password, periodo: p });
      if (!sesion) { onSesion(activa); setClave(''); }
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
        Generar: {empresa.nombre_empresa} <span className="muted" style={{ fontFamily: 'monospace', fontSize: 13 }}>{formatearRut(empresa.rut)}</span>
      </h2>
      <form onSubmit={generar} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {!sesion && (
          <>
            <div className="field" style={{ margin: 0 }}>
              <label>RUT que inicia sesión en el SII</label>
              <input value={rut} onChange={(e) => setRut(e.target.value)} placeholder="76520943-9" required />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Clave tributaria (no se guarda)</label>
              <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="off" placeholder="••••••••" required />
            </div>
          </>
        )}
        <div className="field" style={{ margin: 0 }}>
          <label>Período</label>
          <input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} required />
        </div>
        <button className="btn btn-primary" type="submit" disabled={generando}>
          {generando ? <><span className="spinner" /> Generando…</> : 'Generar'}
        </button>
      </form>
      {!sesion ? (
        <>
          <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 8 }}>
            🔒 Lo recomendado es el <strong>RUT de la empresa con su propia Clave Tributaria</strong> (la
            que abre sesión en sii.cl digitando directo el RUT de la empresa). Un RUT de persona solo
            funciona si representa electrónicamente a la empresa en el SII. Se valida y descarga en un
            solo paso; la clave no se guarda.
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
        </>
      ) : (
        <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 8 }}>
          Descarga con la sesión SII de <span style={{ fontFamily: 'monospace' }}>{formatearRut(sesion.rut)}</span>; el RUT de la
          empresa consultada es el registrado ({formatearRut(empresa.rut)}).
        </p>
      )}

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

      {analisis && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button className="btn btn-outline btn-sm"
              onClick={() => api.descargarInformeCarbonoPdf(empresa.id, analisis.periodo).catch((e) => flash(e.message, true))}>
              Descargar informe (PDF)
            </button>
          </div>
          {/* El admin mira la empresa de OTRO: el texto no le habla en
              imperativo ("vuelve a descargar") como al dueño del período. */}
          <AnalisisSiiVista a={analisis} esPropio={false} />
        </div>
      )}

      <ContratoEmpresa empresa={empresa} flash={flash} />
    </div>
  );
}

// Contrato de servicio de la empresa: verlo, emitirlo si no existe,
// descargarlo. Mismo documento comercial que ya existe para clientes y
// auspiciadores (services/contrato.js); acá cuelga de la empresa (proveedor).
function ContratoEmpresa({ empresa, flash }) {
  const [contrato, setContrato] = useState(null); // undefined mientras carga, null sin contrato
  const [emitiendo, setEmitiendo] = useState(false);

  useEffect(() => {
    setContrato(undefined);
    api.adminSiiContrato(empresa.id).then((d) => setContrato(d.contrato)).catch((e) => flash(e.message, true));
  }, [empresa.id]);

  async function emitir() {
    setEmitiendo(true);
    try {
      const d = await api.adminSiiEmitirContrato(empresa.id);
      setContrato(d.contrato);
      flash('Contrato emitido en borrador.');
    } catch (e) { flash(e.message, true); } finally { setEmitiendo(false); }
  }

  if (contrato === undefined) return null;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3 style={{ marginTop: 0, fontSize: 15 }}>Contrato</h3>
      {contrato ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className={`badge ${contrato.estado === 'aceptado' ? 'badge-green' : 'badge-amber'}`}>{contrato.estado}</span>
          <span className="muted" style={{ fontSize: 13 }}>{contrato.numero}</span>
          <button className="btn btn-outline btn-sm" onClick={() => api.abrirSiiContratoPdf(empresa.id).catch((e) => flash(e.message, true))}>
            Descargar PDF
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className="muted" style={{ fontSize: 13 }}>Esta empresa todavía no tiene contrato.</span>
          <button className="btn btn-primary btn-sm" onClick={emitir} disabled={emitiendo}>
            {emitiendo ? <><span className="spinner" /> Emitiendo…</> : 'Emitir contrato'}
          </button>
        </div>
      )}
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
