import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';
import Dropzone from '../components/Dropzone.jsx';
import { Icon } from '../components/icons.jsx';
import { validarRut, formatearRut } from '../lib/rut.js';
import { api, clienteAuth, crearSesionConProgreso } from '../api.js';

const MAX = 5;
const OK_EXT = /\.(pdf|xml|jpe?g|png|heic)$/i;
// Debe calzar con el límite duro del backend (public.js: multer `fileSize`).
const MAX_MB = 15;
const MAX_BYTES = MAX_MB * 1024 * 1024;

export default function Cargar() {
  const nav = useNavigate();
  const [files, setFiles] = useState([]);
  const [form, setForm] = useState({ rut: '', empresa: '', email: '' });
  const [error, setError] = useState('');
  const [procesando, setProcesando] = useState(false);
  // 0-100 de la SUBIDA real (bytes enviados, vía XMLHttpRequest — ver
  // crearSesionConProgreso en api.js). Llega a 100 cuando el navegador
  // terminó de mandar los archivos, no cuando el servidor terminó de leerlos
  // y calcular: esa segunda etapa no es medible sin cambiar cómo se arma la
  // sesión en el backend, así que se muestra aparte como indeterminada
  // (spinner), no con un porcentaje o conteo por documento inventado.
  const [progreso, setProgreso] = useState(0);
  const [terminado, setTerminado] = useState(false); // ya llegó la respuesta del servidor
  const [estados, setEstados] = useState([]); // estado por factura: 'pendiente'|'procesando'|'listo'|'rechazado'
  const [aviso, setAviso] = useState(''); // rechazo parcial: documentos emitidos a otro RUT
  const [codigoInfo, setCodigoInfo] = useState(null); // código de acceso con créditos (mini sitio)
  // Autocompletado por RUT con datos públicos del SII (mismo endpoint y
  // criterio que /inscripcion — el backend consulta BaseAPI con su propia
  // API key, acá nunca hay ninguna clave). Cualquier falla — módulo
  // apagado, RUT sin registro, rate limit — se ignora en silencio: el
  // campo Empresa sigue siendo editable a mano, esto es solo una ayuda.
  const [sii, setSii] = useState(null); // null | 'consultando' | {razonSocial, giro}

  async function consultarSii(rut) {
    if (!validarRut(rut)) { setSii(null); return; }
    setSii('consultando');
    try {
      const { situacion } = await api.consultarRutSiiPublico(rut);
      setSii({ razonSocial: situacion.razonSocial, giro: situacion.actividades?.[0]?.descripcion || null });
      setForm((f) => (f.empresa.trim() ? f : { ...f, empresa: situacion.razonSocial }));
    } catch { setSii(null); }
  }

  useEffect(() => {
    const c = sessionStorage.getItem('sicr3p_codigo');
    // Uso real: la carga exige credencial — un código de acceso o la
    // sesión de un cliente con historial (magic link). Sin ninguna de
    // las dos, la puerta es /prueba (donde se ingresa el código). El
    // backend impone la misma regla (403), esto solo evita el callejón.
    if (!c && !clienteAuth.token) { nav('/prueba'); return; }
    if (!c) return;
    api.codigoEstado(c)
      .then(setCodigoInfo)
      .catch(() => sessionStorage.removeItem('sicr3p_codigo'));
  }, []);

  // Con código, el tope es el menor entre 5 y los créditos restantes.
  const maxEfectivo = codigoInfo ? Math.min(MAX, codigoInfo.creditos_restantes) : MAX;

  // Valida formato y peso ANTES de subir — antes solo el formato se
  // revisaba acá; el peso se descubría recién cuando el backend rechazaba
  // el archivo YA subido entero, con la espera de la subida completa de
  // por medio para nada. Junta todos los problemas encontrados (formato +
  // peso + cupo) en un solo aviso en vez de que uno pise al otro.
  function addFiles(list) {
    const all = Array.from(list);
    const invalidos = all.filter((f) => !OK_EXT.test(f.name));
    const pesados = all.filter((f) => OK_EXT.test(f.name) && f.size > MAX_BYTES);
    const validos = all.filter((f) => OK_EXT.test(f.name) && f.size <= MAX_BYTES);

    const avisos = [];
    if (invalidos.length > 0) {
      avisos.push(`Formato no permitido (${invalidos.map((f) => f.name).join(', ')}). Solo PDF, XML, JPG, PNG o HEIC.`);
    }
    if (pesados.length > 0) {
      avisos.push(`Muy pesado, máx. ${MAX_MB} MB (${pesados.map((f) => f.name).join(', ')}).`);
    }

    const combined = [...files, ...validos];
    if (combined.length > maxEfectivo) {
      avisos.push(codigoInfo && maxEfectivo < MAX
        ? `Tu código tiene ${maxEfectivo} crédito${maxEfectivo === 1 ? '' : 's'} disponibles.`
        : 'Puedes cargar hasta 5 facturas por envío. Contáctanos para más.');
      setFiles(combined.slice(0, maxEfectivo));
    } else {
      setFiles(combined);
    }
    setError(avisos.join(' '));
  }

  const rutValido = form.rut === '' || validarRut(form.rut);

  async function procesar() {
    setError('');
    if (!form.rut || !form.empresa || !form.email) {
      setError('Completa RUT, empresa y email.');
      return;
    }
    if (!validarRut(form.rut)) {
      setError('El RUT no es válido. Revisa el dígito verificador.');
      return;
    }
    if (files.length === 0) { setError('Sube al menos una factura.'); return; }

    setProcesando(true);
    setProgreso(0);
    setTerminado(false);
    setEstados(files.map(() => 'pendiente'));

    try {
      const fd = new FormData();
      fd.append('rut', form.rut);
      fd.append('empresa', form.empresa);
      fd.append('email', form.email);
      if (codigoInfo) fd.append('codigo', codigoInfo.codigo);
      files.forEach((f) => fd.append('archivos', f));
      const { sesion, rechazados = [], aviso: avisoRut } = await crearSesionConProgreso(fd, (pct) => {
        setProgreso(pct);
        // Al llegar al 100% de la subida el servidor recién empieza a leer
        // y calcular — de acá en adelante no hay señal real de avance por
        // archivo, así que todos pasan a "procesando" juntos en vez de ir
        // marcándose uno por uno con un tiempo inventado.
        if (pct >= 100) setEstados((prev) => prev.map(() => 'procesando'));
      });
      // Rechazo PARCIAL: el backend creó la sesión con lo que calza y
      // devuelve los nombres emitidos a otro RUT — se marcan y se da
      // tiempo a leer el aviso antes de pasar al informe.
      setEstados(files.map((f) => (rechazados.includes(f.name) ? 'rechazado' : 'listo')));
      setTerminado(true);
      if (avisoRut) setAviso(avisoRut);
      setTimeout(() => nav(`/resultado/${sesion.id}`), rechazados.length > 0 ? 4500 : 900);
    } catch (e) {
      // e.message ya trae el motivo puntual del backend (RUT no calza,
      // formato rechazado, etc.) salvo cuando el envío ni siquiera llegó a
      // responder (sin conexión, servidor caído) — ahí el navegador tira un
      // "Failed to fetch" en inglés que no le dice nada al usuario.
      setError(e.name === 'TypeError' || e.message === 'Failed to fetch'
        ? 'No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.'
        : e.message);
      setProcesando(false);
    }
  }

  return (
    <PublicLayout>
      <div className="container" style={{ padding: '40px 24px', maxWidth: 820 }}>
        <h1 style={{ fontSize: 34, margin: '0 0 6px' }}>
          Sube los documentos de tu venta y genera tu informe.
        </h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Carga tus documentos y genera tu PDF y tus etiquetas. Máximo {MAX} facturas por envío.
        </p>
        {codigoInfo && (
          <div className="badge badge-green" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px', fontSize: 14 }}>
            <Icon.Tag size={15} /> Código {codigoInfo.codigo} · {codigoInfo.creditos_restantes} crédito{codigoInfo.creditos_restantes === 1 ? '' : 's'} disponible{codigoInfo.creditos_restantes === 1 ? '' : 's'}
          </div>
        )}

        <div className="card card-pad" style={{ marginTop: 20 }}>
          {!procesando && (
            <Dropzone
              onFiles={addFiles}
              hint={`Formatos permitidos: PDF, XML, JPG, PNG o HEIC · máx. ${MAX_MB} MB por archivo`}
            />
          )}

          {files.length > 0 && (
            <div className="file-list">
              {files.map((f, i) => {
                const st = estados[i];
                return (
                  <div className="file-item" key={i}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Icon.Doc size={16} /> {f.name} <span className="muted">· {(f.size / 1024).toFixed(0)} KB</span></span>
                    {procesando ? (
                      st === 'listo' ? <span className="badge badge-green send-check-pop"><Icon.Check size={12} /> Listo</span>
                      : st === 'rechazado' ? <span className="badge badge-red">Emitida a otro RUT — no incluida</span>
                      : st === 'procesando' ? <span className="badge badge-amber"><span className="spinner dark" style={{ width: 12, height: 12, verticalAlign: 'middle' }} /> Procesando…</span>
                      : <span className="badge badge-gray">En espera</span>
                    ) : (
                      <span className="rm" onClick={() => setFiles(files.filter((_, j) => j !== i))}>Quitar</span>
                    )}
                  </div>
                );
              })}
              {!procesando && <div className="muted" style={{ fontSize: 13 }}>{files.length} de {MAX} facturas</div>}
            </div>
          )}

          <div className="form-row">
            <div className="field">
              <label>RUT empresa</label>
              <input
                value={form.rut}
                onChange={(e) => setForm({ ...form, rut: e.target.value })}
                onBlur={() => {
                  if (!form.rut || !validarRut(form.rut)) return;
                  setForm((f) => ({ ...f, rut: formatearRut(f.rut) }));
                  consultarSii(form.rut);
                }}
                placeholder="76.123.456-7"
                style={!rutValido ? { borderColor: '#ef4444', outlineColor: '#ef4444' } : {}}
              />
              {!rutValido && <div style={{ color: '#b91c1c', fontSize: 12, marginTop: 4 }}>RUT inválido (dígito verificador)</div>}
              {form.rut && rutValido && sii === 'consultando' && (
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Consultando el SII…</div>
              )}
              {form.rut && rutValido && sii && sii !== 'consultando' && (
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  Según el SII: <b>{sii.razonSocial}</b>{sii.giro ? ` · ${sii.giro}` : ''}
                </div>
              )}
              {form.rut && rutValido && !sii && (
                <div style={{ color: 'var(--green-600)', fontSize: 12, marginTop: 4 }}>✓ RUT válido</div>
              )}
            </div>
            <div className="field">
              <label>Empresa</label>
              <input value={form.empresa} onChange={(e) => setForm({ ...form, empresa: e.target.value })} placeholder="Mi Empresa SpA" />
            </div>
            <div className="field">
              <label>Email</label>
              <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="contacto@empresa.cl" />
            </div>
          </div>

          {error && (
            <div className="badge badge-red" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 14px', marginBottom: 14 }}>
              <span style={{ flexShrink: 0, marginTop: 1 }}><Icon.Alert size={16} /></span>
              <span>{error}</span>
            </div>
          )}
          {aviso && (
            <div className="badge badge-amber" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 14px', marginBottom: 14 }}>
              <span style={{ flexShrink: 0, marginTop: 1 }}><Icon.Info size={16} /></span>
              <span>{aviso}</span>
            </div>
          )}

          {procesando ? (
            <div className="send-sequence">
              {terminado ? (
                <div className="send-done">
                  <div style={{ color: 'var(--green-600)' }}><Icon.Sparkles size={36} /></div>
                  <div style={{ fontWeight: 800, fontSize: 20, marginTop: 6 }}>¡Todo listo!</div>
                  <p className="muted" style={{ fontSize: 13 }}>Preparando tu resultado…</p>
                </div>
              ) : progreso < 100 ? (
                <>
                  <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>Subiendo tus documentos…</div>
                  <div className="progress-bar" style={{ maxWidth: 320, margin: '0 auto' }}>
                    <div style={{ width: `${progreso}%` }} />
                  </div>
                  <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>{progreso}%</p>
                </>
              ) : (
                <>
                  <span className="spinner dark" style={{ width: 28, height: 28 }} />
                  <p className="muted" style={{ fontSize: 13, marginTop: 14 }}>Estructurando la información…</p>
                </>
              )}
            </div>
          ) : (
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={procesar} disabled={files.length === 0}>
              Procesar {files.length > 0 ? `${files.length} factura${files.length > 1 ? 's' : ''}` : 'facturas'}
            </button>
          )}
        </div>

        <p className="muted" style={{ fontSize: 13, textAlign: 'center', marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Icon.Info size={15} /> El análisis utiliza un motor externo para recopilar y estructurar la información de tus documentos.
        </p>
      </div>
    </PublicLayout>
  );
}
