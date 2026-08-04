import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import Logo from './Logo.jsx';
import { IDIOMAS, useIdioma } from '../lib/i18n.js';

// Nombre legible de cada idioma/variante para el aria-label de los botones
// (las banderas no son accesibles por sí solas para lectores de pantalla).
const NOMBRE_IDIOMA = { es: 'Español (Chile)', en: 'English', pt: 'Português', pe: 'Español (Perú)' };
// 'pe' no es un idioma nuevo: mismo español, con RUC/Sol/Huella de Carbono
// Perú en vez de RUT/CLP/HuellaChile (ver comentario en lib/i18n.js).
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
          {' · '}
          <a href="/inscripcion" style={{ color: 'inherit' }}>{t('layout.inscribete')}</a>
          {' · '}{t('layout.tagline')} · www.sicr3p.cl
        </span>
      </footer>
    </div>
  );
}
