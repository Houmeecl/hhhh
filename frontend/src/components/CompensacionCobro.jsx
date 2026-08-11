import { useEffect, useState } from 'react';
import { Icon } from './icons.jsx';
import { api, fmt, fmtInt } from '../api.js';

// Compensación voluntaria del CO2 calculado (monto = t CO2e × tarifa vigente
// en /panel-verde/compensacion). Pago SIEMPRE simulado — no hay pasarela
// conectada todavía. Antes vivía solo dentro del terminal físico /pos
// (descontinuado); ahora es el paso de cobro del panel de mostrador
// /panel-verde/cargar. Componente controlado: `compensacion` (la ya
// guardada en el servidor, o null) vive en la página que lo usa.
export default function CompensacionCobro({ sesionId, totalCo2e, compensacion, onCompensacion }) {
  const [config, setConfig] = useState(null);
  const [configFallo, setConfigFallo] = useState(false);
  const [tarifa, setTarifa] = useState('5000');
  const [metodo, setMetodo] = useState('tarjeta');
  const [procesando, setProcesando] = useState(false);
  const [omitiendo, setOmitiendo] = useState(false);
  const [error, setError] = useState('');
  const [editando, setEditando] = useState(!compensacion);

  useEffect(() => {
    let vivo = true;
    api.posConfig()
      .then((c) => { if (!vivo) return; setConfig(c); if (c?.tarifa_clp_tco2e != null) setTarifa(String(c.tarifa_clp_tco2e)); })
      .catch(() => { if (vivo) setConfigFallo(true); });
    return () => { vivo = false; };
  }, []);

  const tarifaNum = Number(tarifa) || 0;
  const monto = Math.round((Number(totalCo2e) || 0) * tarifaNum);

  async function registrar(estado, extra = {}) {
    setError('');
    try {
      const { compensacion: c } = await api.registrarCompensacion(sesionId, { estado, ...extra });
      onCompensacion(c);
      setEditando(false);
    } catch (e) {
      setError(e.message || 'No se pudo registrar la compensación. Intenta de nuevo.');
    }
  }

  async function cobrar() {
    setProcesando(true);
    await registrar('simulado', { metodo });
    setProcesando(false);
  }
  async function omitir() {
    setOmitiendo(true);
    await registrar('omitido');
    setOmitiendo(false);
  }

  if (compensacion && !editando) {
    return (
      <div className="card card-pad" style={{ marginTop: 16 }}>
        <h3 style={{ margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="send-check-pop" style={{ color: 'var(--green-600)', display: 'inline-flex' }}><Icon.CheckCircle size={18} /></span>
          Compensación voluntaria
        </h3>
        {compensacion.estado === 'simulado' ? (
          <div>
            <b>${fmtInt(compensacion.monto_clp)} CLP</b>{' '}
            <span className="badge badge-amber">Pago simulado · {compensacion.metodo}</span>
          </div>
        ) : (
          <span className="badge badge-gray">Sin cobro (omitido)</span>
        )}
        <div style={{ marginTop: 10 }}>
          <button className="btn btn-outline btn-sm" onClick={() => setEditando(true)}>Modificar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="card card-pad" style={{ marginTop: 16 }}>
      <h3 style={{ margin: '0 0 4px' }}>Compensación voluntaria</h3>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Monto referencial para compensar las toneladas de CO2e calculadas.
      </p>

      <div className="field">
        <label>Tarifa por t CO2e (CLP)</label>
        {config ? (
          <>
            <input inputMode="numeric" value={tarifa} readOnly aria-readonly="true" style={{ background: 'var(--bg)' }} />
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Tarifa vigente — configurable en Compensación{config.fuente ? ` · Fuente: ${config.fuente}` : ''}.
            </div>
          </>
        ) : (
          <>
            <input inputMode="numeric" value={tarifa} onChange={(e) => setTarifa(e.target.value.replace(/\D/g, ''))} />
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              {configFallo ? 'No se pudo cargar la tarifa oficial — valor referencial editable.' : 'Tarifa referencial — validar.'}
            </div>
          </>
        )}
      </div>

      <div className="result-box" style={{ margin: '14px 0', textAlign: 'center' }}>
        <div className="muted" style={{ fontSize: 13 }}>{fmt(totalCo2e, 3)} t CO2e × ${fmtInt(tarifaNum)}</div>
        <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--navy)' }}>= ${fmtInt(monto)} CLP</div>
      </div>

      <div className="field" style={{ marginBottom: 14 }}>
        <label>Método de pago</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8 }}>
          {[['tarjeta', 'Tarjeta', Icon.CreditCard], ['nfc', 'NFC', Icon.Nfc], ['qr', 'QR', Icon.Qr]].map(([valor, etiqueta, Ico]) => (
            <label key={valor} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '10px 8px', borderRadius: 10, cursor: 'pointer', fontWeight: 600, fontSize: 13,
              border: `1.5px solid ${metodo === valor ? 'var(--green)' : 'var(--border)'}`,
              background: metodo === valor ? 'var(--green-50)' : '#fff',
              color: metodo === valor ? 'var(--green-600)' : 'var(--navy)',
            }}>
              <input type="radio" name="metodo-pago-cargar" value={valor} checked={metodo === valor}
                onChange={() => setMetodo(valor)} style={{ position: 'absolute', opacity: 0 }} />
              <Ico size={16} /> {etiqueta}
            </label>
          ))}
        </div>
      </div>

      {error && <div className="badge badge-red" style={{ display: 'block', padding: '10px 14px', marginBottom: 10 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-primary btn-sm" onClick={cobrar} disabled={procesando || omitiendo || monto <= 0}>
          {procesando ? <span className="spinner" /> : `Cobrar $${fmtInt(monto)}`}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={omitir} disabled={procesando || omitiendo}>
          {omitiendo ? <span className="spinner dark" /> : 'Omitir cobro'}
        </button>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
        Pago simulado — sin pasarela conectada todavía. Con la integración real (ej. VirtualPos) este paso se reemplaza por el cobro efectivo.
      </p>
    </div>
  );
}
