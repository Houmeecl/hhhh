import { Link } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';
import { Icon } from '../components/icons.jsx';

// Landing pública de Aduana Verde: la red de oficinas físicas de tramitación
// verde que opera con la plataforma sicr3p por dentro. Marca de dos capas:
// "Aduana Verde" grande, "powered by sicr3p" visible.
// Nota de negocio: NO es una integración con el servicio de aduanas ni un
// trámite aduanero oficial — es tramitación verde de documentos comerciales.
export default function AduanaVerde() {
  return (
    <PublicLayout>
      <div className="container">
        <section className="hero">
          <div className="fade-up">
            <span className="badge badge-amber">Red de oficinas en preparación</span>
            <h1 style={{ marginTop: 14 }}>
              Aduana<br />
              Verde<span style={{ color: 'var(--green)' }}>.</span>
            </h1>
            <p className="lead-green">Lo que calculas es lo que compensas.</p>
            <p className="sub">
              Llegas a la oficina con tus facturas y guías, se escanean en el
              terminal, la plataforma sicr3p calcula tus emisiones y pagas la
              compensación de lo calculado. Sales con tu informe y tu etiqueta
              con QR verificable.
            </p>
            <div className="hero-actions">
              <Link to="/pos" className="btn btn-primary">Conocer el terminal</Link>
              <a href="mailto:contacto@sicr3p.cl" className="btn btn-outline">Escríbenos</a>
            </div>
            <p className="muted" style={{ marginTop: 22, fontSize: 14 }}>
              powered by <Link to="/" style={{ color: 'var(--green-600)', fontWeight: 700 }}>sicr3p</Link>
              <br />Tramitación verde de tus documentos comerciales.
            </p>
            <div className="trust-bar">
              <span className="item"><Icon.Building size={17} /> Oficinas físicas</span>
              <span className="item"><Icon.Qr size={17} /> Etiqueta QR verificable</span>
              <span className="item"><Icon.Shield size={17} /> Trazabilidad con cadena de hash</span>
            </div>
          </div>

          {/* Vista previa: lo que pasa dentro de la oficina */}
          <div className="preview-card fade-up d2">
            <div style={{ fontWeight: 700, marginBottom: 4 }}>
              Así es una visita a la oficina.
            </div>
            <div className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
              El mesón recibe tus documentos; el cálculo ocurre en la
              plataforma <b style={{ color: 'var(--green-600)' }}>sicr3p</b>.
            </div>
            <div className="flow">
              <div className="node"><div className="c" style={{ color: 'var(--green-600)' }}><Icon.Doc size={22} /></div><b>1. Documentos</b><span>Facturas y guías</span></div>
              <div className="arrow"><Icon.ArrowRight size={18} /></div>
              <div className="node"><div className="c" style={{ color: 'var(--green-600)' }}><Icon.Cog size={22} /></div><b>2. Cálculo</b><span>Emisiones en t CO2e</span></div>
              <div className="arrow"><Icon.ArrowRight size={18} /></div>
              <div className="node"><div className="c" style={{ color: 'var(--green-600)' }}><Icon.Tag size={22} /></div><b>3. Informe y etiqueta</b><span>Con QR verificable</span></div>
            </div>
            <div className="card card-pad" style={{ boxShadow: 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ color: 'var(--green-600)', display: 'inline-flex' }}><Icon.CreditCard size={18} /></span>
                <b style={{ fontSize: 14 }}>Pagas la compensación de lo calculado</b>
              </div>
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                El cálculo de CO2 es lo que se paga compensar: tarifa
                referencial por t CO2e, según los documentos escaneados en tu
                visita. Sin cobros por adelantado ni suscripciones.
              </p>
            </div>
          </div>
        </section>
      </div>

      <section className="pasos">
        <div className="container">
          <h2>Cómo funciona en la oficina</h2>
          <div className="two-col-grid" style={{ gap: 28 }}>
            <div className="paso">
              <div className="ico" style={{ color: 'var(--green-600)' }}><Icon.Doc size={28} /></div>
              <h3>1. Llegas con tus documentos</h3>
              <p>Facturas y guías de despacho de tu operación, en papel o digitales. Sin preparación previa.</p>
            </div>
            <div className="paso">
              <div className="ico" style={{ color: 'var(--green-600)' }}><Icon.Cog size={28} /></div>
              <h3>2. Se escanean y sicr3p calcula</h3>
              <p>Los documentos se escanean en el terminal; el reconocimiento y el cálculo de emisiones ocurren en la plataforma sicr3p, no en el mesón.</p>
            </div>
            <div className="paso">
              <div className="ico" style={{ color: 'var(--green-600)' }}><Icon.CreditCard size={28} /></div>
              <h3>3. Pagas la compensación</h3>
              <p>Pagas compensar el CO2 calculado, con una tarifa referencial por t CO2e. Eso es todo el modelo: compensas lo que calculas.</p>
            </div>
            <div className="paso">
              <div className="ico" style={{ color: 'var(--green-600)' }}><Icon.Qr size={28} /></div>
              <h3>4. Sales con tu respaldo</h3>
              <p>Informe de tu contabilidad de carbono y etiqueta con QR verificable, con trazabilidad de cadena de hash.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Bloque REP — Ley 20.920 */}
      <div className="container" style={{ padding: '56px 0' }}>
        <div className="two-col-grid" style={{ gap: 28, alignItems: 'stretch' }}>
          <div className="card card-pad">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ color: 'var(--green-600)', display: 'inline-flex' }}><Icon.List size={24} /></span>
              <h3 style={{ margin: 0 }}>Declara tu embalaje en la misma visita</h3>
            </div>
            <p className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
              En la oficina también declaras tus envases y embalajes —
              productos prioritarios de la Ley REP 20.920 — con su porcentaje
              de reciclabilidad, clasificado en tres niveles:
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
              <span className="badge badge-green">Reciclabilidad Alta</span>
              <span className="badge badge-amber">Reciclabilidad Media</span>
              <span className="badge badge-red">Reciclabilidad Baja</span>
            </div>
          </div>
          <div className="card card-pad">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ color: 'var(--green-600)', display: 'inline-flex' }}><Icon.Users size={24} /></span>
              <h3 style={{ margin: 0 }}>Pensado para proveedores</h3>
            </div>
            <p className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
              Si le vendes a mandantes o a grandes compañías que exigen
              información REP y de emisiones a sus proveedores, sales de una
              sola visita con ambas declaraciones respaldadas y verificables.
              Un diferenciador para tu próxima licitación.
            </p>
            <a href="mailto:contacto@sicr3p.cl?subject=Aduana%20Verde%20-%20Declaraci%C3%B3n%20REP" className="btn btn-outline btn-sm">Quiero saber más</a>
          </div>
        </div>
      </div>

      {/* Estado honesto: pre-lanzamiento */}
      <section className="pasos">
        <div className="container">
          <div className="card card-pad" style={{ textAlign: 'center' }}>
            <span className="badge badge-amber">Red de oficinas en preparación</span>
            <h2 style={{ margin: '14px 0 10px', fontSize: 26 }}>Estamos armando la red</h2>
            <p className="muted" style={{ fontSize: 15, lineHeight: 1.6, maxWidth: 560, margin: '0 auto 20px' }}>
              Aduana Verde está en pre-lanzamiento: todavía no publicamos
              direcciones de oficinas. Si quieres operar un punto Aduana Verde
              en tu comuna, o ser cliente fundador cuando abramos, escríbenos.
            </p>
            <div className="hero-actions" style={{ justifyContent: 'center' }}>
              <a href="mailto:contacto@sicr3p.cl?subject=Quiero%20ser%20punto%20Aduana%20Verde" className="btn btn-primary">Quiero ser punto Aduana Verde</a>
              <a href="mailto:contacto@sicr3p.cl?subject=Cliente%20fundador%20Aduana%20Verde" className="btn btn-outline">Quiero ser cliente fundador</a>
            </div>

            {/* Nota de compensación, en el tono ya aprobado del sitio */}
            <div style={{ marginTop: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className="badge badge-gray" style={{ fontSize: 11 }}>Próximamente</span>
              <span className="muted" style={{ fontSize: 12 }}>
                Compensación de carbono vía un socio ambiental acreditado.
              </span>
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 8, maxWidth: 560, marginLeft: 'auto', marginRight: 'auto' }}>
              Aduana Verde no realiza trámites ante el servicio de aduanas ni
              constituye una verificación de tercera parte acreditada: es
              tramitación verde de tus documentos comerciales sobre la
              plataforma sicr3p.
            </p>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
