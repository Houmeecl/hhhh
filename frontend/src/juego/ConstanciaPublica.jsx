import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';
import { Icon } from '../components/icons.jsx';
import { api } from '../api.js';

function fmtFecha(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('es-CL');
}

// Verificación pública de un canje de "Sube y Suma" — mismo molde que
// pages/ConstanciaPublica.jsx (capacitación interna). El serial ES la
// credencial: no requiere login.
export default function ConstanciaPublicaSuma() {
  const { serial } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.constanciaJuegoPublica(serial).then((d) => setData(d.constancia)).catch((e) => setError(e.message));
  }, [serial]);

  return (
    <PublicLayout>
      <div className="container" style={{ padding: '48px 24px', maxWidth: 720 }}>
        {error && (
          <div className="card card-pad" style={{ textAlign: 'center' }}>
            <div style={{ color: '#b45309', display: 'flex', justifyContent: 'center' }}><Icon.Alert size={40} /></div>
            <h2>Constancia no encontrada</h2>
            <p className="muted">No pudimos verificar esta constancia. Revisa el serial e inténtalo de nuevo.</p>
          </div>
        )}

        {data && (
          <div className="card card-pad pasaporte-doc">
            <div className="pas-head">
              <div style={{ minWidth: 0 }}>
                <div className="pas-kicker">sicr3p — Sube y Suma</div>
                <h1 style={{ fontSize: 24, margin: '10px 0 6px' }}>{data.recompensa_nombre}</h1>
                <div className="pas-code">{data.serial}</div>
                <p className="muted" style={{ margin: '10px 0 12px', fontSize: 14 }}>{data.recompensa_descripcion}</p>
                <span className="badge badge-green" style={{ fontSize: 13, padding: '5px 12px' }}>✓ Canje verificado</span>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div className="pas-qr">
                  <img src={api.constanciaJuegoQrUrl(data.serial)} alt="Código QR de verificación" width={104} height={104} />
                </div>
                <div className="muted" style={{ fontSize: 11, maxWidth: 128, margin: '6px auto 0' }}>Escanea para verificar</div>
              </div>
            </div>

            <div className="pasaporte-sec">
              <div className="pas-grid">
                <div><span className="pas-lbl">Puntos canjeados</span><b>{data.puntos_gastados}</b></div>
                <div><span className="pas-lbl">Fecha</span><b>{fmtFecha(data.created_at)}</b></div>
              </div>
            </div>

            <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>
              Constancia de participación interna de la campaña "Sube y Suma" emitida por sicr3p. No constituye una
              certificación acreditada de terceros ni tiene valor monetario.
            </p>
          </div>
        )}
      </div>
    </PublicLayout>
  );
}
