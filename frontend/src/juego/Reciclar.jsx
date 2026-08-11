import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Dropzone from '../components/Dropzone.jsx';
import { Icon } from '../components/icons.jsx';
import { api } from '../api.js';

const MATERIAL_LABEL = { pet: 'botella PET', vidrio: 'envase de vidrio', lata: 'lata', tetra: 'caja tetra' };

// Comprime la foto a JPEG (lado mayor ≤1568 px): convierte el HEIC del
// iPhone a un formato que la IA acepta y acota el peso del upload y el
// costo de visión. Si el navegador no puede decodificarla, se envía tal
// cual y el backend decide.
async function comprimirImagen(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const escala = Math.min(1, 1568 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * escala);
    canvas.height = Math.round(bitmap.height * escala);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.8));
    if (!blob) return file;
    return new File([blob], 'envases.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

function obtenerUbicacion() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('sin_geo')); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => reject(new Error('denegado')),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  });
}

// Registro de una entrega de envases en un punto limpio: se llega acá
// escaneando el cartel QR del punto (la URL trae ?punto=TOKEN). GPS
// obligatorio; la foto se analiza en el servidor y NO se guarda — solo el
// conteo validado. Sin declaración manual: si la foto no se reconoce, se
// pide tomar otra.
export default function Reciclar() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('punto') || '';

  const [punto, setPunto] = useState(null);
  const [foto, setFoto] = useState(null);
  const [gps, setGps] = useState(null);         // {lat,lng} | null
  const [gpsError, setGpsError] = useState(false);
  const [error, setError] = useState('');
  const [procesando, setProcesando] = useState(false);
  const [resultado, setResultado] = useState(null);

  useEffect(() => {
    if (!token) return;
    api.jugadorPuntoLimpio(token).then((r) => setPunto(r.punto)).catch((e) => setError(e.message));
    obtenerUbicacion().then((c) => { setGps(c); setGpsError(false); }).catch(() => setGpsError(true));
  }, [token]);

  function reintentarGps() {
    setGpsError(false);
    obtenerUbicacion().then((c) => { setGps(c); setGpsError(false); }).catch(() => setGpsError(true));
  }

  async function enviar() {
    setError('');
    if (!foto) { setError('Toma una foto de los envases que estás entregando.'); return; }
    if (!gps) { setGpsError(true); return; }
    setProcesando(true);
    try {
      const comprimida = await comprimirImagen(foto);
      const fd = new FormData();
      fd.append('punto', token);
      fd.append('lat', String(gps.lat));
      fd.append('lng', String(gps.lng));
      fd.append('foto', comprimida);
      const r = await api.jugadorReciclar(fd);
      setResultado(r);
    } catch (e) {
      setError(e.message);
      setFoto(null); // "toma otra foto": se conserva punto y GPS
    } finally {
      setProcesando(false);
    }
  }

  if (!token) {
    return (
      <div className="card card-pad" style={{ textAlign: 'center' }}>
        <div style={{ color: 'var(--suma-accent)' }}><Icon.Recycle size={40} /></div>
        <h2 style={{ margin: '10px 0 6px', fontSize: 18 }}>Reciclar en punto limpio</h2>
        <p className="muted" style={{ fontSize: 14 }}>
          Escanea el código QR del cartel en el punto limpio para registrar tu entrega de envases y sumar puntos.
        </p>
      </div>
    );
  }

  if (resultado) {
    return (
      <div className="card card-pad" style={{ textAlign: 'center' }}>
        <div style={{ color: 'var(--suma-accent)' }}><Icon.Sparkles size={40} /></div>
        <div style={{ fontSize: 28, fontWeight: 800, marginTop: 8 }}>+{resultado.puntos_ganados} puntos</div>
        <p className="muted" style={{ fontSize: 14 }}>
          {resultado.reciclaje.total_envases} envase{resultado.reciclaje.total_envases > 1 ? 's' : ''} registrado{resultado.reciclaje.total_envases > 1 ? 's' : ''}:{' '}
          {resultado.reciclaje.envases.map((e) => `${e.cantidad} ${MATERIAL_LABEL[e.material] || e.material}${e.cantidad > 1 ? 's' : ''}`).join(', ')}.
        </p>
        <button className="btn btn-primary" style={{ width: '100%', marginTop: 10 }} onClick={() => nav('/suma')}>
          Volver al inicio
        </button>
        <p className="muted" style={{ fontSize: 12, marginTop: 12, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
          <Icon.Info size={14} /> Los puntos son un reconocimiento interno de participación.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ fontSize: 20, margin: '0 0 4px' }}>Reciclar</h1>
      {punto ? (
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Punto limpio: <b>{punto.nombre}</b>{punto.direccion ? ` — ${punto.direccion}` : ''}
        </p>
      ) : (
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Verificando el punto limpio…</p>
      )}

      <div className="card card-pad">
        <Dropzone accept="image/*" onFiles={(list) => { setError(''); setFoto(Array.from(list)[0] || null); }} />

        {foto && (
          <div className="file-list">
            <div className="file-item">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Icon.Camera size={16} /> {foto.name}
              </span>
              <span className="rm" onClick={() => setFoto(null)}>Quitar</span>
            </div>
          </div>
        )}

        {gpsError && (
          <div className="badge badge-red" style={{ display: 'block', padding: '10px 14px', marginTop: 12 }}>
            Sin tu ubicación no podemos registrar el reciclaje. Activa el permiso de ubicación e inténtalo de nuevo.{' '}
            <span className="rm" style={{ textDecoration: 'underline', cursor: 'pointer' }} onClick={reintentarGps}>Reintentar</span>
          </div>
        )}
        {error && <div className="badge badge-red" style={{ display: 'block', padding: '10px 14px', marginTop: 12 }}>{error}</div>}

        <button
          className="btn btn-primary" style={{ width: '100%', marginTop: 14 }}
          onClick={enviar} disabled={procesando || !punto || !foto || !gps}
        >
          {procesando ? <span className="spinner" /> : 'Registrar entrega'}
        </button>

        <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
          Fotografía los envases que estás entregando (botellas, latas, vidrio, tetra). La foto se
          analiza para contarlos y no se guarda; tu ubicación se usa solo para confirmar que estás
          en el punto limpio.
        </p>
      </div>
    </div>
  );
}
