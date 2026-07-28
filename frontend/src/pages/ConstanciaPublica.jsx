import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';
import { Icon } from '../components/icons.jsx';
import { api } from '../api.js';

function fmtFecha(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('es-CL');
}

// Verificación pública de una constancia de capacitación interna — mismo
// molde "documento oficial" que Verificar.jsx/PasaporteLote.jsx. El serial
// ES la credencial: no requiere login para verificarse.
export default function ConstanciaPublica() {
  const { serial } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.constanciaPublica(serial).then((d) => setData(d.constancia)).catch((e) => setError(e.message));
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
                <div className="pas-kicker">sicr3p</div>
                <h1 style={{ fontSize: 24, margin: '10px 0 6px' }}>Constancia de participación</h1>
                <div className="pas-code">{data.serial}</div>
                <p className="muted" style={{ margin: '10px 0 12px', fontSize: 14 }}>
                  Capacitación interna de personal — no es una certificación acreditada de terceros.
                </p>
                <span className="badge badge-green" style={{ fontSize: 13, padding: '5px 12px' }}>✓ Evaluación aprobada</span>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div className="pas-qr">
                  <img src={api.constanciaQrUrl(data.serial)} alt="Código QR de verificación" width={104} height={104} />
                </div>
                <div className="muted" style={{ fontSize: 11, maxWidth: 128, margin: '6px auto 0' }}>Escanea para verificar</div>
              </div>
            </div>

            <div className="pasaporte-sec">
              <div className="pas-grid">
                <div><span className="pas-lbl">Nombre</span><b>{data.usuario_nombre}</b></div>
                <div><span className="pas-lbl">Curso</span><b>{data.curso_titulo}</b></div>
                <div><span className="pas-lbl">Puntaje</span><b>{data.puntaje_pct}%</b></div>
                <div><span className="pas-lbl">Emitida</span><b>{fmtFecha(data.emitida_at)}</b></div>
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <a className="btn btn-primary" href={api.constanciaUrl(data.serial)} target="_blank" rel="noreferrer">
                <Icon.Download size={17} /> Descargar PDF
              </a>
            </div>

            <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>
              Constancia de participación interna emitida por sicr3p para su personal de terreno. No constituye una
              certificación acreditada de terceros.
            </p>
          </div>
        )}
      </div>
    </PublicLayout>
  );
}
