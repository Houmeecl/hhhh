import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';
import { Icon } from '../components/icons.jsx';
import { useIdioma } from '../lib/i18n.js';
import { useScrollReveal } from '../lib/scrollReveal.js';
import { api } from '../api.js';

// Cursos cuyo contenido cita normativa de un país específico: se marca en
// la tarjeta para no insinuar que aplica en otros mercados (p.ej. en modo
// Perú, donde la Ley 20.920 chilena no rige). Mismo principio que cor.*
// en i18n.js: no adaptar/ocultar, aclarar.
const CURSO_PAIS = { 'fundamentos-rep': 'inst.badge_cl' };

// Landing pública del Instituto sicr3p: la línea de formación de sicr3p,
// construida sobre el módulo de capacitación interno (migración 037) que
// ya emite constancias con serial y QR de verificación pública. Solo se
// listan los cursos marcados cursos.es_publico=true (migración 063) — el
// entrenamiento puramente operativo del personal propio (uso del panel de
// mostrador) no aparece aquí. Ver docs/instituto/PLAN-INSTITUTO-SICR3P.md.
export default function InstitutoLanding() {
  const { t } = useIdioma();
  const navigate = useNavigate();
  useScrollReveal();
  const [cursos, setCursos] = useState([]);
  const [error, setError] = useState(false);
  const [serial, setSerial] = useState('');

  useEffect(() => {
    api.catalogoInstituto().then((d) => setCursos(d.cursos || [])).catch(() => setError(true));
  }, []);

  function verificar(e) {
    e.preventDefault();
    const s = serial.trim();
    if (s) navigate(`/constancia/${encodeURIComponent(s)}`);
  }

  return (
    <PublicLayout>
      <div className="av2-hero">
        <div className="container">
          <section style={{ maxWidth: 680, margin: '0 auto', textAlign: 'center' }}>
            <span className="av2-eyebrow"><span className="av-led" /> {t('inst.eyebrow')}</span>
            <h1 className="av2-h1">{t('inst.h1')}</h1>
            <p className="av2-t2"><span className="av2-grad">{t('inst.h1_grad')}</span></p>
            <p className="av2-sub">{t('inst.sub')}</p>
          </section>
        </div>
      </div>

      {/* Catálogo: viene directo del backend (solo cursos publicables) */}
      <section className="sec-pad">
        <div className="container">
          <h2 className="sec-head" style={{ textAlign: 'center' }}>{t('inst.catalogo_titulo')}</h2>
          <p className="sec-head-sub" style={{ textAlign: 'center' }}>{t('inst.catalogo_sub')}</p>

          {error && <p className="muted" style={{ textAlign: 'center' }}>{t('inst.catalogo_error')}</p>}

          {!error && (
            <div className="av2-bento" style={{ gridTemplateColumns: cursos.length > 1 ? 'repeat(auto-fit, minmax(240px, 1fr))' : '1fr' }}>
              {cursos.map((c) => (
                <div key={c.slug} className="av2-bento-card">
                  <div className="av2-bento-ico"><Icon.Book size={24} /></div>
                  <h3>{c.titulo}</h3>
                  <p>{c.descripcion}</p>
                  {CURSO_PAIS[c.slug] && (
                    <span className="badge badge-gray" style={{ marginTop: 8 }}>{t(CURSO_PAIS[c.slug])}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Cómo funciona: 3 pasos */}
      <section className="av-terminal">
        <div className="container">
          <p className="av-term-label"><span className="av-led" /> {t('inst.como_titulo')}</p>
          <h2>{t('inst.como_titulo')}</h2>
          <div className="av-flow" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="av-flow-node">
              <div className="av-ico"><Icon.Book size={20} /></div>
              <b>{t('inst.paso1_t')}</b>
              <span>{t('inst.paso1_d')}</span>
            </div>
            <div className="av-flow-node">
              <div className="av-ico"><Icon.CheckCircle size={20} /></div>
              <b>{t('inst.paso2_t')}</b>
              <span>{t('inst.paso2_d')}</span>
            </div>
            <div className="av-flow-node">
              <div className="av-ico"><Icon.Qr size={20} /></div>
              <b>{t('inst.paso3_t')}</b>
              <span>{t('inst.paso3_d')}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Verificar una constancia */}
      <section className="sec-pad">
        <div className="container">
          <div className="card card-pad" style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--green)' }}><Icon.Shield size={28} /></div>
            <h2 style={{ fontSize: 20, margin: '10px 0 6px' }}>{t('inst.verificar_titulo')}</h2>
            <form onSubmit={verificar} style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <input
                type="text"
                value={serial}
                onChange={(e) => setSerial(e.target.value)}
                placeholder={t('inst.verificar_placeholder')}
                style={{ flex: 1, minWidth: 0 }}
                aria-label={t('inst.verificar_titulo')}
              />
              <button type="submit" className="btn btn-primary">{t('inst.verificar_cta')}</button>
            </form>
          </div>
        </div>
      </section>

      {/* CTA de cierre + disclaimer de honestidad */}
      <section className="pasos">
        <div className="container">
          <div className="card card-pad av-card-hover" style={{ textAlign: 'center' }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 26 }}>{t('inst.cta_titulo')}</h2>
            <p className="muted" style={{ fontSize: 15, lineHeight: 1.6, maxWidth: 560, margin: '0 auto 20px' }}>
              {t('inst.cta_texto')}
            </p>
            <div className="hero-actions" style={{ justifyContent: 'center' }}>
              <a href="mailto:contacto@sicrep.cl?subject=Instituto%20sicr3p" className="btn btn-primary">{t('inst.cta1')}</a>
              <a href="mailto:contacto@sicrep.cl?subject=Instituto%20sicr3p%20-%20convenio" className="btn btn-outline">{t('inst.cta2')}</a>
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 20, maxWidth: 560, marginLeft: 'auto', marginRight: 'auto' }}>
              {t('inst.disclaimer')}
            </p>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
