import { useEffect, useState } from 'react';
import { Icon } from '../components/icons.jsx';
import { api } from '../api.js';

// Catálogo 100% simbólico (insignias y constancias de participación) —
// nunca dinero ni descuentos reales, no hay pasarela de pago conectada
// (mismo criterio que la compensación de CO2e simulada, ver
// COMPENSACION_HABILITADA). Una constancia de canje NUNCA se llama
// "certificación": es participación interna, verificable por su serial.
export default function Recompensas() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [canjeando, setCanjeando] = useState(null); // id en curso
  const [canjes, setCanjes] = useState({}); // id → canje resultante

  function cargar() {
    api.jugadorRecompensas().then(setData).catch((e) => setError(e.message));
  }
  useEffect(cargar, []);

  async function canjear(r) {
    setError(''); setCanjeando(r.id);
    try {
      const { canje } = await api.jugadorCanjear(r.id);
      setCanjes((c) => ({ ...c, [r.id]: canje }));
      cargar(); // refresca puntos_totales restantes
    } catch (e) { setError(e.message); }
    finally { setCanjeando(null); }
  }

  if (error) return <div className="badge badge-red" style={{ display: 'block', padding: '10px 14px' }}>{error}</div>;
  if (!data) return <div style={{ textAlign: 'center', padding: 40 }}><span className="spinner dark" /></div>;

  return (
    <div>
      <h1 style={{ fontSize: 20, margin: '0 0 4px' }}>Premios</h1>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Insignias y constancias de participación — sin valor monetario. Tienes <b>{data.puntos_totales} pts</b>.
      </p>

      <div style={{ display: 'grid', gap: 12 }}>
        {data.recompensas.map((r) => {
          const canje = canjes[r.id];
          const alcanza = data.puntos_totales >= r.costo_puntos;
          return (
            <div className="card card-pad" key={r.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <b style={{ fontSize: 14 }}>{r.nombre}</b>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{r.descripcion}</div>
                </div>
                <span className="badge badge-gray" style={{ flexShrink: 0 }}><Icon.Coin size={12} /> {r.costo_puntos} pts</span>
              </div>

              {canje ? (
                <div className="badge badge-green" style={{ display: 'block', padding: '8px 12px', marginTop: 10 }}>
                  Canjeado{canje.serial ? ` — serial ${canje.serial}` : ''}
                  {canje.serial && (
                    <div style={{ marginTop: 4 }}>
                      <a href={api.constanciaJuegoUrl(canje.serial)} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                        Ver constancia pública
                      </a>
                    </div>
                  )}
                </div>
              ) : (
                <button
                  className="btn btn-outline btn-sm" style={{ marginTop: 10 }}
                  disabled={!alcanza || canjeando === r.id}
                  onClick={() => canjear(r)}
                >
                  {canjeando === r.id ? <span className="spinner dark" /> : alcanza ? 'Canjear' : 'Puntos insuficientes'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p className="muted" style={{ fontSize: 12, marginTop: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon.Info size={14} /> Las constancias son un reconocimiento interno de sicr3p — no constituyen una
        certificación acreditada de terceros.
      </p>
    </div>
  );
}
