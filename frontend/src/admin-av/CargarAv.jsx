import { useState } from 'react';
import Dropzone from '../components/Dropzone.jsx';
import DeclaracionEmbalaje from '../components/DeclaracionEmbalaje.jsx';
import CompensacionCobro from '../components/CompensacionCobro.jsx';
import { Icon } from '../components/icons.jsx';
import { validarRut, formatearRut } from '../lib/rut.js';
import { api, fmt } from '../api.js';

const MAX = 5;
const OK_EXT = /\.(pdf|xml|jpe?g|png|heic)$/i;

// Imprime el sticker (etiqueta PDF con QR) directo al diálogo de impresión
// del sistema — sirve para la impresora térmica de adhesivos configurada
// como impresora normal. Si el navegador bloquea el print del iframe, se
// abre el PDF en una pestaña para imprimir desde ahí.
function imprimirSticker(facturaId) {
  const url = api.etiquetaUrl(facturaId);
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = url;
  iframe.onload = () => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch {
      window.open(url, '_blank', 'noopener');
    }
    setTimeout(() => iframe.remove(), 60000);
  };
  document.body.appendChild(iframe);
}

// Barra de pasos del flujo tras procesar un trámite: Trámite → REP →
// Compensación. Puramente informativa (no bloquea nada: ambos pasos son
// opcionales) — comunica que son 3 etapas de la misma secuencia.
function PasoBadge({ n, label, hecho }) {
  return (
    <span className={`badge ${hecho ? 'badge-green' : 'badge-gray'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {hecho ? <Icon.Check size={13} /> : n} {label}
    </span>
  );
}

// Mostrador presencial de sicr3p: el cliente entrega sus documentos (papel →
// escáner, o digitales) y el sistema los lee y calcula solo — aquí no se
// digita ningún dato del documento. Si un archivo no se puede leer
// automáticamente, el servidor rechaza el envío completo y se vuelve a
// escanear: no existe corrección manual.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function CargarAv() {
  const [files, setFiles] = useState([]);
  const [form, setForm] = useState({ rut: '', empresa: '', email: '' });
  const [error, setError] = useState('');
  const [rechazados, setRechazados] = useState([]); // nombres de archivos ilegibles (422)
  const [procesando, setProcesando] = useState(false);
  const [resultado, setResultado] = useState(null); // { sesion, facturas }
  const [envio, setEnvio] = useState(null); // comprobante por correo: null | 'enviando' | 'ok' | 'error'
  const [embComponentes, setEmbComponentes] = useState([]);
  const [embalajeGuardado, setEmbalajeGuardado] = useState(null);
  const [compensacion, setCompensacion] = useState(null);

  const rutValido = form.rut === '' || validarRut(form.rut);
  const emailValido = form.email === '' || EMAIL_RE.test(form.email);
  const listoParaProcesar = files.length > 0 && form.rut && form.empresa && form.email
    && validarRut(form.rut) && EMAIL_RE.test(form.email);

  function addFiles(list) {
    setError('');
    const nuevos = Array.from(list).filter((f) => OK_EXT.test(f.name));
    if (nuevos.length < list.length) setError('Algunos archivos no tienen un formato permitido (PDF, XML, JPG, PNG, HEIC).');
    const todos = [...files, ...nuevos];
    if (todos.length > MAX) setError(`Máximo ${MAX} documentos por trámite.`);
    setFiles(todos.slice(0, MAX));
  }

  async function procesar() {
    setError('');
    setRechazados([]);
    if (!form.rut || !form.empresa || !form.email) { setError('Completa RUT, empresa y email del cliente.'); return; }
    if (!validarRut(form.rut)) { setError('El RUT no es válido. Revisa el dígito verificador.'); return; }
    if (!EMAIL_RE.test(form.email)) { setError('El email del cliente no es válido.'); return; }
    if (files.length === 0) { setError('Escanea o carga al menos un documento.'); return; }
    setProcesando(true);
    try {
      const fd = new FormData();
      fd.append('rut', form.rut);
      fd.append('empresa', form.empresa);
      fd.append('email', form.email);
      files.forEach((f) => fd.append('archivos', f));
      setResultado(await api.crearSesion(fd));
    } catch (e) {
      setError(e.message);
      // El 422 lista TODOS los ilegibles del lote: se marcan en rojo para
      // re-escanear solo esos y reintentar el envío completo.
      setRechazados(e.data?.rechazados || []);
    } finally {
      setProcesando(false);
    }
  }

  function nuevoTramite() {
    setResultado(null); setFiles([]); setForm({ rut: '', empresa: '', email: '' }); setError(''); setEnvio(null);
    setEmbComponentes([]); setEmbalajeGuardado(null); setCompensacion(null);
  }

  async function enviarCorreo() {
    setEnvio('enviando');
    try {
      const r = await api.enviarComprobanteCorreo(resultado.sesion.id);
      setEnvio(r?.ok ? 'ok' : 'error');
    } catch {
      setEnvio('error');
    }
  }

  if (resultado) {
    const { sesion, facturas = [] } = resultado;
    return (
      <div>
        <div className="admin-head"><h1>Trámite procesado</h1></div>

        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--green-600)', display: 'inline-flex' }}><Icon.CheckCircle size={28} /></span>
            <div>
              <b>{sesion.nombre_cliente}</b> · <span className="muted">{sesion.rut_cliente}</span>
              <div className="muted" style={{ fontSize: 13 }}>
                {facturas.length} documento{facturas.length === 1 ? '' : 's'} · <b>{fmt(sesion.total_co2e, 3)} t CO2e</b>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14, alignItems: 'center' }}>
            <a className="btn btn-outline btn-sm" href={api.informeUrl(sesion.id)} target="_blank" rel="noreferrer">
              <Icon.Download size={15} /> Informe (PDF)
            </a>
            <a className="btn btn-outline btn-sm" href={api.carpetaUrl(sesion.id)} target="_blank" rel="noreferrer">
              <Icon.Download size={15} /> Carpeta de evidencia
            </a>
            <button className="btn btn-outline btn-sm" onClick={enviarCorreo} disabled={envio === 'enviando' || envio === 'ok'}>
              {envio === 'enviando' ? <span className="spinner dark" style={{ width: 13, height: 13 }} />
                : envio === 'ok' ? <><Icon.Check size={15} /> Enviado a {sesion.email_cliente}</>
                : 'Enviar comprobante por correo'}
            </button>
            <button className="btn btn-primary btn-sm" onClick={nuevoTramite}>Nuevo trámite</button>
          </div>
          {envio === 'error' && (
            <div className="badge badge-red" style={{ display: 'inline-block', padding: '8px 12px', marginTop: 10 }}>
              No se pudo enviar el correo. Puedes reintentar o entregar el informe descargado.
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '0 0 4px' }}>
          <PasoBadge n={1} label="Trámite" hecho />
          <span className="muted">→</span>
          <PasoBadge n={2} label="REP" hecho={!!embalajeGuardado} />
          <span className="muted">→</span>
          <PasoBadge n={3} label="Compensación" hecho={!!compensacion} />
        </div>

        <DeclaracionEmbalaje
          sesionId={sesion.id}
          componentes={embComponentes} setComponentes={setEmbComponentes}
          guardada={embalajeGuardado}
          onGuardada={setEmbalajeGuardado}
          onModificar={() => setEmbalajeGuardado(null)}
        />

        <CompensacionCobro
          sesionId={sesion.id}
          totalCo2e={sesion.total_co2e}
          compensacion={compensacion}
          onCompensacion={setCompensacion}
        />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14, marginTop: 16 }}>
          {facturas.map((f) => (
            <div className="card card-pad" key={f.id} style={{ textAlign: 'center' }}>
              <b style={{ fontSize: 14 }}>{f.numero_venta || f.archivo_original}</b>
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                {f.categoria} · {fmt(f.total_co2e, 4)} t CO2e
              </div>
              <img src={api.qrUrl(f.id)} alt={`QR de verificación del documento ${f.numero_venta || f.id}`}
                width={120} height={120}
                style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 6, background: '#fff' }} />
              <div style={{ marginTop: 10 }}>
                <button className="btn btn-primary btn-sm" onClick={() => imprimirSticker(f.id)}>
                  <Icon.Printer size={15} /> Imprimir sticker
                </button>
              </div>
              {f.eslabon != null && (
                <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
                  Eslabón #{f.eslabon} · sellado en la cadena de integridad
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="admin-head">
        <div>
          <h1 style={{ margin: 0 }}>Cargar documento</h1>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>
            El cliente entrega sus documentos (escáner, archivo o foto) y el sistema los lee y calcula solo.
            Si un documento no se puede leer, se rechaza y se vuelve a escanear — aquí no se digitan datos.
          </p>
        </div>
      </div>

      <div className="card card-pad" style={{ maxWidth: 760 }}>
        <div className="form-row">
          <div className="field">
            <label>RUT empresa</label>
            <input value={form.rut}
              onChange={(e) => setForm({ ...form, rut: e.target.value })}
              onBlur={() => form.rut && validarRut(form.rut) && setForm((f) => ({ ...f, rut: formatearRut(f.rut) }))}
              placeholder="76.123.456-7"
              style={!rutValido ? { borderColor: '#ef4444' } : {}} />
            {!rutValido && <div style={{ color: '#b91c1c', fontSize: 12, marginTop: 4 }}>RUT inválido (dígito verificador)</div>}
          </div>
          <div className="field">
            <label>Empresa</label>
            <input value={form.empresa} onChange={(e) => setForm({ ...form, empresa: e.target.value })} placeholder="Mi Empresa SpA" />
          </div>
          <div className="field">
            <label>Email del cliente</label>
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="contacto@empresa.cl"
              style={!emailValido ? { borderColor: '#ef4444' } : {}} />
            {!emailValido && <div style={{ color: '#b91c1c', fontSize: 12, marginTop: 4 }}>Email inválido</div>}
          </div>
        </div>

        {!procesando && <Dropzone onFiles={addFiles} />}

        {files.length > 0 && (
          <div className="file-list">
            {files.map((f, i) => (
              <div className="file-item" key={i}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <Icon.Doc size={16} /> {f.name} <span className="muted">· {(f.size / 1024).toFixed(0)} KB</span>
                  {rechazados.includes(f.name) && <span className="badge badge-red">Ilegible — re-escanear</span>}
                </span>
                {procesando
                  ? <span className="badge badge-amber"><span className="spinner dark" style={{ width: 12, height: 12, verticalAlign: 'middle' }} /> Leyendo…</span>
                  : <span className="rm" onClick={() => setFiles(files.filter((_, j) => j !== i))}>Quitar</span>}
              </div>
            ))}
            <div className="muted" style={{ fontSize: 13 }}>{files.length} de {MAX} documentos</div>
          </div>
        )}

        {error && <div className="badge badge-red" style={{ display: 'block', padding: '10px 14px', margin: '12px 0' }}>{error}</div>}

        <button className="btn btn-primary" style={{ width: '100%', marginTop: 12 }} onClick={procesar} disabled={procesando || !listoParaProcesar}>
          {procesando ? <span className="spinner" /> : `Procesar ${files.length > 0 ? `${files.length} documento${files.length > 1 ? 's' : ''}` : 'documentos'}`}
        </button>
      </div>
    </div>
  );
}
