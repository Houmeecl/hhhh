import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/icons.jsx';
import { api } from '../api.js';

// Inicio: puntos, nivel y progreso — igual de espíritu al dashboard del
// mockup ("Scan2Green"), sin el nombre ni la marca ajena. Nunca dice
// "huella" ni implica que los puntos sean bonos de carbono reales: son un
// puntaje interno de participación sobre el CO2e que el motor propio ya
// calculó al escanear.
export default function Perfil() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.jugadorPerfil().then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="badge badge-red" style={{ display: 'block', padding: '10px 14px' }}>{error}</div>;
  if (!data) return <div style={{ textAlign: 'center', padding: 40 }}><span className="spinner dark" /></div>;

  const { nivel, misiones } = data;
  const pct = nivel.umbralSiguiente
    ? Math.min(100, Math.round(((nivel.puntos - nivel.umbralActual) / (nivel.umbralSiguiente - nivel.umbralActual)) * 100))
    : 100;
  const activas = misiones.filter((m) => !m.completada_at).slice(0, 2);

  return (
    <div>
      <div className="card card-pad" style={{ textAlign: 'center' }}>
        <div className="muted" style={{ fontSize: 13 }}>Nivel {nivel.nivel}</div>
        <div style={{ fontSize: 22, fontWeight: 800 }}>{nivel.nombre}</div>
        <div style={{ fontSize: 36, fontWeight: 800, color: 'var(--suma-accent)', margin: '6px 0' }}>{nivel.puntos} pts</div>
        <div className="game-level-bar" style={{ marginTop: 10 }}>
          <div style={{ width: `${pct}%` }} />
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          {nivel.umbralSiguiente
            ? `${nivel.puntosParaSiguiente} pts para el siguiente nivel`
            : 'Nivel máximo alcanzado'}
        </div>
      </div>

      <div className="stat-grid" style={{ marginTop: 14 }}>
        <Link to="/suma/escanear" className="card card-pad" style={{ textAlign: 'center' }}>
          <div style={{ color: 'var(--suma-accent)' }}><Icon.Camera size={26} /></div>
          <div style={{ fontWeight: 700, marginTop: 6, fontSize: 13 }}>Escanear</div>
        </Link>
        <Link to="/suma/trayecto" className="card card-pad" style={{ textAlign: 'center' }}>
          <div style={{ color: 'var(--suma-accent)' }}><Icon.Truck size={26} /></div>
          <div style={{ fontWeight: 700, marginTop: 6, fontSize: 13 }}>Trayecto</div>
        </Link>
      </div>

      {activas.length > 0 && (
        <div className="card card-pad" style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <b style={{ fontSize: 14 }}>Misiones activas</b>
            <Link to="/suma/misiones" className="muted" style={{ fontSize: 12 }}>Ver todas</Link>
          </div>
          {activas.map((m) => (
            <div key={m.codigo} style={{ marginTop: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span>{m.nombre}</span>
                <span className="muted">{m.progreso}/{m.meta_valor}</span>
              </div>
              <div className="game-level-bar" style={{ marginTop: 4 }}>
                <div style={{ width: `${Math.min(100, Math.round((m.progreso / m.meta_valor) * 100))}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="muted" style={{ fontSize: 12, marginTop: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon.Info size={14} /> Los puntos son un reconocimiento interno de participación — no equivalen a bonos de
        carbono ni a una certificación de terceros.
      </p>
    </div>
  );
}
