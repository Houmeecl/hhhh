import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';
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

  function addFiles(list) {
    setError('');
    const incoming = Array.from(list).filter((f) => OK_EXT.test(f.name));
    const rejected = Array.from(list).length - incoming.length;
    if (rejected > 0) setError('Algunos archivos no tienen un formato permitido (PDF, XML, JPG, PNG).');
    const combined = [...files, ...incoming];
    if (combined.length > MAX) {
      setError('La demo permite hasta 5 facturas. Contáctanos para más.');
      setFiles(combined.slice(0, MAX));
    } else {
      setFiles(combined);
    }
  }

  function onDrop(e) {
    e.preventDefault(); setDrag(false);
    addFiles(e.dataTransfer.files);
  }

  async function procesar() {
    setError('');
    if (!form.rut || !form.empresa || !form.email) {
      setError('Completa RUT, empresa y email.');
      return;
    }
    if (files.length === 0) { setError('Sube al menos una factura.'); return; }

    setProcesando(true);
    // Progreso simulado por factura mientras el backend procesa.
    setProgreso(0);
    const timer = setInterval(() => setProgreso((p) => Math.min(p + 100 / (files.length * 4), 92)), 220);

    try {
      const fd = new FormData();
      fd.append('rut', form.rut);
      fd.append('empresa', form.empresa);
      fd.append('email', form.email);
      files.forEach((f) => fd.append('archivos', f));
      const { sesion } = await api.crearSesion(fd);
      setProgreso(100);
      clearInterval(timer);
      setTimeout(() => nav(`/resultado/${sesion.id}`), 400);
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
          <b style={{ color: 'var(--green-600)' }}>Etapa 1:</b> carga simple para generar tu PDF y tus etiquetas. Máximo {MAX} facturas por sesión.
        </p>

        <div className="card card-pad" style={{ marginTop: 20 }}>
          <div
            className={`dropzone ${drag ? 'drag' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current.click()}
          >
            <div className="cloud">☁️⬆️</div>
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
              {files.map((f, i) => (
                <div className="file-item" key={i}>
                  <span>📄 {f.name} <span className="muted">· {(f.size / 1024).toFixed(0)} KB</span></span>
                  {!procesando && (
                    <span className="rm" onClick={() => setFiles(files.filter((_, j) => j !== i))}>Quitar</span>
                  )}
                </div>
              ))}
              <div className="muted" style={{ fontSize: 13 }}>{files.length} de {MAX} facturas</div>
            </div>
          )}

          <div className="form-row">
            <div className="field">
              <label>RUT empresa</label>
              <input value={form.rut} onChange={(e) => setForm({ ...form, rut: e.target.value })} placeholder="76.123.456-7" />
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

        <p className="muted" style={{ fontSize: 13, textAlign: 'center', marginTop: 16 }}>
          ℹ️ El análisis utiliza un motor externo para recopilar y estructurar la información de tus documentos.
        </p>
      </div>
    </PublicLayout>
  );
}
