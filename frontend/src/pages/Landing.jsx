import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';
import { Icon } from '../components/icons.jsx';
import CalculadoraCompensacion from '../components/CalculadoraCompensacion.jsx';
import { useIdioma } from '../lib/i18n.js';
import { useScrollReveal } from '../lib/scrollReveal.js';

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

export default function Landing() {
  const { t } = useIdioma();
  const heroRef = useRef(null);
  const [pasoHero, setPasoHero] = useState(false);
  const [footerVisible, setFooterVisible] = useState(false);

  useScrollReveal();

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
                <Link to="/cargar" className="btn btn-primary" style={{ padding: '14px 26px', fontSize: 16 }}>
                  {t('landing.cta_comenzar')}
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
            <div className="av2-bento-card av2-bento-a av2-reveal">
              <div className="av2-bento-ico"><Icon.Chart size={24} /></div>
              <h3>{t('landing.serv1_t')}</h3>
              <p>{t('landing.serv1_d')}</p>
            </div>
            <div className="av2-bento-card av2-reveal">
              <div className="av2-bento-ico"><Icon.Qr size={24} /></div>
              <h3>{t('landing.serv2_t')}</h3>
              <p>{t('landing.serv2_d')}</p>
            </div>
            <div className="av2-bento-card av2-reveal">
              <div className="av2-bento-ico"><Icon.Leaf size={24} /></div>
              <h3>{t('landing.serv3_t')}</h3>
              <p>{t('landing.serv3_d')}</p>
            </div>
            <div className="av2-bento-card av2-bento-b av2-reveal">
              <div className="av2-bento-ico"><Icon.Users size={24} /></div>
              <h3>{t('landing.serv4_t')}</h3>
              <p>{t('landing.serv4_d')}</p>
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

      <section className="sec-pad">
        <div className="container">
          <h2 className="sec-head">{t('landing.pasos_titulo')}</h2>
          <p className="sec-head-sub">{t('landing.pasos_sub')}</p>
          <div className="av2-bento av2-bento-3">
            <div className="av2-bento-card av2-bento-a av2-reveal">
              <div className="av2-bento-ico"><Icon.Cloud size={24} /></div>
              <h3>{t('landing.paso1_t')}</h3>
              <p>{t('landing.paso1_d')}</p>
            </div>
            <div className="av2-bento-card av2-reveal">
              <div className="av2-bento-ico"><Icon.Chart size={24} /></div>
              <h3>{t('landing.paso2_t')}</h3>
              <p>{t('landing.paso2_d')}</p>
            </div>
            <div className="av2-bento-card av2-bento-b av2-reveal">
              <div className="av2-bento-ico"><Icon.CheckCircle size={24} /></div>
              <h3>{t('landing.paso3_t')}</h3>
              <p>{t('landing.paso3_d')}</p>
            </div>
          </div>
          <div style={{ textAlign: 'center', marginTop: 36 }}>
            <Link to="/cargar" className="btn btn-primary">{t('landing.cta_comenzar')}</Link>
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
            {[1, 2, 3, 4].map((n) => (
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
              <Link to="/cargar" className="btn btn-primary">{t('landing.cta_comenzar')}</Link>
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
          to="/cargar"
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
