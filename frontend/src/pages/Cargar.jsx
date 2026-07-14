import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';
import { Icon } from '../components/icons.jsx';
import { validarRut, formatearRut } from '../lib/rut.js';
import { api } from '../api.js';

const MAX = 5;
const OK_EXT = /\.(pdf|xml|jpe?g|png)$/i;

export default function Cargar() {
  const nav = useNavigate();
  const inputRef = useRef();
  const [files, setFiles] = useState([]);
  const [form, setForm] = useState({ rut: '', empresa: '', email: '' });
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState('');
  const [procesando, setProcesando] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [estados, setEstados] = useState([]); // estado por factura: 'pendiente'|'procesando'|'listo'
  const [codigoInfo, setCodigoInfo] = useState(null); // código de acceso con créditos (mini sitio)

  useEffect(() => {
    const c = sessionStorage.getItem('sicr3p_codigo');
    if (!c) return;
    api.codigoEstado(c)
      .then(setCodigoInfo)
      .catch(() => sessionStorage.removeItem('sicr3p_codigo'));
  }, []);

  // Con código, el tope es el menor entre 5 y los créditos restantes.
  const maxEfectivo = codigoInfo ? Math.min(MAX, codigoInfo.creditos_restantes) : MAX;

  function addFiles(list) {
    setError('');
    const incoming = Array.from(list).filter((f) => OK_EXT.test(f.name));
    const rejected = Array.from(list).length - incoming.length;
    if (rejected > 0) setError('Algunos archivos no tienen un formato permitido (PDF, XML, JPG, PNG).');
    const combined = [...files, ...incoming];
    if (combined.length > maxEfectivo) {
      setError(codigoInfo && maxEfectivo < MAX
        ? `Tu código tiene ${maxEfectivo} crédito${maxEfectivo === 1 ? '' : 's'} disponibles.`
        : 'Puedes cargar hasta 5 facturas por envío. Contáctanos para más.');
      setFiles(combined.slice(0, maxEfectivo));
    } else {
      setFiles(combined);
    }
  }

  function onDrop(e) {
    e.preventDefault(); setDrag(false);
    addFiles(e.dataTransfer.files);
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
    setEstados(files.map(() => 'pendiente'));

    // Progreso por factura: marca cada una "procesando" y luego "listo" de forma escalonada
    // mientras el backend estructura la información.
    let cursor = 0;
    setEstados((prev) => prev.map((s, i) => (i === 0 ? 'procesando' : s)));
    const timer = setInterval(() => {
      setEstados((prev) => {
        if (cursor >= prev.length) return prev;
        const next = [...prev];
        next[cursor] = 'listo';
        if (cursor + 1 < next.length) next[cursor + 1] = 'procesando';
        cursor += 1;
        return next;
      });
      setProgreso((p) => Math.min(p + 90 / files.length, 90));
    }, 550);

    try {
      const fd = new FormData();
      fd.append('rut', form.rut);
      fd.append('empresa', form.empresa);
      fd.append('email', form.email);
      if (codigoInfo) fd.append('codigo', codigoInfo.codigo);
      files.forEach((f) => fd.append('archivos', f));
      const { sesion } = await api.crearSesion(fd);
      clearInterval(timer);
      setEstados(files.map(() => 'listo'));
      setProgreso(100);
      setTimeout(() => nav(`/resultado/${sesion.id}`), 500);
    } catch (e) {
      clearInterval(timer);
      setError(e.message);
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
            🎟️ Código {codigoInfo.codigo} · {codigoInfo.creditos_restantes} crédito{codigoInfo.creditos_restantes === 1 ? '' : 's'} disponible{codigoInfo.creditos_restantes === 1 ? '' : 's'}
          </div>
        )}

        <div className="card card-pad" style={{ marginTop: 20 }}>
          <div
            className={`dropzone ${drag ? 'drag' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current.click()}
          >
            <div style={{ color: 'var(--green-600)' }}><Icon.Cloud size={44} /></div>
            <div style={{ fontWeight: 700, marginTop: 8 }}>Arrastra y suelta tus archivos aquí</div>
            <div className="muted">o selecciona desde tu dispositivo</div>
            <button className="btn btn-primary" style={{ marginTop: 14 }} type="button">Seleccionar archivos</button>
            <div className="muted" style={{ fontSize: 13, marginTop: 12 }}>Formatos permitidos: PDF, XML, JPG, PNG</div>
            <input
              ref={inputRef} type="file" multiple hidden
              accept=".pdf,.xml,.jpg,.jpeg,.png"
              onChange={(e) => addFiles(e.target.files)}
            />
          </div>

          {files.length > 0 && (
            <div className="file-list">
              {files.map((f, i) => {
                const st = estados[i];
                return (
                  <div className="file-item" key={i}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Icon.Doc size={16} /> {f.name} <span className="muted">· {(f.size / 1024).toFixed(0)} KB</span></span>
                    {procesando ? (
                      st === 'listo' ? <span className="badge badge-green">✓ Listo</span>
                      : st === 'procesando' ? <span className="badge badge-amber"><span className="spinner dark" style={{ width: 12, height: 12, verticalAlign: 'middle' }} /> Procesando…</span>
                      : <span className="badge badge-gray">En espera</span>
                    ) : (
                      <span className="rm" onClick={() => setFiles(files.filter((_, j) => j !== i))}>Quitar</span>
                    )}
                  </div>
                );
              })}
              <div className="muted" style={{ fontSize: 13 }}>{files.length} de {MAX} facturas</div>
            </div>
          )}

          <div className="form-row">
            <div className="field">
              <label>RUT empresa</label>
              <input
                value={form.rut}
                onChange={(e) => setForm({ ...form, rut: e.target.value })}
                onBlur={() => form.rut && validarRut(form.rut) && setForm((f) => ({ ...f, rut: formatearRut(f.rut) }))}
                placeholder="76.123.456-7"
                style={!rutValido ? { borderColor: '#ef4444', outlineColor: '#ef4444' } : {}}
              />
              {!rutValido && <div style={{ color: '#b91c1c', fontSize: 12, marginTop: 4 }}>RUT inválido (dígito verificador)</div>}
              {form.rut && rutValido && <div style={{ color: 'var(--green-600)', fontSize: 12, marginTop: 4 }}>✓ RUT válido</div>}
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

          {error && <div className="badge badge-red" style={{ display: 'block', padding: '10px 14px', marginBottom: 14 }}>{error}</div>}

          {procesando ? (
            <div>
              <div className="progress-row">
                <span className="spinner dark" />
                <div className="progress-bar"><div style={{ width: `${progreso}%` }} /></div>
                <span className="muted" style={{ fontSize: 13, width: 42, textAlign: 'right' }}>{Math.round(progreso)}%</span>
              </div>
              <p className="muted" style={{ fontSize: 13 }}>Procesando tus facturas… estructurando la información.</p>
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
