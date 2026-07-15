import { Link } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';
import { Icon } from '../components/icons.jsx';

// Landing pública de Aduana Verde: la red de oficinas físicas de tramitación
// verde que opera con la plataforma sicr3p por dentro. Marca de dos capas:
// "Aduana Verde" grande, "by sicr3p" visible y elegante.
// Nota de negocio: NO es una integración con el servicio de aduanas ni un
// trámite aduanero oficial — es tramitación verde de documentos comerciales.
// Copy: técnicas de PNL honestas (presuposiciones, lenguaje sensorial,
// anclaje problema→alivio, reencuadre del pago, cierre de compromiso pequeño)
// sin inventar cifras, testimonios ni direcciones. Tarifa siempre referencial.
export default function AduanaVerde() {
  return (
    <PublicLayout>
      {/* Hero con gradiente radial verde sutil */}
      <div className="av-hero">
        <div className="container">
          <section className="hero">
            <div className="fade-up">
              <span className="badge badge-amber">Red de oficinas en preparación</span>
              <h1 style={{ marginTop: 14, marginBottom: 10 }}>
                Aduana<br />
                Verde<span style={{ color: 'var(--green)' }}>.</span>
              </h1>
              <p className="av-kicker">
                Red de oficinas físicas · by{' '}
                <Link to="/" className="av-brand">sicr3p<span className="av-dot">.</span></Link>
              </p>
              <p className="lead-green">Lo que calculas es lo que compensas.</p>
              <p className="sub">
                ¿Tu mandante te pide reportar emisiones y no sabes por dónde
                partir? Llega con tus facturas y guías, mira el cálculo en
                pantalla, compensa exactamente ese número y sal con tu informe
                y tu etiqueta QR en la mano. Todo en una visita.
              </p>
              <div className="hero-actions">
                <Link to="/pos" className="btn btn-primary">Conoce el terminal en 2 minutos</Link>
                <a href="mailto:contacto@sicr3p.cl?subject=Cupo%20fundador%20Aduana%20Verde" className="btn btn-outline">Escríbenos</a>
              </div>
              <p className="muted" style={{ marginTop: 22, fontSize: 14 }}>
                Cuando salgas de la oficina, tu respaldo queda verificable en
                línea: quien escanee tu QR verá lo mismo que tú.
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
                Así se ve tu primera visita.
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
                  <b style={{ fontSize: 14 }}>Compensas exactamente lo que calculaste</b>
                </div>
                <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                  No pagas un trámite: pagas compensar el CO2 de tus propios
                  documentos, con tarifa referencial por t CO2e. Ni un peso
                  más, sin cobros por adelantado ni suscripciones.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Franja "terminal físico": el flujo de la oficina como diagrama */}
      <section className="av-terminal">
        <div className="container">
          <p className="av-term-label"><span className="av-led" /> Flujo del terminal · Aduana Verde</p>
          <h2>Del mesón a tu etiqueta, sin vueltas</h2>
          <p className="av-term-sub">
            Esto es lo que pasa dentro de la oficina mientras esperas: cuatro
            estaciones, un solo resultado verificable.
          </p>
          <div className="av-flow">
            <div className="av-flow-node">
              <div className="av-ico"><Icon.Doc size={22} /></div>
              <b>Documento</b>
              <span>Entregas tus facturas y guías en el mesón; se escanean ahí mismo.</span>
            </div>
            <div className="av-flow-arrow"><Icon.ArrowRight size={20} /></div>
            <div className="av-flow-node">
              <div className="av-ico"><Icon.Cog size={22} /></div>
              <b>Cálculo</b>
              <span>La plataforma sicr3p reconoce los datos y calcula tus emisiones en t CO2e.</span>
            </div>
            <div className="av-flow-arrow"><Icon.ArrowRight size={20} /></div>
            <div className="av-flow-node">
              <div className="av-ico"><Icon.CreditCard size={22} /></div>
              <b>Compensación</b>
              <span>Ves el número exacto en pantalla y pagas compensar eso, con tarifa referencial por t CO2e.</span>
            </div>
            <div className="av-flow-arrow"><Icon.ArrowRight size={20} /></div>
            <div className="av-flow-node">
              <div className="av-ico"><Icon.Qr size={22} /></div>
              <b>Etiqueta QR</b>
              <span>Sales con tu informe y una etiqueta verificable, con trazabilidad de cadena de hash.</span>
            </div>
          </div>
        </div>
      </section>

      <section className="pasos">
        <div className="container">
          <h2>Tu visita, paso a paso</h2>
          <div className="two-col-grid" style={{ gap: 28 }}>
            <div className="paso">
              <div className="ico" style={{ color: 'var(--green-600)' }}><Icon.Doc size={28} /></div>
              <h3>1. Llegas con lo que ya tienes</h3>
              <p>Facturas y guías de despacho de tu operación, en papel o digitales. Sin preparación previa ni planillas.</p>
            </div>
            <div className="paso">
              <div className="ico" style={{ color: 'var(--green-600)' }}><Icon.Cog size={28} /></div>
              <h3>2. Miras el cálculo en pantalla</h3>
              <p>Los documentos se escanean en el terminal y la plataforma sicr3p calcula tus emisiones frente a ti. Ves el número exacto antes de decidir.</p>
            </div>
            <div className="paso">
              <div className="ico" style={{ color: 'var(--green-600)' }}><Icon.CreditCard size={28} /></div>
              <h3>3. Compensas ese número, no otro</h3>
              <p>No pagas un trámite: pagas compensar el CO2 que acabas de ver calculado, con tarifa referencial por t CO2e. Ese es todo el modelo.</p>
            </div>
            <div className="paso">
              <div className="ico" style={{ color: 'var(--green-600)' }}><Icon.Qr size={28} /></div><h3>4. Te llevas el respaldo en la mano</h3>
              <p>Informe de tu contabilidad de carbono y etiqueta con QR verificable. Cuando tu mandante lo escanee, verá lo mismo que tú.</p>
            </div>
          </div>
        </div>
      </section>

      {/* La cuenta es corta: tarifa/compensación con número grande + mini stats */}
      <div className="container" style={{ padding: '56px 0 0' }}>
        <h2 style={{ textAlign: 'center', fontSize: 30, margin: '0 0 10px' }}>La cuenta es corta</h2>
        <p className="muted" style={{ textAlign: 'center', fontSize: 15, maxWidth: 520, margin: '0 auto 32px', lineHeight: 1.6 }}>
          Sin letra chica: el modelo completo de Aduana Verde cabe en cuatro números.
        </p>
        <div className="av-cuenta-grid">
          <div className="av-stat av-tarifa">
            <div className="n">1 = 1</div>
            <div className="l">
              Una tonelada calculada es una tonelada compensada. Pagas según
              los documentos escaneados en tu visita, con tarifa referencial
              por t CO2e.
            </div>
            <div className="av-nota">Tarifa referencial — se confirma en la oficina antes de pagar.</div>
          </div>
          <div className="av-stat">
            <div className="n">1</div>
            <div className="l">visita basta para salir con informe y etiqueta QR</div>
          </div>
          <div className="av-stat">
            <div className="n">2</div>
            <div className="l">declaraciones en la misma pasada: emisiones y REP</div>
          </div>
          <div className="av-stat">
            <div className="n">0</div>
            <div className="l">suscripciones y cero cobros por adelantado</div>
          </div>
        </div>
      </div>

      {/* Bloque REP — Ley 20.920 */}
      <div className="container" style={{ padding: '56px 0' }}>
        <div className="two-col-grid" style={{ gap: 28, alignItems: 'stretch' }}>
          <div className="card card-pad av-card-hover">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ color: 'var(--green-600)', display: 'inline-flex' }}><Icon.List size={24} /></span>
              <h3 style={{ margin: 0 }}>Declara tu embalaje en la misma visita</h3>
            </div>
            <p className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
              Mientras el terminal calcula tus emisiones, declaras también tus
              envases y embalajes — productos prioritarios de la Ley REP
              20.920 — con su porcentaje de reciclabilidad, clasificado en
              tres niveles:
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
              <span className="badge badge-green">Reciclabilidad Alta</span>
              <span className="badge badge-amber">Reciclabilidad Media</span>
              <span className="badge badge-red">Reciclabilidad Baja</span>
            </div>
          </div>
          <div className="card card-pad av-card-hover">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ color: 'var(--green-600)', display: 'inline-flex' }}><Icon.Users size={24} /></span>
              <h3 style={{ margin: 0 }}>Para el proveedor al que le exigen</h3>
            </div>
            <p className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
              Si le vendes a mandantes o grandes compañías que piden
              información REP y de emisiones, y hasta ahora respondes con
              correos y planillas, esto te cambia la conversación: de una sola
              visita sales con ambas declaraciones respaldadas y verificables.
              En tu próxima licitación, muestras el QR y listo.
            </p>
            <a href="mailto:contacto@sicr3p.cl?subject=Aduana%20Verde%20-%20Declaraci%C3%B3n%20REP" className="btn btn-outline btn-sm">Quiero saber más</a>
          </div>
        </div>
      </div>

      {/* Estado honesto: pre-lanzamiento */}
      <section className="pasos">
        <div className="container">
          <div className="card card-pad av-card-hover" style={{ textAlign: 'center' }}>
            <span className="badge badge-amber">Red de oficinas en preparación</span>
            <h2 style={{ margin: '14px 0 10px', fontSize: 26 }}>Estamos armando la red</h2>
            <p className="muted" style={{ fontSize: 15, lineHeight: 1.6, maxWidth: 560, margin: '0 auto 20px' }}>
              Aduana Verde está en pre-lanzamiento: todavía no publicamos
              direcciones de oficinas. Los primeros cupos son para clientes
              fundadores y operadores de punto. Escríbenos hoy — es un correo,
              nada más — y te guardamos el tuyo: cuando abramos cerca tuyo,
              serás de los primeros en pasar por el mesón.
            </p>
            <div className="hero-actions" style={{ justifyContent: 'center' }}>
              <a href="mailto:contacto@sicr3p.cl?subject=Cliente%20fundador%20Aduana%20Verde" className="btn btn-primary">Guárdame un cupo fundador</a>
              <a href="mailto:contacto@sicr3p.cl?subject=Quiero%20ser%20punto%20Aduana%20Verde" className="btn btn-outline">Quiero operar un punto</a>
            </div>
            <p className="muted" style={{ fontSize: 13, marginTop: 14 }}>
              ¿Prefieres mirar antes de escribir?{' '}
              <Link to="/pos">Conoce el terminal en 2 minutos</Link>.
            </p>

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
