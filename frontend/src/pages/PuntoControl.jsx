import { useParams, Link } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';
import { Icon } from '../components/icons.jsx';
import { PUNTOS_CORREDOR } from '../lib/corredor.js';

// Página informativa del QR físico de un punto de control del Corredor
// Bioceánico (cartel impreso en el puerto/frontera/estacionamiento). El
// portador de la Tarjeta de Viaje la abre desde el escáner de la app
// (frontend/src/lib/qrScan.js) y esta pantalla nunca se usa en ese flujo;
// existe para el caso en que alguien la abra con la cámara nativa del
// teléfono fuera de la app — no debe romper nada, solo explicar qué es.
export default function PuntoControl() {
  const { puntoId } = useParams();
  const punto = PUNTOS_CORREDOR.find((p) => p.id === puntoId);

  return (
    <PublicLayout>
      <div className="container" style={{ padding: '48px 24px', maxWidth: 480 }}>
        <div className="card card-pad" style={{ textAlign: 'center' }}>
          {punto ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--green)' }}><Icon.Shield size={36} /></div>
              <h1 style={{ fontSize: 22, margin: '12px 0 4px' }}>{punto.nombre}</h1>
              <p className="muted" style={{ fontSize: 13, marginBottom: 20 }}>Punto de control del Corredor Bioceánico · {punto.pais}</p>
              <p style={{ fontSize: 14, lineHeight: 1.6 }}>
                Si eres el portador de una Tarjeta de Viaje, vuelve a la pantalla de tu tarjeta
                (<code>/v/…</code>) y usa <b>"Escanear punto de control"</b> para registrar tu paso aquí.
              </p>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'center', color: '#b45309' }}><Icon.Alert size={36} /></div>
              <h1 style={{ fontSize: 20, margin: '12px 0 4px' }}>Punto de control no reconocido</h1>
              <p className="muted" style={{ fontSize: 13 }}>Este código no corresponde a ningún punto del corredor.</p>
            </>
          )}
          <Link className="btn btn-outline" style={{ marginTop: 20, display: 'inline-block' }} to="/">
            Ir a sicr3p
          </Link>
        </div>
      </div>
    </PublicLayout>
  );
}
