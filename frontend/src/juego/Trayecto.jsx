import { useEffect, useState } from 'react';
import { Icon } from '../components/icons.jsx';
import { api } from '../api.js';

const MODOS = [
  { valor: 'caminando', label: 'Caminando', ico: Icon.Truck },
  { valor: 'bicicleta', label: 'Bicicleta', ico: Icon.Truck },
  { valor: 'transporte_publico', label: 'Transporte público', ico: Icon.Truck },
  { valor: 'auto', label: 'Auto', ico: Icon.Truck },
  { valor: 'moto', label: 'Moto', ico: Icon.Truck },
  { valor: 'otro', label: 'Otro', ico: Icon.Truck },
];

// Marca la hora de salida y de llegada del trayecto usado para venir a
// escanear/entregar documentos, con puntos extra para medios de bajo
// carbono — coherente con lo que el resto de sicr3p ya mide (transporte
// por modo, Alcance 3). Un trayecto abierto (con salida pero sin llegada)
// no suma puntos todavía.
export default function Trayecto() {
  const [modo, setModo] = useState('caminando');
  const [activo, setActivo] = useState(null); // trayecto abierto
  const [resultado, setResultado] = useState(null); // trayecto cerrado, con puntos
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    const guardado = sessionStorage.getItem('sicr3p_suma_trayecto');
    if (guardado) setActivo(JSON.parse(guardado));
  }, []);

  async function marcarSalida() {
    setError(''); setCargando(true);
    try {
      const r = await api.jugadorTrayectoSalida(modo);
      setActivo(r.trayecto);
      sessionStorage.setItem('sicr3p_suma_trayecto', JSON.stringify(r.trayecto));
    } catch (e) { setError(e.message); }
    finally { setCargando(false); }
  }

  async function marcarLlegada() {
    setError(''); setCargando(true);
    try {
      const r = await api.jugadorTrayectoLlegada(activo.id);
      setResultado(r.trayecto);
      setActivo(null);
      sessionStorage.removeItem('sicr3p_suma_trayecto');
    } catch (e) { setError(e.message); }
    finally { setCargando(false); }
  }

  if (resultado) {
    return (
      <div className="card card-pad" style={{ textAlign: 'center' }}>
        <div style={{ color: 'var(--suma-accent)' }}><Icon.CheckCircle size={40} /></div>
        <div style={{ fontSize: 24, fontWeight: 800, marginTop: 8 }}>+{resultado.puntos} puntos</div>
        <p className="muted" style={{ fontSize: 14 }}>Trayecto registrado.</p>
        <button className="btn btn-primary" style={{ width: '100%', marginTop: 10 }} onClick={() => setResultado(null)}>
          Registrar otro trayecto
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ fontSize: 20, margin: '0 0 4px' }}>Trayecto</h1>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Marca cuándo saliste y cuándo llegaste. Caminar, bicicleta o transporte público suman más puntos.
      </p>

      <div className="card card-pad">
        {!activo ? (
          <>
            <div className="field">
              <label>Medio de transporte</label>
              <select value={modo} onChange={(e) => setModo(e.target.value)}>
                {MODOS.map((m) => <option key={m.valor} value={m.valor}>{m.label}</option>)}
              </select>
            </div>
            {error && <div className="badge badge-red" style={{ display: 'block', padding: '10px 14px', marginTop: 12 }}>{error}</div>}
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 14 }} onClick={marcarSalida} disabled={cargando}>
              {cargando ? <span className="spinner" /> : 'Marcar salida'}
            </button>
          </>
        ) : (
          <>
            <div className="badge badge-green" style={{ display: 'block', padding: '10px 14px', textAlign: 'center' }}>
              Trayecto en curso — {MODOS.find((m) => m.valor === activo.modo_transporte)?.label}
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                Salida: {new Date(activo.salida_at).toLocaleTimeString('es-CL')}
              </div>
            </div>
            {error && <div className="badge badge-red" style={{ display: 'block', padding: '10px 14px', marginTop: 12 }}>{error}</div>}
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 14 }} onClick={marcarLlegada} disabled={cargando}>
              {cargando ? <span className="spinner" /> : 'Marcar llegada'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
