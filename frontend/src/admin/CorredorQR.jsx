import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { PUNTOS_CORREDOR } from '../lib/corredor.js';

// Carteles QR imprimibles de los puntos de control del Corredor
// Bioceánico — el portador de la Tarjeta de Viaje los escanea en terreno
// para autocompletar el paso en vez de tipearlo (frontend/lib/qrScan.js +
// TarjetaViaje.jsx). "Imprimir carteles" usa el diálogo de impresión del
// propio navegador (el admin elige "Guardar como PDF" si quiere un
// archivo) — no se genera PDF en el backend para no duplicar el catálogo
// nombre/país, que hoy solo vive acá en el frontend.
export default function CorredorQR() {
  const [qrs, setQrs] = useState({});
  const [error, setError] = useState('');

  useEffect(() => {
    let vivo = true;
    const urls = [];
    Promise.all(PUNTOS_CORREDOR.map(async (p) => {
      try {
        const url = await api.origenCorredorQrBlob(p.id);
        urls.push(url);
        if (vivo) setQrs((prev) => ({ ...prev, [p.id]: url }));
      } catch { if (vivo) setError('No se pudieron generar todos los QR.'); }
    }));
    return () => { vivo = false; urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, []);

  return (
    <div>
      <div className="admin-head no-print">
        <h1>Carteles QR — Corredor Bioceánico</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link className="btn btn-outline" to="/admin/origen">← Volver a Pasaporte de Origen</Link>
          <button className="btn btn-primary" onClick={() => window.print()}>Imprimir carteles</button>
        </div>
      </div>
      <p className="muted no-print" style={{ fontSize: 13, marginBottom: 20 }}>
        Un cartel por punto de control. Imprime en alto contraste y lamina o protege de la intemperie —
        el sol directo en los pasos fronterizos puede lavar el QR y dificultar la lectura con la cámara del celular.
      </p>
      {error && <p className="muted no-print">{error}</p>}

      <div className="corredor-qr-grid">
        {PUNTOS_CORREDOR.map((p) => (
          <div key={p.id} className="card card-pad corredor-qr-cartel">
            <div style={{ textAlign: 'center' }}>
              {qrs[p.id]
                ? <img src={qrs[p.id]} alt={`QR de ${p.nombre}`} width={220} height={220} />
                : <div style={{ width: 220, height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span className="spinner" /></div>}
              <div style={{ fontWeight: 700, marginTop: 12, fontSize: 16 }}>{p.nombre}</div>
              <div className="muted" style={{ fontSize: 12 }}>{p.pais} · Punto de control sicr3p</div>
            </div>
          </div>
        ))}
      </div>

      <style>{`
        .corredor-qr-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }
        .corredor-qr-cartel { break-inside: avoid; page-break-inside: avoid; }
        @media print {
          .no-print { display: none !important; }
          .corredor-qr-grid { grid-template-columns: 1fr; }
          .corredor-qr-cartel { page-break-after: always; }
        }
      `}</style>
    </div>
  );
}
