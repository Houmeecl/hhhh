import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';
import { Icon } from '../components/icons.jsx';
import CalculadoraCompensacion from '../components/CalculadoraCompensacion.jsx';
import { useIdioma } from '../lib/i18n.js';
import { useScrollReveal } from '../lib/scrollReveal.js';
import { useJsonLd } from '../lib/seo.js';

// Franja de "números vivos" de la plataforma: prueba social honesta sin
// testimonios ni cifras inventadas — muestra el estado real de la cadena de
// integridad (GET /api/publico/cadena, endpoint público y anonimizado).
// Fetch tolerante: si el backend no responde, o la cadena está vacía o no
// verificada, la franja simplemente no se muestra.
function FranjaCadena({ t }) {
  const [estado, setEstado] = useState(null);

  useEffect(() => {
    let vivo = true;
    fetch('/api/publico/cadena')
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (vivo && d?.estado?.intacta === true && Number(d.estado.n_eslabones) > 0) {
          setEstado(d.estado);
        }
      })
      .catch(() => {});
    return () => { vivo = false; };
  }, []);

  if (!estado) return null;

  return (
    <section className="live-strip fade-in" aria-label="Números vivos de la plataforma">
      <div className="container live-strip-inner">
        <span className="item">
          <span className="n">{Number(estado.n_eslabones).toLocaleString('es-CL')}</span>
          {t('landing.cadena_docs')}
        </span>
        <span className="item">
          <Icon.CheckCircle size={16} /> {t('landing.cadena_verificada')}
        </span>
        {estado.ultimo_hash_corto && (
          <span className="item">
            {t('landing.cadena_ultimo')} <span className="hash">{estado.ultimo_hash_corto}</span>
          </span>
        )}
        <Link to="/cadena" className="item">{t('landing.cadena_ver')}</Link>
      </div>
    </section>
  );
}

// Captura REAL del Pasaporte Digital — no un mock dibujado: es la pantalla
// /pasaporte/:id tal como la ve cualquiera que escanee el QR (datos de una
// operación de demostración). El chip lo dice explícitamente para que la
// imagen no se lea como una ilustración aspiracional.
//
// El `alt` describe la pantalla en vez de quedar vacío: es la prueba del
// argumento de la sección, no un adorno — con lector de pantalla, marcarla
// decorativa dejaba el bloque sin su evidencia.
function PasaportePreview({ t, prioridad = false }) {
  return (
    <div className="av2-pas-card av2-pas-shot">
      <img
        src="/img/plataforma/pasaporte-real.webp"
        alt={t('landing.shot_alt')}
        loading={prioridad ? 'eager' : 'lazy'}
        decoding="async"
      />
      <span className="av2-pas-chip">✓ {t('landing.shot_chip')}</span>
    </div>
  );
}

// Card del bento de "Servicios"/"Pasos": misma estructura que
// PasaportePreview aplica al hero — captura REAL de la pantalla que la
// card describe (nunca un ícono solo), con el mismo chip de honestidad de
// marca, más un acento de color propio (borde superior + tinte del ícono)
// para que la grilla no se vea plana.
function BentoCard({ accent, extraClass, img, alt, icon: Ico, title, desc, chip }) {
  return (
    <div className={`av2-bento-card av2-bento-acc-${accent} ${extraClass || ''} av2-reveal`}>
      <div className="av2-bento-media">
        <img src={img} alt={alt} loading="lazy" decoding="async" />
      </div>
      <span className="av2-bento-chip">✓ {chip}</span>
      <div className="av2-bento-body">
        <div className="av2-bento-ico"><Ico size={24} /></div>
        <h3>{title}</h3>
        <p>{desc}</p>
      </div>
    </div>
  );
}

// Las preguntas del FAQ, en un solo lugar. Antes el número 4 estaba escrito
// a mano DOS veces —el bucle visible y el JSON-LD de FAQPage— y agregar una
// quinta pregunta al i18n la dejaba muerta: ni se mostraba ni entraba al
// rich snippet, sin que nada fallara. Con la constante, agregar una pregunta
// es tocar este número y nada más.
const FAQ_N = [1, 2, 3, 4, 5];

