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
      {/* HERO oscuro estilo producto (mismo sistema av2 de /aduana-verde y
          /corredor): titular nuevo y el video real del proyecto como pieza
          central — grabado de la plataforma en vivo, no una animación. */}
      <div className="av2-hero" ref={heroRef}>
        <div className="container">
          <section className="av2-hero-grid">
            <div className="fade-up">
              <span className="av2-eyebrow"><span className="av-led" /> {t('landing.hero_eyebrow')}</span>
              <h1 className="av2-h1">
                sicr3p<span style={{ color: 'var(--green)' }}>.</span>
              </h1>
              <p className="av2-t2">
                {t('landing.hero2_t1')} <span className="av2-grad">{t('landing.hero2_t2')}</span>
              </p>
              <p className="av2-sub">{t('landing.hero2_sub')}</p>
              <div className="hero-actions">
                <Link to="/cargar" className="btn btn-primary" style={{ padding: '14px 26px', fontSize: 16 }}>
                  {t('landing.cta_comenzar')}
                </Link>
                <a href="#video-proyecto" className="btn av2-btn-ghost">{t('landing.cta_video')}</a>
              </div>
              <div className="av2-trust">
                <span><Icon.Shield size={15} /> GHG Protocol</span>
                <span><Icon.CheckCircle size={15} /> ISO 14064-1</span>
                <span><Icon.Leaf size={15} /> Factores HuellaChile</span>
              </div>
            </div>

            <div className="land-video-wrap fade-up d2" id="video-proyecto">
              <video
                className="land-video"
                controls
                preload="none"
                playsInline
                poster="/video/sicr3p-proyecto-poster.jpg"
                src="/video/sicr3p-proyecto.mp4"
              />
              <span className="land-video-chip">▶ {t('landing.video_chip')}</span>
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
          <h2 style={{ textAlign: 'center', fontSize: 30, margin: '0 0 10px' }}>{t('landing.servicios_titulo')}</h2>
          <p className="muted" style={{ textAlign: 'center', fontSize: 15, maxWidth: 520, margin: '0 auto 32px', lineHeight: 1.6 }}>
            {t('landing.servicios_sub')}
          </p>
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
              <div className="av2-bento-ico"><Icon.Building size={24} /></div>
              <h3>{t('landing.serv4_t')}</h3>
              <p>{t('landing.serv4_d')}</p>
              <Link to="/aduana-verde" className="av2-nav-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
                {t('landing.serv4_link')} <Icon.ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="sec-pad">
        <div className="container">
          <h2 style={{ textAlign: 'center', fontSize: 30, margin: '0 0 10px' }}>{t('landing.pasos_titulo')}</h2>
          <p className="muted" style={{ textAlign: 'center', fontSize: 15, maxWidth: 520, margin: '0 auto 32px', lineHeight: 1.6 }}>
            {t('landing.pasos_sub')}
          </p>
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
          nada pide confianza, todo se comprueba en las páginas públicas. */}
      <section className="av2-pasaporte" style={{ padding: '64px 0' }}>
        <div className="container" style={{ textAlign: 'center', maxWidth: 760 }}>
          <h2 style={{ color: '#fff', fontSize: 30, margin: '0 0 12px' }}>
            {t('landing.verif_titulo')}<span style={{ color: 'var(--green)' }}>.</span>
          </h2>
          <p style={{ color: '#94a3b8', fontSize: 15.5, lineHeight: 1.7, margin: '0 auto 24px', maxWidth: 640 }}>
            {t('landing.verif_sub')}
          </p>
          <Link to="/cadena" className="btn av2-btn-ghost">
            {t('landing.verif_cta')} <Icon.ArrowRight size={15} />
          </Link>
        </div>
      </section>

      {/* Calculadora pública: estimación en vivo con los factores reales del motor */}
      <section className="sec-pad">
        <div className="container">
          <h2 style={{ textAlign: 'center', fontSize: 30, margin: '0 0 10px' }}>{t('landing.calc_titulo')}</h2>
          <p className="muted" style={{ textAlign: 'center', fontSize: 15, maxWidth: 560, margin: '0 auto 28px', lineHeight: 1.6 }}>
            {t('landing.calc_sub')}
          </p>
          <CalculadoraCompensacion contexto="sicr3p" />
        </div>
      </section>

      {/* Preguntas frecuentes — honestas, sin evasivas */}
      <section className="sec-pad">
        <div className="container" style={{ maxWidth: 760 }}>
          <h2 style={{ textAlign: 'center', fontSize: 30, margin: '0 0 28px' }}>{t('landing.faq_titulo')}</h2>
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

      {/* Cierre: mismo par de CTAs del hero, para no terminar en seco */}
      <section className="pasos">
        <div className="container" style={{ textAlign: 'center' }}>
          <h2 style={{ margin: '0 0 10px' }}>{t('landing.cierre_titulo')}</h2>
          <p className="muted" style={{ fontSize: 15, maxWidth: 520, margin: '0 auto 24px', lineHeight: 1.6 }}>
            {t('landing.cierre_sub')}
          </p>
          <div className="hero-actions" style={{ justifyContent: 'center' }}>
            <Link to="/cargar" className="btn btn-primary">{t('landing.cta_comenzar')}</Link>
            <a href="mailto:contacto@sicrep.cl" className="btn btn-outline">{t('landing.cta_contacto')}</a>
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
