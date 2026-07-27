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
      <div className="container" ref={heroRef}>
        <section className="hero">
          <div className="fade-up">
            <h1>
              {t('landing.hero_titulo1')}<br />
              {t('landing.hero_titulo2')}<span style={{ color: 'var(--green)' }}>.</span>
            </h1>
            <p className="lead-green">{t('landing.hero_lead')}</p>
            <p className="sub">{t('landing.hero_sub')}</p>
            <div className="hero-actions">
              <Link to="/cargar" className="btn btn-primary">{t('landing.cta_comenzar')}</Link>
              <a href="mailto:contacto@sicrep.cl" className="btn btn-outline">{t('landing.cta_contacto')}</a>
            </div>
            <p className="muted" style={{ marginTop: 22, fontSize: 14 }}>
              {t('landing.hero_nota1')}
              <br />{t('landing.hero_nota2')}
            </p>
            <div className="trust-bar">
              <span className="item"><Icon.Shield size={17} /> GHG Protocol</span>
              <span className="item"><Icon.CheckCircle size={17} /> ISO 14064-1</span>
              <span className="item"><Icon.Leaf size={17} /> Factores HuellaChile</span>
            </div>
          </div>

          {/* Vista previa de la app */}
          <div className="preview-card fade-up d2">
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{t('landing.preview_titulo')}</div>
            <div className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
              <b style={{ color: 'var(--green-600)' }}>{t('landing.preview_etapa')}</b> {t('landing.preview_etapa_desc')}
            </div>
            <div className="dropzone" style={{ padding: '28px 16px' }}>
              <div style={{ color: 'var(--green-600)' }}><Icon.Cloud size={40} /></div>
              <div style={{ fontWeight: 600, marginTop: 6 }}>{t('landing.preview_drop_titulo')}</div>
              <div className="muted" style={{ fontSize: 13 }}>{t('landing.preview_drop_formatos')}</div>
            </div>
            <div className="flow">
              <div className="node"><div className="c" style={{ color: 'var(--green-600)' }}><Icon.Doc size={22} /></div><b>{t('landing.flow1_t')}</b><span>{t('landing.flow1_d')}</span></div>
              <div className="arrow"><Icon.ArrowRight size={18} /></div>
              <div className="node"><div className="c" style={{ color: 'var(--green-600)' }}><Icon.Cog size={22} /></div><b>{t('landing.flow2_t')}</b><span>{t('landing.flow2_d')}</span></div>
              <div className="arrow"><Icon.ArrowRight size={18} /></div>
              <div className="node"><div className="c" style={{ color: 'var(--green-600)' }}><Icon.Tag size={22} /></div><b>{t('landing.flow3_t')}</b><span>{t('landing.flow3_d')}</span></div>
            </div>
          </div>
        </section>
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
