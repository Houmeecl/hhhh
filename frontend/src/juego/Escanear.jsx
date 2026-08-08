import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Dropzone from '../components/Dropzone.jsx';
import { Icon } from '../components/icons.jsx';
import { validarRut, formatearRut } from '../lib/rut.js';
import { api } from '../api.js';

const MAX = 5;

// Reusa el mismo flujo real de carga (POST /api/sesiones, motor propio) que
// Cargar.jsx — nunca calcula CO2e por su cuenta, solo puntúa sobre lo que
// el motor ya calculó (ver services/juego.js).
export default function Escanear() {
  const nav = useNavigate();
  const [perfil, setPerfil] = useState(null);
  const [files, setFiles] = useState([]);
  const [rut, setRut] = useState('');
  const [error, setError] = useState('');
  const [procesando, setProcesando] = useState(false);
  const [resultado, setResultado] = useState(null); // { puntos_ganados }

  useEffect(() => {
    api.jugadorPerfil().then((d) => setPerfil(d.jugador)).catch(() => {});
  }, []);

  const rutValido = rut === '' || validarRut(rut);

  function addFiles(list) {
    setError('');
    const incoming = Array.from(list);
    const combined = [...files, ...incoming];
    if (combined.length > MAX) {
      setError(`Puedes cargar hasta ${MAX} documentos por envío.`);
      setFiles(combined.slice(0, MAX));
    } else {
      setFiles(combined);
    }
  }

  async function procesar() {
    setError('');
    if (!rut || !validarRut(rut)) { setError('Ingresa un RUT válido.'); return; }
    if (files.length === 0) { setError('Selecciona al menos un documento.'); return; }
    setProcesando(true);
    try {
      const fd = new FormData();
      fd.append('rut', rut);
      fd.append('empresa', perfil?.empresa || '');
      fd.append('email', perfil?.email || '');
      // El código de campaña es el mismo codigos_acceso que dio acceso al
      // juego (ver auth.js) — sin reenviarlo aquí, POST /api/sesiones no
      // consume créditos de la campaña (backend/src/routes/public.js).
      if (perfil?.codigo) fd.append('codigo', perfil.codigo);
      files.forEach((f) => fd.append('archivos', f));
      const r = await api.jugadorCrearSesion(fd);
      setResultado({ puntos: r.juego?.puntos_ganados ?? 0, sesionId: r.sesion.id, nFacturas: r.facturas.length });
    } catch (e) {
      setError(e.message);
    } finally {
      setProcesando(false);
    }
  }

  if (resultado) {
    return (
      <div className="card card-pad" style={{ textAlign: 'center' }}>
        <div style={{ color: 'var(--suma-accent)' }}><Icon.Sparkles size={40} /></div>
        <div style={{ fontSize: 28, fontWeight: 800, marginTop: 8 }}>+{resultado.puntos} puntos</div>
        <p className="muted" style={{ fontSize: 14 }}>
          {resultado.nFacturas} documento{resultado.nFacturas > 1 ? 's' : ''} procesado{resultado.nFacturas > 1 ? 's' : ''}.
        </p>
        <button className="btn btn-primary" style={{ width: '100%', marginTop: 10 }} onClick={() => nav('/suma')}>
          Volver al inicio
        </button>
        <button
          className="btn btn-outline" style={{ width: '100%', marginTop: 10 }}
          onClick={() => { setResultado(null); setFiles([]); setRut(''); }}
        >
          Escanear otro documento
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ fontSize: 20, margin: '0 0 4px' }}>Escanear</h1>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Sube o fotografía la boleta o factura. Hasta {MAX} documentos por envío.
      </p>

      <div className="card card-pad">
        <Dropzone onFiles={addFiles} />

        {files.length > 0 && (
          <div className="file-list">
            {files.map((f, i) => (
              <div className="file-item" key={i}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <Icon.Doc size={16} /> {f.name}
                </span>
                <span className="rm" onClick={() => setFiles(files.filter((_, j) => j !== i))}>Quitar</span>
              </div>
            ))}
          </div>
        )}

        <div className="field" style={{ marginTop: 12 }}>
          <label>RUT de la empresa emisora</label>
          <input
            value={rut}
            onChange={(e) => setRut(e.target.value)}
            onBlur={() => rut && validarRut(rut) && setRut(formatearRut(rut))}
            placeholder="76.123.456-7"
            style={!rutValido ? { borderColor: '#ef4444', outlineColor: '#ef4444' } : {}}
          />
          {!rutValido && <div style={{ color: '#b91c1c', fontSize: 12, marginTop: 4 }}>RUT inválido</div>}
        </div>

        {error && <div className="badge badge-red" style={{ display: 'block', padding: '10px 14px', marginTop: 12 }}>{error}</div>}

        <button
          className="btn btn-primary" style={{ width: '100%', marginTop: 14 }}
          onClick={procesar} disabled={procesando || files.length === 0 || !perfil}
        >
          {procesando ? <span className="spinner" /> : `Procesar ${files.length > 0 ? `${files.length} documento${files.length > 1 ? 's' : ''}` : ''}`}
        </button>
      </div>
    </div>
  );
}
