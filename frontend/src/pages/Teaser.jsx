import { useEffect, useState } from 'react';
import './Teaser.css';

export default function Teaser() {
  const [reducido, setReducido] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducido(media.matches);
    const actualizar = (e) => setReducido(e.matches);
    media.addEventListener?.('change', actualizar);
    return () => media.removeEventListener?.('change', actualizar);
  }, []);

  return (
    <main className="sicr-teaser">
      <div className="sicr-background" aria-hidden="true" />
      <div className="sicr-teaser-content">
        <header className="sicr-header">
          <a href="/" className="sicr-brand" aria-label="SICR3P, inicio">
            sicr<span className="sicr-three">3<i className="sicr-node n1"/><i className="sicr-node n2"/><i className="sicr-node n3"/></span>p
          </a>
          <span className="sicr-soon">PRÓXIMAMENTE</span>
        </header>
        <div className="sicr-copy">
          <h1>Algo está<br />tomando <em>forma.</em></h1>
          <p>No todo lo importante<br />se ve a simple vista.</p>
          <a className="sicr-action" href="/firma">Mientras construimos, ayúdanos a dar el siguiente paso <span aria-hidden="true">→</span></a>
          <p className="sicr-promise">Te lo firmamos. Pronto entenderás por qué.</p>
        </div>
        <div className={'sicr-scene' + (reducido ? ' reduced' : '')} aria-label="Centro de datos con una fila simbólica de agentes de IA y MCP que avanzan hacia dos puertas: aprobado o rechazado.">
          <div className="sicr-ceiling" />
          <div className="sicr-racks left">{[0,1,2,3,4].map(n=><div className="sicr-rack" key={n}><div className="sicr-leds"/></div>)}</div>
          <div className="sicr-racks right">{[0,1,2,3,4].map(n=><div className="sicr-rack" key={n}><div className="sicr-leds"/></div>)}</div>
          <div className="sicr-floor"/>
          <div className="sicr-doors">
            <div className="sicr-door approved"><span aria-hidden="true">✓</span><small>APROBADO</small></div>
            <div className="sicr-door denied"><span aria-hidden="true">×</span><small>REVISIÓN</small></div>
          </div>
          <div className="sicr-path" aria-hidden="true"/>
          <div className="sicr-agents" aria-hidden="true">{['IA','MCP','','',''].map((label,i)=><div className="sicr-agent" key={i} style={{ '--order':i }}><span>{label}</span></div>)}</div>
        </div>
        <footer className="sicr-footer"><span>Con la tecnología de</span><strong className="sicr-kontax">Kontax<span className="sicr-smile">⌣</span></strong></footer>
      </div>
    </main>
  );
}
