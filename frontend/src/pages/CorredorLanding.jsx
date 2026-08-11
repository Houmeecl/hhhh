import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';
import LeadCta from '../components/LeadForm.jsx';
import { Icon } from '../components/icons.jsx';
import { useIdioma } from '../lib/i18n.js';

// Landing pública del servicio de trazabilidad para el Corredor Bioceánico
// (Brasil–Paraguay–Argentina–Chile). A diferencia del mostrador presencial
// de sicr3p —una red comercial que sicr3p crea y opera de
// punta a punta— el Corredor Bioceánico es infraestructura real y
// preexistente que sicr3p NO posee ni administra: por eso esta página usa
// el layout y la marca de sicr3p directamente (sin inventar una marca
// "Corredor Bioceánico. by sicr3p" que insinuaría lo contrario). El MIC/DTA
// y el trámite aduanero oficial siguen su curso normal; este servicio los
// complementa con trazabilidad documental verificable.
function useRevelar() {
  useEffect(() => {
    if (!('IntersectionObserver' in window)) return undefined;
    const io = new IntersectionObserver(
      (entradas) => entradas.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('on'); io.unobserve(e.target); } }),
      { threshold: 0.15 }
    );
    document.querySelectorAll('.av2-reveal').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

// Captura real del Pasaporte de Trazabilidad Documental de un lote, tal
// como se ve en /lote/:codigo — así se ve el documento, no un mockup dibujado.
function CorPasaportePreview() {
  return (
    <div className="av2-pas-card av2-pas-shot" aria-hidden="true">
      <img src="/img/corredor/pasaporte-real.png" alt="" loading="lazy" />
      <span className="av2-pas-chip">✓ así se ve el Pasaporte de Trazabilidad</span>
    </div>
  );
}

// Captura real de la Torre de Control (mapa + panel del operador), tal
// como se ve en /torre/:codigo — no un mockup dibujado.
function TorrePreview() {
  return (
    <div className="cor-shot av2-reveal" aria-hidden="true">
      <img src="/img/corredor/torre-real.png" alt="" loading="lazy" />
      <span className="cor-shot-chip">✓ pantalla real de la Torre de Control</span>
    </div>
  );
}

