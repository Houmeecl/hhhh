import { useEffect, useState } from 'react';
import { Icon } from '../components/icons.jsx';
import { api } from '../api.js';

// Panel de impacto personal: el CO2e real detrás de los puntos del jugador
// — nunca "huella", nunca certificación. Mismo esqueleto minimalista que
// Perfil.jsx (sin gráficos).
export default function Impacto() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.jugadorImpacto().then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="badge badge-red" style={{ display: 'block', padding: '10px 14px' }}>{error}</div>;
  if (!data) return <div style={{ textAlign: 'center', padding: 40 }}><span className="spinner dark" /></div>;

  return (
    <div>
      <div className="card card-pad" style={{ textAlign: 'center' }}>
        <div className="muted" style={{ fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Icon.Leaf size={16} /> CO2e que registraste escaneando
        </div>
        <div style={{ fontSize: 36, fontWeight: 800, color: 'var(--suma-accent)', margin: '6px 0' }}>
          {data.co2e_total.toLocaleString('es-CL', { maximumFractionDigits: 2 })} t CO2e
        </div>
        <div className="muted" style={{ fontSize: 13 }}>
          {data.documentos} {data.documentos === 1 ? 'documento escaneado' : 'documentos escaneados'}
        </div>
      </div>

      <p className="muted" style={{ fontSize: 12, marginTop: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon.Info size={14} /> Este es el CO2e que el motor de sicr3p calculó sobre los documentos que tú
        escaneaste. No es una certificación ni una verificación de terceros: es un resumen de tu participación.
      </p>
    </div>
  );
}
