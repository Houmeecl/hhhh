import { useEffect, useState } from 'react';
import { api, fmtFecha, fmtInt } from '../api.js';

// Tarifa oficial en CLP por t CO2e con que se calcula el cobro simulado de
// compensación. GET público (/pos/config), edición solo desde este panel.
// Extraído tal cual desde admin/Accesos.jsx (antes "TarifaCompensacion",
// vivía junto a la gestión de terminales físicos, ya descartada).
export default function CompensacionAv() {
  const [config, setConfig] = useState(null);
  const [tarifa, setTarifa] = useState('');
  const [fuente, setFuente] = useState('');
  const [tipoCambio, setTipoCambio] = useState('');
  const [tcAuto, setTcAuto] = useState(false);
  const [errorCarga, setErrorCarga] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [toast, setToast] = useState(null);
  const flash = (msg, err = false) => { setToast({ msg, err }); setTimeout(() => setToast(null), 3500); };

  useEffect(() => {
    api.posConfig()
      .then((c) => {
        setConfig(c);
        setTarifa(c?.tarifa_clp_tco2e != null ? String(c.tarifa_clp_tco2e) : '');
        setFuente(c?.fuente || '');
        setTipoCambio(c?.tipo_cambio_usd_clp != null ? String(c.tipo_cambio_usd_clp) : '');
        setTcAuto(c?.tipo_cambio_auto === true);
      })
      .catch(() => setErrorCarga(true));
  }, []);

  async function guardar() {
    const n = Number(tarifa);
    if (!n || n <= 0) { flash('Ingresa una tarifa válida en CLP por t CO2e.', true); return; }
    const tc = tipoCambio.trim() === '' ? null : Number(tipoCambio);
    if (!tcAuto && tc !== null && (!Number.isFinite(tc) || tc <= 0)) {
      flash('El tipo de cambio debe ser un número mayor que 0, o dejarse vacío para no mostrar USD.', true);
      return;
    }
    const detalleTc = tcAuto
      ? ' con dólar automático (observado BCCh, se actualiza solo)'
      : (tc != null ? ` y el tipo de cambio a $${tc} CLP por USD` : '');
    if (!window.confirm(`¿Actualizar la tarifa de compensación a $${fmtInt(n)} CLP por t CO2e${detalleTc}? Aplica de inmediato al flujo web.`)) return;
    setGuardando(true);
    try {
      const body = { tarifa_clp_tco2e: n, fuente, tipo_cambio_auto: tcAuto };
      if (!tcAuto) body.tipo_cambio_usd_clp = tc;
      const { config: c, aviso } = await api.editarPosConfig(body);
      setConfig(c);
      setTarifa(c?.tarifa_clp_tco2e != null ? String(c.tarifa_clp_tco2e) : String(n));
      setFuente(c?.fuente || fuente);
      setTipoCambio(c?.tipo_cambio_usd_clp != null ? String(c.tipo_cambio_usd_clp) : '');
      setTcAuto(c?.tipo_cambio_auto === true);
      setErrorCarga(false);
      if (aviso) flash(aviso, true);
      else flash('Configuración de compensación actualizada.');
    } catch (e) { flash(e.message, true); }
    finally { setGuardando(false); }
  }

  return (
    <div>
      <div className="admin-head"><h1>Compensación</h1></div>
      <div className="card card-pad" style={{ maxWidth: 520 }}>
        <h3 style={{ marginTop: 0 }}>Tarifa de compensación y tipo de cambio</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          CLP por t CO2e con que el flujo de terreno calcula el cobro de compensación
          (pago simulado — sin pasarela conectada). El tipo de cambio define el equivalente en USD
          que se muestra junto a los montos.
        </p>
        {config && (
          <div style={{ padding: '10px 14px', background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
            Vigente: <b>${fmtInt(config.tarifa_clp_tco2e)} CLP / t CO2e</b>
            <div style={{ fontSize: 12, marginTop: 2 }}>
              {config.tipo_cambio_usd_clp != null
                ? <>Tipo de cambio: <b>${config.tipo_cambio_usd_clp} CLP / USD</b>{config.tipo_cambio_auto && ' · automático'}</>
                : config.tipo_cambio_auto
                  ? <span className="muted">Dólar automático activado — esperando la primera actualización…</span>
                  : <span className="muted">Tipo de cambio USD sin fijar — el sitio no muestra montos en USD.</span>}
              {config.tipo_cambio_fuente && (
                <div className="muted" style={{ fontSize: 12 }}>
                  {config.tipo_cambio_fuente}
                  {config.tipo_cambio_actualizado && ` · actualizado el ${fmtFecha(config.tipo_cambio_actualizado)}`}
                </div>
              )}
            </div>
            {config.fuente && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>Fuente: {config.fuente}</div>}
            {config.updated_at && <div className="muted" style={{ fontSize: 12 }}>Actualizada el {fmtFecha(config.updated_at)}</div>}
          </div>
        )}
        {errorCarga && (
          <div className="badge badge-red" style={{ display: 'block', padding: '8px 12px', marginBottom: 12 }}>
            No se pudo cargar la tarifa vigente.
          </div>
        )}
        <div className="field">
          <label>Nueva tarifa (CLP por t CO2e)</label>
          <input inputMode="numeric" value={tarifa} placeholder="5000"
            onChange={(e) => setTarifa(e.target.value.replace(/\D/g, ''))} />
        </div>
        <div className="field">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={tcAuto} onChange={(e) => setTcAuto(e.target.checked)}
              style={{ width: 'auto', margin: 0 }} />
            Actualizar el dólar automáticamente (observado BCCh vía mindicador.cl, cada 6 h)
          </label>
        </div>
        {tcAuto ? (
          <p className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
            El servidor obtiene el dólar observado del Banco Central y lo mantiene al día solo.
            Si la fuente falla, conserva el último valor conocido.
          </p>
        ) : (
          <div className="field">
            <label>Tipo de cambio (CLP por USD, opcional)</label>
            <input inputMode="decimal" value={tipoCambio} placeholder="943.5 (dólar observado BCCh)"
              onChange={(e) => setTipoCambio(e.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1'))} />
            <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
              Vacío = no se muestran montos en USD. Fija el dólar observado del Banco Central y cita la fuente abajo.
            </p>
          </div>
        )}
        <div className="field" style={{ marginBottom: 14 }}>
          <label>Fuente (opcional)</label>
          <input value={fuente} placeholder="Impuesto verde US$5/t · dólar observado BCCh 20-07-2026"
            onChange={(e) => setFuente(e.target.value)} />
        </div>
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={guardar} disabled={guardando || !tarifa}>
          {guardando ? <span className="spinner" /> : 'Guardar tarifa'}
        </button>
      </div>
      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}
