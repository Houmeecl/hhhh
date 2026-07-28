import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import Logo from './Logo.jsx';
import { IDIOMAS, useIdioma } from '../lib/i18n.js';

// Nombre legible de cada idioma para el aria-label de los botones.
const NOMBRE_IDIOMA = { es: 'Español', en: 'English', pt: 'Português' };

// Selector discreto "ES · EN · PT". Se usa en este layout y en el layout
// propio del canal presencial; jamás aparece en /admin.
export function SelectorIdioma() {
  const { idioma, setIdioma, t } = useIdioma();
  return (
    <span className="lang-switch" role="group" aria-label={t('layout.idioma')}>
      {IDIOMAS.map((l, i) => (
        <Fragment key={l}>
          {i > 0 && <span aria-hidden="true">·</span>}
          <button
            type="button"
            className={idioma === l ? 'on' : ''}
            aria-pressed={idioma === l}
            aria-label={NOMBRE_IDIOMA[l]}
            onClick={() => setIdioma(l)}
          >
            {l.toUpperCase()}
          </button>
        </Fragment>
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
          <Link to="/cargar" className="muted" style={{ color: 'var(--navy)', fontWeight: 600 }}>
            {t('layout.comienza')}
          </Link>
          <Link to="/ingresar" className="btn btn-outline btn-sm">{t('layout.ingresar')}</Link>
        </nav>
      </header>

      <main style={{ flex: 1 }}>{children}</main>

      <footer className="pub-footer">
        <Logo size={22} light />
        <span>SICR3P SpA · Antofagasta, Chile</span>
        <span>
          <a href="/cadena" style={{ color: 'inherit' }}>{t('layout.cadena')}</a>
          {' · '}{t('layout.tagline')} · www.sicr3p.cl
        </span>
      </footer>
    </div>
  );
}
