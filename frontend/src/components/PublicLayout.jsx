import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import Logo from './Logo.jsx';
import { IDIOMAS, useIdioma } from '../lib/i18n.js';

// Nombre legible de cada idioma/variante para el aria-label de los botones
// (las banderas no son accesibles por sí solas para lectores de pantalla).
const NOMBRE_IDIOMA = { es: 'Español (Chile)', en: 'English', pt: 'Português', pe: 'Español (Perú)' };
// 'pe' no es un idioma nuevo: mismo español, con RUC y soles en vez de RUT y
// pesos. Los factores siguen siendo los chilenos y la variante lo dice así
// (ver el comentario del bloque `pe` en lib/i18n.js).
const BANDERA_IDIOMA = { es: '🇨🇱', en: '🇺🇸', pt: '🇧🇷', pe: '🇵🇪' };

// Selector de banderas clicables. Se usa en este layout y en el layout
// propio del canal presencial; jamás aparece en /admin.
export function SelectorIdioma() {
  const { idioma, setIdioma, t } = useIdioma();
  return (
    <span className="lang-switch" role="group" aria-label={t('layout.idioma')}>
      {IDIOMAS.map((l) => (
        <button
          key={l}
          type="button"
          className={idioma === l ? 'on' : ''}
          aria-pressed={idioma === l}
          aria-label={NOMBRE_IDIOMA[l]}
          title={NOMBRE_IDIOMA[l]}
          onClick={() => setIdioma(l)}
        >
          <span aria-hidden="true">{BANDERA_IDIOMA[l]}</span>
        </button>
      ))}
    </span>
  );
}

export default function PublicLayout({ children }) {
  const { t } = useIdioma();
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header className="pub-header">
        <Link to="/" style={{ textDecoration: 'none' }}>
          <Logo size={28} tagline />
        </Link>
        <nav>
          <SelectorIdioma />
          <Link to="/inscripcion" className="muted" style={{ color: 'var(--navy)', fontWeight: 600 }}>
            {t('layout.inscribete')}
          </Link>
          <Link to="/ingresar" className="btn btn-outline btn-sm">{t('layout.ingresar')}</Link>
        </nav>
      </header>

      <main style={{ flex: 1 }}>{children}</main>

      <footer className="pub-footer">
        <Logo size={22} light />
        <span>SICR3P SpA · Antofagasta, Chile</span>
        <span>
          {/* Link de react-router (SPA), no <a href>: rutas internas del
              mismo sitio no deben recargar la página completa — el header
              de arriba ya navega así, el footer tiene que hacer lo mismo. */}
          <Link to="/cadena" style={{ color: 'inherit' }}>{t('layout.cadena')}</Link>
          {' · '}
          <Link to="/inscripcion" style={{ color: 'inherit' }}>{t('layout.inscribete')}</Link>
          {' · '}
          {/* Descubribilidad del ejercicio de derechos (Ley 21.719): el
              titular tiene que poder encontrar /mis-datos sin conocer la URL. */}
          <Link to="/mis-datos" style={{ color: 'inherit' }}>{t('layout.mis_datos')}</Link>
          {' · '}
          <Link to="/auspicio" style={{ color: 'inherit' }}>{t('layout.auspicio')}</Link>
          {' · '}{t('layout.tagline')} · www.sicr3p.cl
        </span>

        {/* Reconocimiento territorial. Va acá, junto a donde ya decimos
            desde dónde operamos, y NO como una opción del selector de
            idiomas: el ckunsa no tiene hablantes nativos y acuñar los
            términos que faltarían le corresponde al Consejo Lingüístico
            Ckunsa, no a sicr3p (ver el comentario en lib/i18n.js). El
            texto explica la ausencia en vez de disimularla. */}
        <span style={{ fontSize: 12, opacity: .75, maxWidth: 720, lineHeight: 1.6 }}>
          {t('layout.territorio')}{' '}
          <a href="https://www.lenguackunsa.cl" target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>
            {t('layout.territorio_enlace')}
          </a>
        </span>
      </footer>
    </div>
  );
}
