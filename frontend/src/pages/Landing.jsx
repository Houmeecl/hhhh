import { Link } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';

export default function Landing() {
  return (
    <PublicLayout>
      <div className="container">
        <section className="hero">
          <div>
            <h1>
              Contabilidad<br />
              Trazabilidad<span style={{ color: 'var(--green)' }}>.</span>
            </h1>
            <p className="lead-green">Controla. Traza. Decide.</p>
            <p className="sub">
              sicr3p te ayuda a registrar tus operaciones, darles trazabilidad y
              generar informes confiables de tu contabilidad de carbono.
            </p>
            <div className="hero-actions">
              <Link to="/cargar" className="btn btn-primary">Comienza ahora</Link>
              <a href="mailto:contacto@sicr3p.cl" className="btn btn-outline">Contáctanos</a>
            </div>
            <p className="muted" style={{ marginTop: 22, fontSize: 14 }}>
              Sube tus facturas, descarga tu contabilidad de carbono.
              <br />Tu contabilidad, tu trazabilidad.
            </p>
          </div>

          {/* Vista previa de la app */}
          <div className="preview-card">
            <div style={{ fontWeight: 700, marginBottom: 4 }}>
              Sube los documentos de tu venta y genera tu informe.
            </div>
            <div className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
              <b style={{ color: 'var(--green-600)' }}>Etapa 1:</b> carga simple para generar PDF y etiqueta.
            </div>
            <div className="dropzone" style={{ padding: '28px 16px' }}>
              <div className="cloud">☁️⬆️</div>
              <div style={{ fontWeight: 600, marginTop: 6 }}>Arrastra y suelta tus archivos aquí</div>
              <div className="muted" style={{ fontSize: 13 }}>Formatos: PDF, XML, JPG, PNG</div>
            </div>
            <div className="flow">
              <div className="node"><div className="c">📄</div><b>1. Carga documentos</b><span>Sube tus facturas</span></div>
              <div className="arrow">→</div>
              <div className="node"><div className="c">⚙️</div><b>2. Procesamiento</b><span>Analizamos la información</span></div>
              <div className="arrow">→</div>
              <div className="node"><div className="c">🧾</div><b>3. PDF y etiqueta</b><span>Con trazabilidad</span></div>
            </div>
          </div>
        </section>
      </div>

      <section className="pasos">
        <div className="container">
          <h2>En 3 simples pasos</h2>
          <div className="pasos-grid">
            <div className="paso">
              <div className="ico">☁️</div>
              <h3>1. Sube tus documentos</h3>
              <p>Facturas, guías, órdenes de compra y más, en los formatos admitidos.</p>
            </div>
            <div className="paso">
              <div className="ico">📊</div>
              <h3>2. Generamos tu informe</h3>
              <p>Organizamos tu información y estructuramos los datos clave de tu contabilidad de carbono.</p>
            </div>
            <div className="paso">
              <div className="ico">✅</div>
              <h3>3. Obtén trazabilidad</h3>
              <p>Visualiza y descarga tu informe PDF y tus etiquetas con QR verificable.</p>
            </div>
          </div>
          <div style={{ textAlign: 'center', marginTop: 36 }}>
            <Link to="/cargar" className="btn btn-primary">Comienza ahora</Link>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
