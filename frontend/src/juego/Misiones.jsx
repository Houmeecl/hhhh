import { useEffect, useState } from 'react';
import { Icon } from '../components/icons.jsx';
import { api, fmtInt } from '../api.js';

// Misiones activas (con progreso) + ranking interno de la MISMA empresa —
// el backend garantiza que el ranking nunca cruza códigos de campaña
// distintos (ver GET /api/juego/ranking).
export default function Misiones() {
  const [perfil, setPerfil] = useState(null);
  const [ranking, setRanking] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.jugadorPerfil(), api.jugadorRanking()])
      .then(([p, r]) => { setPerfil(p); setRanking(r.ranking); })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="badge badge-red" style={{ display: 'block', padding: '10px 14px' }}>{error}</div>;
  if (!perfil) return <div style={{ textAlign: 'center', padding: 40 }}><span className="spinner dark" /></div>;

  return (
    <div>
      <h1 style={{ fontSize: 20, margin: '0 0 4px' }}>Misiones</h1>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Completa misiones para ganar puntos extra.</p>

      <div style={{ display: 'grid', gap: 12 }}>
        {perfil.misiones.map((m) => {
          const pct = Math.min(100, Math.round((m.progreso / m.meta_valor) * 100));
          return (
            <div className="card card-pad" key={m.codigo}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <b style={{ fontSize: 14 }}>{m.nombre}</b>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{m.descripcion}</div>
                </div>
                {m.completada_at ? (
                  <span className="badge badge-green" style={{ flexShrink: 0 }}><Icon.Check size={12} /> Completa</span>
                ) : (
                  <span className="badge badge-gray" style={{ flexShrink: 0 }}>+{m.puntos_recompensa} pts</span>
                )}
              </div>
              <div className="game-level-bar" style={{ marginTop: 10 }}>
                <div style={{ width: `${pct}%` }} />
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{m.progreso}/{m.meta_valor}</div>
            </div>
          );
        })}
      </div>

      <h2 style={{ fontSize: 16, marginTop: 24 }}>Ranking — {perfil.jugador.empresa}</h2>
      <div className="card card-pad">
        <div className="table-scroll">
          <table className="data">
            <tbody>
              {ranking.map((r) => (
                <tr key={r.posicion} style={r.tu ? { fontWeight: 700, background: 'rgba(13,148,136,0.08)' } : undefined}>
                  <td style={{ width: 32 }}>{r.posicion}</td>
                  <td>{r.nombre}{r.tu && <span className="muted" style={{ fontWeight: 400 }}> (tú)</span>}</td>
                  <td className="num muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                    {r.envases_reciclados > 0 && <><Icon.Recycle size={12} /> {fmtInt(r.envases_reciclados)}</>}
                  </td>
                  <td className="num">{fmtInt(r.puntos_totales)} pts</td>
                </tr>
              ))}
              {ranking.length === 0 && (
                <tr><td colSpan={4} className="muted">Aún no hay jugadores en el ranking.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