function PasoFlujo({ step, title, text }) {
  return (
    <div className="card" style={{ padding: 22, borderRadius: 18, minHeight: 170 }}>
      <div style={{ display: 'inline-flex', width: 32, height: 32, borderRadius: '50%', background: 'var(--green-50)', color: 'var(--green-700)', alignItems: 'center', justifyContent: 'center', fontWeight: 700, marginBottom: 12 }}>
        {step}
      </div>
      <h3 style={{ margin: '0 0 8px', fontSize: 18 }}>{title}</h3>
      <p className="muted" style={{ margin: 0, lineHeight: 1.7, fontSize: 14 }}>{text}</p>
    </div>
  );
}

export default function Landing() {
  const { t } = useIdioma();
  const heroRef = useRef(null);
  const [pasoHero, setPasoHero] = useState(false);
  const [footerVisible, setFooterVisible] = useState(false);

  useScrollReveal();

  // FAQPage: las MISMAS preguntas que la sección visible más abajo — las dos
  // recorren FAQ_N, así que no pueden discrepar—, serializadas para el
  // buscador: el <details> ya es accesible, pero un rich snippet de FAQ no
  // se infiere solo del HTML.
  useJsonLd({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_N.map((n) => ({
      '@type': 'Question',
      name: t(`landing.faq_q${n}`),
      acceptedAnswer: { '@type': 'Answer', text: t(`landing.faq_a${n}`) },
    })),
  });

  // CTA flotante móvil: aparece tras scrollear pasado el hero y se oculta
  // cuando el footer entra en pantalla (así nunca lo tapa).
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const obsHero = new IntersectionObserver(
      ([e]) => setPasoHero(!e.isIntersecting),
      { rootMargin: '-80px 0px 0px 0px' }
    );
    if (heroRef.current) obsHero.observe(heroRef.current);

    const footer = document.querySelector('.pub-footer');
    let obsFooter;
    if (footer) {
      obsFooter = new IntersectionObserver(([e]) => setFooterVisible(e.isIntersecting));
      obsFooter.observe(footer);
    }
    return () => { obsHero.disconnect(); obsFooter?.disconnect(); };
  }, []);

  const mostrarCta = pasoHero && !footerVisible;

  return (
    <PublicLayout>
      {/* HERO oscuro estilo producto (mismo sistema av2 que /corredor): el
          titular real va en el <h1> —la marca ya está en el header, no
          necesita ocupar el encabezado de la página— y la pieza central es
          la pantalla real del Pasaporte Digital, que es el entregable del
          que habla el titular. */}
      <div className="av2-hero" ref={heroRef}>
        <div className="container">
          <section className="av2-hero-grid">
            <div className="fade-up">
              <span className="av2-eyebrow"><span className="av-led" /> {t('landing.hero_eyebrow')}</span>
              <h1 className="av2-h1">{t('landing.hero2_t1')}</h1>
              <p className="av2-t2"><span className="av2-grad">{t('landing.hero2_t2')}</span></p>
              <p className="av2-sub">{t('landing.hero2_sub')}</p>
              <div className="hero-actions">
                <Link to="/inscripcion" className="btn btn-primary" style={{ padding: '14px 26px', fontSize: 16 }}>
                  {t('landing.cta_inscribir')}
                </Link>
                <Link to="/cadena" className="btn av2-btn-ghost">{t('landing.verif_cta')}</Link>
              </div>
              <div className="av2-trust">
                <span><Icon.Shield size={15} /> {t('landing.trust_1')}</span>
                <span><Icon.CheckCircle size={15} /> {t('landing.trust_2')}</span>
                <span><Icon.Leaf size={15} /> {t('landing.trust_3')}</span>
              </div>
            </div>

            <div className="av2-pas-wrap fade-up d2">
              <PasaportePreview t={t} prioridad />
            </div>
          </section>
        </div>
      </div>

      {/* Números vivos de la plataforma (solo si el backend responde) */}
      <FranjaCadena t={t} />

      {/* Servicios: la oferta dividida en líneas diferenciadas, cada una
          enlazando a algo real (no un catálogo aspiracional). */}
      <section className="sec-pad">
        <div className="container">
          <h2 className="sec-head">{t('landing.servicios_titulo')}</h2>
          <p className="sec-head-sub">{t('landing.servicios_sub')}</p>
          <div className="av2-bento">
            <BentoCard
              accent="green" extraClass="av2-bento-a"
              img="/img/plataforma/serv1-contabilidad-carbono.png"
              alt={t('landing.serv1_alt')}
              icon={Icon.Chart}
              title={t('landing.serv1_t')} desc={t('landing.serv1_d')}
              chip={t('landing.shot_chip')}
            />
            <BentoCard
              accent="navy"
              img="/img/plataforma/serv2-pasaporte-qr.png"
              alt={t('landing.serv2_alt')}
              icon={Icon.Qr}
              title={t('landing.serv2_t')} desc={t('landing.serv2_d')}
              chip={t('landing.shot_chip')}
            />
            <BentoCard
              accent="amber"
              img="/img/plataforma/serv3-declaracion-rep.png"
              alt={t('landing.serv3_alt')}
              icon={Icon.Leaf}
              title={t('landing.serv3_t')} desc={t('landing.serv3_d')}
              chip={t('landing.shot_chip')}
            />
            <BentoCard
              accent="deep" extraClass="av2-bento-b"
              img="/img/plataforma/serv4-atencion-terreno.png"
              alt={t('landing.serv4_alt')}
              icon={Icon.Users}
              title={t('landing.serv4_t')} desc={t('landing.serv4_d')}
              chip={t('landing.shot_chip')}
            />
          </div>
        </div>
      </section>

      <section className="sec-pad" style={{ paddingTop: 0 }}>
        <div className="container">
          <h2 className="sec-head">Cómo funciona el motor</h2>
          <p className="sec-head-sub">Un flujo simple y verificable: recopilar, calcular, publicar y auditar.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16 }}>
            <PasoFlujo
              step="1"
              title="Recoge el documento"
              text="La operación entra con su origen, cantidad, material y documento base. No hay suposiciones ocultas ni cifras que se “adivinen” en el último paso."
            />
            <PasoFlujo
              step="2"
              title="Calcula emisiones"
              text="El motor usa factores reales, categoría y método de cálculo para convertir el dato físico o de gasto en t CO2e, con el desglose visible en cada pasaporte."
            />
            <PasoFlujo
              step="3"
              title="Publica trazabilidad"
              text="La evidencia, el hash y la cadena quedan visibles para terceros. El pasaporte es el comprobante público del proceso, no solo un PDF bonito."
            />
          </div>
        </div>
      </section>

      <section className="sec-pad" style={{ paddingTop: 0 }}>
        <div className="container">
          <div className="card card-pad av-card-hover" style={{ background: 'linear-gradient(180deg, rgba(15, 118, 110, 0.08), rgba(15, 23, 42, 0.02))' }}>
            <div style={{ marginBottom: 14, display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--green-700)', fontWeight: 700, letterSpacing: '.02em', textTransform: 'uppercase', fontSize: 12 }}>
              <Icon.CheckCircle size={15} /> Resultado real del motor
            </div>
            <h3 style={{ margin: '0 0 10px', fontSize: 24 }}>No es un mock ni un placeholder: calcula, emite y entrega.</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 14 }}>
              <div className="card" style={{ padding: 16, borderRadius: 14 }}>
                <div className="pas-lbl" style={{ marginBottom: 8 }}>1. Cálculo</div>
                <b>CO2e real por documento, categoría y factor.</b>
                <p className="muted" style={{ marginBottom: 0, marginTop: 8 }}>El número se genera desde la operación registrada, no desde una cifra fija ni una demostración visual.</p>
              </div>
              <div className="card" style={{ padding: 16, borderRadius: 14 }}>
                <div className="pas-lbl" style={{ marginBottom: 8 }}>2. Informes</div>
                <b>Informe del período y export auditable.</b>
                <p className="muted" style={{ marginBottom: 0, marginTop: 8 }}>La misma base de cálculo alimenta el informe mensual, el resumen GHG y el paquete entregable al cliente.</p>
              </div>
              <div className="card" style={{ padding: 16, borderRadius: 14 }}>
                <div className="pas-lbl" style={{ marginBottom: 8 }}>3. Verificación</div>
                <b>Pasaporte público con hash y trazabilidad.</b>
                <p className="muted" style={{ marginBottom: 0, marginTop: 8 }}>Todo queda visible para verificar el origen, la evidencia y la cadena que respalda el resultado final.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Expediente de evidencia: cada venta con los documentos que la
          respaldan. Va con el mismo patrón de bloque que Corredor e
          Instituto —kicker, título, sub y chips— y NO con una card de
          captura: la regla de la casa es que una imagen de producto sea
          una pantalla real, y esta función recién sale a producción. Un
          mock dibujado aquí sería justo la ilustración aspiracional que
          el chip "pantalla real de la plataforma" existe para evitar.

          La nota de cierre no es letra chica defensiva: es la línea que
          separa ordenar evidencia de certificar, y va en la portada
          porque es donde se forma la expectativa. */}
      <section className="sec-pad">
        <div className="container">
          <div className="land-corr av2-reveal">
            <div>
              <span className="land-corr-kicker"><Icon.Doc size={16} /> {t('landing.exp_kicker')}</span>
              <h3 className="land-corr-titulo">{t('landing.exp_titulo')}<span style={{ color: 'var(--green)' }}>.</span></h3>
              <p className="land-corr-sub">{t('landing.exp_sub')}</p>
              {/* NO usa .muted: esa clase es var(--gray), pensada para fondo
                  claro, y este bloque va sobre el fondo oscuro de .land-corr
                  — quedaba con contraste insuficiente. Se reusa el mismo
                  #94a3b8 que ya valida .land-corr-sub para este fondo, y la
                  jerarquía la da el tamaño, no un gris más apagado. */}
              <p style={{ fontSize: 13, lineHeight: 1.7, marginTop: 14, marginBottom: 0, color: '#94a3b8' }}>
                {t('landing.exp_nota')}
              </p>
            </div>
            <div className="land-corr-lado">
              <div className="land-corr-chips">
                <span>{t('landing.exp_chip1')}</span>
                <span>{t('landing.exp_chip2')}</span>
                <span>{t('landing.exp_chip3')}</span>
              </div>
              <Link to="/inscripcion" className="btn btn-primary">
                {t('landing.cta_inscribir')} <Icon.ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Corredor Bioceánico: la línea transfronteriza, con landing propia */}
      <section className="sec-pad sec-alt">
        <div className="container">
          <div className="land-corr av2-reveal">
            <div>
              <span className="land-corr-kicker"><Icon.Package size={16} /> {t('landing.corr_kicker')}</span>
              <h3 className="land-corr-titulo">{t('landing.corr_titulo')}<span style={{ color: 'var(--green)' }}>.</span></h3>
              <p className="land-corr-sub">{t('landing.corr_sub')}</p>
            </div>
            <div className="land-corr-lado">
              <div className="land-corr-chips">
                <span>{t('landing.corr_chip1')}</span>
                <span>{t('landing.corr_chip2')}</span>
                <span>{t('landing.corr_chip3')}</span>
              </div>
              <Link to="/corredor" className="btn btn-primary">
                {t('landing.corr_cta')} <Icon.ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Instituto sicr3p: la línea de formación, con landing propia */}
      <section className="sec-pad">
        <div className="container">
          <div className="land-corr av2-reveal">
            <div>
              <span className="land-corr-kicker"><Icon.Book size={16} /> {t('landing.inst_kicker')}</span>
              <h3 className="land-corr-titulo">{t('landing.inst_titulo')}<span style={{ color: 'var(--green)' }}>.</span></h3>
              <p className="land-corr-sub">{t('landing.inst_sub')}</p>
            </div>
            <div className="land-corr-lado">
              <div className="land-corr-chips">
                <span>{t('landing.inst_chip1')}</span>
                <span>{t('landing.inst_chip2')}</span>
                <span>{t('landing.inst_chip3')}</span>
              </div>
              <Link to="/instituto" className="btn btn-primary">
                {t('landing.inst_cta')} <Icon.ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="sec-pad">
        <div className="container">
          <h2 className="sec-head">{t('landing.pasos_titulo')}</h2>
          <p className="sec-head-sub">{t('landing.pasos_sub')}</p>
          <div className="av2-bento av2-bento-3">
            <BentoCard
              accent="green" extraClass="av2-bento-a"
              img="/img/plataforma/paso1-subir-documentos.png"
              alt={t('landing.paso1_alt')}
              icon={Icon.Cloud}
              title={t('landing.paso1_t')} desc={t('landing.paso1_d')}
              chip={t('landing.shot_chip')}
            />
            <BentoCard
              accent="amber"
              img="/img/plataforma/paso2-generamos-informe.png"
              alt={t('landing.paso2_alt')}
              icon={Icon.Chart}
              title={t('landing.paso2_t')} desc={t('landing.paso2_d')}
              chip={t('landing.shot_chip')}
            />
            <BentoCard
              accent="navy" extraClass="av2-bento-b"
              img="/img/plataforma/paso3-etiqueta-qr.png"
              alt={t('landing.paso3_alt')}
              icon={Icon.CheckCircle}
              title={t('landing.paso3_t')} desc={t('landing.paso3_d')}
              chip={t('landing.shot_chip')}
            />
          </div>
          <div style={{ textAlign: 'center', marginTop: 36 }}>
            <Link to="/inscripcion" className="btn btn-primary">{t('landing.cta_inscribir')}</Link>
          </div>
        </div>
      </section>

      {/* Banda oscura de verificación: el argumento central del producto —
          nada pide confianza, todo se comprueba en las páginas públicas. La
          captura que respalda esta promesa ya está en el hero, así que aquí
          va centrada y sin repetirla. */}
      <section className="av2-pasaporte sec-pad">
        <div className="container" style={{ textAlign: 'center', maxWidth: 760 }}>
          <div className="av2-reveal">
            <h2 style={{ fontSize: 30, margin: '0 0 12px', color: '#fff' }}>
              {t('landing.verif_titulo')}<span style={{ color: 'var(--green)' }}>.</span>
            </h2>
            <p style={{ color: '#94a3b8', fontSize: 15.5, lineHeight: 1.7, margin: '0 auto 8px', maxWidth: 640 }}>
              {t('landing.verif_sub')}
            </p>
            <ol className="av2-pas-pasos av2-pas-pasos-centro">
              <li><span>1</span>{t('landing.verif_p1')}</li>
              <li><span>2</span>{t('landing.verif_p2')}</li>
              <li><span>3</span>{t('landing.verif_p3')}</li>
            </ol>
            <div className="hero-actions" style={{ justifyContent: 'center' }}>
              <Link to="/cadena" className="btn av2-btn-ghost">
                {t('landing.verif_cta')} <Icon.ArrowRight size={15} />
              </Link>
              <span className="badge badge-green" style={{ alignSelf: 'center' }}>{t('landing.verif_chip')}</span>
            </div>
          </div>
        </div>
      </section>

      {/* La cuenta es corta: el modelo comercial completo en cuatro números,
          sin letra chica. La tarifa se dice referencial siempre. */}
      <section className="sec-pad">
        <div className="container">
          <h2 className="sec-head">{t('landing.cuenta_titulo')}</h2>
          <p className="sec-head-sub">{t('landing.cuenta_sub')}</p>
          <div className="av-cuenta-grid">
            <div className="av-stat av-tarifa fade-up d1">
              <div className="n">1 = 1</div>
              <div className="l">{t('landing.stat_1eq')}</div>
              <div className="av-nota">{t('landing.stat_1eq_nota')}</div>
            </div>
            <div className="av-stat fade-up d2">
              <div className="n">1</div>
              <div className="l">{t('landing.stat_carga')}</div>
            </div>
            <div className="av-stat fade-up d3">
              <div className="n">2</div>
              <div className="l">{t('landing.stat_decls')}</div>
            </div>
            <div className="av-stat fade-up d4">
              <div className="n">0</div>
              <div className="l">{t('landing.stat_cero')}</div>
            </div>
          </div>
        </div>
      </section>

      {/* Calculadora pública: estimación en vivo con los factores reales del motor */}
      <section className="sec-pad sec-alt">
        <div className="container">
          <h2 className="sec-head">{t('landing.calc_titulo')}</h2>
          <p className="sec-head-sub">{t('landing.calc_sub')}</p>
          <CalculadoraCompensacion />
        </div>
      </section>

      {/* REP (Ley 20.920): la segunda declaración sale de la misma carga */}
      <section className="sec-pad">
        <div className="container">
          <div className="two-col-grid" style={{ gap: 28, alignItems: 'stretch' }}>
            <div className="card card-pad av-card-hover av2-reveal">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{ color: 'var(--green-600)', display: 'inline-flex' }}><Icon.List size={24} /></span>
                <h3 style={{ margin: 0 }}>{t('landing.rep_titulo')}</h3>
              </div>
              <p className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
                {t('landing.rep_texto')}
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                <span className="badge badge-green">{t('landing.rep_alta')}</span>
                <span className="badge badge-amber">{t('landing.rep_media')}</span>
                <span className="badge badge-red">{t('landing.rep_baja')}</span>
              </div>
            </div>
            <div className="card card-pad av-card-hover av2-reveal">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{ color: 'var(--green-600)', display: 'inline-flex' }}><Icon.Users size={24} /></span>
                <h3 style={{ margin: 0 }}>{t('landing.prov_titulo')}</h3>
              </div>
              <p className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
                {t('landing.prov_texto')}
              </p>
              <a href="mailto:contacto@sicrep.cl?subject=sicr3p%20-%20Declaraci%C3%B3n%20REP" className="btn btn-outline btn-sm">{t('landing.prov_cta')}</a>
            </div>
          </div>
        </div>
      </section>

      {/* Preguntas frecuentes — honestas, sin evasivas */}
      <section className="sec-pad sec-alt">
        <div className="container" style={{ maxWidth: 760 }}>
          <h2 className="sec-head" style={{ marginBottom: 28 }}>{t('landing.faq_titulo')}</h2>
          <div className="av2-faq">
            {FAQ_N.map((n) => (
              <details key={n} className="av2-faq-item av2-reveal">
                <summary>{t(`landing.faq_q${n}`)}</summary>
                <p>{t(`landing.faq_a${n}`)}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Cierre honesto: el estado real del proyecto va con badge, arriba del
          CTA, no escondido en el pie. La compensación se declara simulada
          mientras no haya socio ambiental formalizado. */}
      <section className="sec-pad">
        <div className="container">
          <div className="card card-pad av-card-hover" style={{ textAlign: 'center' }}>
            <span className="badge badge-amber">{t('landing.pre_badge')}</span>
            <h2 style={{ margin: '14px 0 10px', fontSize: 26 }}>{t('landing.pre_titulo')}</h2>
            <p className="muted" style={{ fontSize: 15, lineHeight: 1.6, maxWidth: 560, margin: '0 auto 20px' }}>
              {t('landing.pre_texto')}
            </p>
            <div className="hero-actions" style={{ justifyContent: 'center' }}>
              <Link to="/inscripcion" className="btn btn-primary">{t('landing.cta_inscribir')}</Link>
              <a href="mailto:contacto@sicrep.cl?subject=Cliente%20fundador%20sicr3p" className="btn btn-outline">{t('landing.pre_cta1')}</a>
            </div>

            <div style={{ marginTop: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className="badge badge-gray" style={{ fontSize: 11 }}>{t('comun.proximamente')}</span>
              <span className="muted" style={{ fontSize: 12 }}>{t('comun.socio_ambiental')}</span>
            </div>
            {/* Honestidad de marca: en inglés incluye "not affiliated with any
                national customs service" (sicr3p no es aduana ni autoridad). */}
            <p className="muted" style={{ fontSize: 12, marginTop: 8, maxWidth: 560, marginLeft: 'auto', marginRight: 'auto' }}>
              {t('landing.disclaimer')}
            </p>
          </div>
        </div>
      </section>

      {/* CTA flotante móvil (≤640px): visible solo pasado el hero y lejos del footer */}
      <div className={mostrarCta ? 'mobile-cta show' : 'mobile-cta'} aria-hidden={!mostrarCta}>
        <Link
          to="/inscripcion"
          className="btn btn-primary"
          tabIndex={mostrarCta ? 0 : -1}
          aria-label={t('landing.mobile_cta')}
        >
          {t('landing.mobile_cta')} <Icon.ArrowRight size={18} />
        </Link>
      </div>
    </PublicLayout>
  );
}