export default function CorredorLanding() {
  const { t } = useIdioma();
  useRevelar();
  return (
    <PublicLayout>
      {/* HERO — mismo sistema visual que la portada (navy + brillos),
          reutilizando las clases av2-* que ambas comparten. */}
      <div className="av2-hero">
        <div className="container">
          <section className="av2-hero-grid">
            <div className="fade-up">
              <span className="av2-eyebrow"><span className="av-led" /> {t('cor.eyebrow')}</span>
              <h1 className="av2-h1">{t('cor.h1')}</h1>
              <p className="av2-t2"><span className="av2-grad">{t('cor.h1_grad')}</span></p>
              <p className="av2-sub">{t('cor.sub')}</p>
              <div className="hero-actions">
                {/* Formulario inline en vez de mailto: en el celular el
                    mailto suele no abrir nada y el interesado se perdía. */}
                <LeadCta
                  origen="corredor" etiqueta={t('cor.cta_piloto')}
                  className="btn btn-primary" hint="Piloto Corredor Bioceánico"
                />
                <Link to="/torre" className="btn av2-btn-ghost">{t('cor.cta_torre')}</Link>
              </div>
              <div className="av2-trust">
                <span><Icon.Shield size={15} /> {t('cor.trust_1')}</span>
                <span><Icon.Package size={15} /> {t('cor.trust_2')}</span>
                <span><Icon.Qr size={15} /> {t('cor.trust_3')}</span>
              </div>
            </div>
            <div className="av2-pas-wrap fade-up d2">
              <CorPasaportePreview />
            </div>
          </section>
        </div>
      </div>

      {/* Bento: las 4 piezas del servicio */}
      <section className="sec-pad">
        <div className="container">
          <h2 style={{ textAlign: 'center', fontSize: 30, margin: '0 0 10px' }}>{t('cor.bento_titulo')}</h2>
          <p className="muted" style={{ textAlign: 'center', fontSize: 15, maxWidth: 560, margin: '0 auto 32px', lineHeight: 1.6 }}>
            {t('cor.bento_sub')}
          </p>
          <div className="av2-bento">
            <div className="av2-bento-card av2-bento-a av2-reveal">
              <div className="av2-bento-ico"><Icon.Qr size={24} /></div>
              <h3>{t('cor.bento_1t')}</h3>
              <p>{t('cor.bento_1d')}</p>
            </div>
            <div className="av2-bento-card av2-reveal">
              <div className="av2-bento-ico"><span style={{ fontSize: 22, lineHeight: 1 }}>🗼</span></div>
              <h3>{t('cor.bento_2t')}</h3>
              <p>{t('cor.bento_2d')}</p>
            </div>
            <div className="av2-bento-card av2-reveal">
              <div className="av2-bento-ico"><Icon.Package size={24} /></div>
              <h3>{t('cor.bento_3t')}</h3>
              <p>{t('cor.bento_3d')}</p>
            </div>
            <div className="av2-bento-card av2-bento-b av2-reveal">
              <div className="av2-bento-ico"><Icon.Cog size={24} /></div>
              <h3>{t('cor.bento_4t')}</h3>
              <p>{t('cor.bento_4d')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Cómo funciona: 5 pasos, sin GPS */}
      <section className="av-terminal">
        <div className="container">
          <p className="av-term-label"><span className="av-led" /> {t('cor.como_titulo')}</p>
          <h2>{t('cor.como_titulo')}</h2>
          <p className="av-term-sub">{t('cor.como_sub')}</p>
          <div className="av-flow" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
            <div className="av-flow-node">
              <div className="av-ico"><Icon.Qr size={20} /></div>
              <b>{t('cor.paso1_t')}</b>
              <span>{t('cor.paso1_d')}</span>
            </div>
            <div className="av-flow-node">
              <div className="av-ico"><Icon.Check size={20} /></div>
              <b>{t('cor.paso2_t')}</b>
              <span>{t('cor.paso2_d')}</span>
            </div>
            <div className="av-flow-node">
              <div className="av-ico"><span style={{ fontSize: 18, lineHeight: 1 }}>🗼</span></div>
              <b>{t('cor.paso3_t')}</b>
              <span>{t('cor.paso3_d')}</span>
            </div>
            <div className="av-flow-node">
              <div className="av-ico"><Icon.Cog size={20} /></div>
              <b>{t('cor.paso4_t')}</b>
              <span>{t('cor.paso4_d')}</span>
            </div>
            <div className="av-flow-node">
              <div className="av-ico"><Icon.Shield size={20} /></div>
              <b>{t('cor.paso5_t')}</b>
              <span>{t('cor.paso5_d')}</span>
            </div>
          </div>
        </div>
      </section>

      {/* La credencial: captura real de la Tarjeta de Viaje */}
      <section className="sec-pad">
        <div className="container">
          <div className="two-col-grid" style={{ gap: 32, alignItems: 'center' }}>
            <div className="av2-reveal" style={{ display: 'flex', justifyContent: 'center' }}>
              <div className="cor-tarjeta-shot">
                <img src="/img/corredor/tarjeta-real.png" alt={t('cor.credencial_titulo')} loading="lazy" />
              </div>
            </div>
            <div className="av2-reveal">
              <h2 style={{ fontSize: 28, margin: '0 0 10px' }}>{t('cor.credencial_titulo')}</h2>
              <p className="muted" style={{ fontSize: 15, lineHeight: 1.7 }}>{t('cor.credencial_texto')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* La torre: mapa en vivo (fondo navy, mismo estilo de la portada) */}
      <section className="av2-pasaporte sec-pad">
        <div className="container">
          <div className="av2-pas-secgrid">
            <div className="av2-reveal">
              <h2 style={{ fontSize: 28, margin: '0 0 10px', color: '#fff' }}>{t('cor.torre_titulo')}</h2>
              <p style={{ color: '#cbd5e1', fontSize: 15, lineHeight: 1.7, maxWidth: 480 }}>{t('cor.torre_texto')}</p>
              <Link to="/torre" className="btn btn-primary" style={{ padding: '14px 26px', fontSize: 16, marginTop: 8 }}>
                {t('cor.cta_torre')}
              </Link>
            </div>
            <div className="av2-reveal" style={{ display: 'flex', justifyContent: 'center' }}>
              <TorrePreview />
            </div>
          </div>
        </div>
      </section>

      {/* Firma de actores: atestación con credencial propia (proveedor y puerto) */}
      <section className="sec-pad">
        <div className="container">
          <h2 style={{ textAlign: 'center', fontSize: 28, margin: '0 0 10px' }}>{t('cor.firma_titulo')}</h2>
          <p className="muted" style={{ textAlign: 'center', fontSize: 15, maxWidth: 620, margin: '0 auto 28px', lineHeight: 1.6 }}>
            {t('cor.firma_sub')}
          </p>
          <div className="av2-bento" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
            <div className="av2-bento-card av2-reveal">
              <div className="av2-bento-ico"><Icon.Check size={24} /></div>
              <h3>{t('cor.firma_prov_t')}</h3>
              <p>{t('cor.firma_prov_d')}</p>
            </div>
            <div className="av2-bento-card av2-reveal">
              <div className="av2-bento-ico"><span style={{ fontSize: 22, lineHeight: 1 }}>⚓</span></div>
              <h3>{t('cor.firma_puerto_t')}</h3>
              <p>{t('cor.firma_puerto_d')}</p>
            </div>
          </div>
          <p className="muted" style={{ textAlign: 'center', fontSize: 12, marginTop: 18, maxWidth: 620, marginLeft: 'auto', marginRight: 'auto' }}>
            {t('cor.firma_disclaimer')}
          </p>
        </div>
      </section>

      {/* Piloto — honesto: la tecnología ya opera; falta un lote real */}
      <section className="pasos">
        <div className="container">
          <div className="card card-pad av-card-hover" style={{ textAlign: 'center' }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 26 }}>{t('cor.pre_titulo')}</h2>
            <p className="muted" style={{ fontSize: 15, lineHeight: 1.6, maxWidth: 560, margin: '0 auto 20px' }}>
              {t('cor.pre_texto')}
            </p>
            <div className="hero-actions" style={{ justifyContent: 'center' }}>
              <LeadCta origen="corredor" etiqueta={t('cor.pre_cta1')} className="btn btn-primary" hint="Piloto Corredor Bioceánico" />
              <LeadCta origen="corredor" etiqueta={t('cor.pre_cta2')} className="btn btn-outline" hint="Quiero ser punto del corredor" />
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 20, maxWidth: 560, marginLeft: 'auto', marginRight: 'auto' }}>
              {t('cor.disclaimer')}
            </p>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
