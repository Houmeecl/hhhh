import { Link } from 'react-router-dom';
import Logo from './Logo.jsx';

export default function PublicLayout({ children }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header className="pub-header">
        <Link to="/" style={{ textDecoration: 'none' }}>
          <Logo size={28} tagline />
        </Link>
        <nav>
          <Link to="/cargar" className="muted" style={{ color: 'var(--navy)', fontWeight: 600 }}>
            Comienza ahora
          </Link>
          <Link to="/ingresar" className="btn btn-outline btn-sm">Ingresar</Link>
        </nav>
      </header>

      <main style={{ flex: 1 }}>{children}</main>

      <footer className="pub-footer">
        <Logo size={22} light />
        <span>SICR3P SpA · Antofagasta, Chile</span>
        <span>
          <a href="/cadena" style={{ color: 'inherit' }}>Cadena de integridad</a>
          {' · '}Contabilidad de carbono trazable · www.sicr3p.cl
        </span>
      </footer>
    </div>
  );
}
