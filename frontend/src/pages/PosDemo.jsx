import { useRef, useState } from 'react';
import Logo from '../components/Logo.jsx';
import { Icon } from '../components/icons.jsx';
import { fmtInt } from '../api.js';

// ============================================================
// Simulación de un terminal POS de tablet (escaneo + NFC + cobro).
// Es una DEMO explícita: no hay pasarela de pago real conectada
// (ver ETAPA3.md → VirtualPos, sin credenciales todavía) y no envía
// nada a ningún backend. El escaneo por cámara SÍ funciona de verdad
// (input file con capture="environment"); NFC intenta el Web NFC API
// real del navegador y, si no está disponible, lo dice explícitamente
// en vez de fingir una lectura.
// ============================================================

const MODOS = [
  { id: 'escanear', label: 'Escanear documento', icon: Icon.Camera, desc: 'Captura con la cámara trasera' },
  { id: 'nfc', label: 'Leer NFC', icon: Icon.Nfc, desc: 'Acerca una tarjeta o credencial' },
  { id: 'cobrar', label: 'Cobrar', icon: Icon.CreditCard, desc: 'Pago único, no recurrente' },
];

export default function PosDemo() {
  const [modo, setModo] = useState(null);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', background: '#fff', borderBottom: '1px solid var(--border)' }}>
        <Logo size={24} tagline={false} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 700 }}>Terminal</span>
          <span className="badge badge-gray">Modo simulación</span>
        </div>
      </header>

      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 560 }}>
          {!modo && <Menu onElegir={setModo} />}
          {modo === 'escanear' && <Escanear onVolver={() => setModo(null)} />}
          {modo === 'nfc' && <Nfc onVolver={() => setModo(null)} />}
          {modo === 'cobrar' && <Cobrar onVolver={() => setModo(null)} />}
        </div>
      </main>
    </div>
  );
}

function Menu({ onElegir }) {
  return (
    <div>
      <h1 style={{ fontSize: 24, textAlign: 'center', marginBottom: 4 }}>¿Qué necesitas hacer?</h1>
      <p className="muted" style={{ textAlign: 'center', marginTop: 0, marginBottom: 24 }}>
        Demo de terminal — pensada para tablet.
      </p>
      <div style={{ display: 'grid', gap: 14 }}>
        {MODOS.map((m) => {
          const Ico = m.icon;
          return (
            <button key={m.id} onClick={() => onElegir(m.id)}
              className="card card-pad"
              style={{
                display: 'flex', alignItems: 'center', gap: 16, textAlign: 'left',
                border: '1px solid var(--border)', cursor: 'pointer', minHeight: 76,
              }}>
              <span style={{ color: 'var(--green-600)', flexShrink: 0 }}><Ico size={30} /></span>
              <span>
                <div style={{ fontSize: 17, fontWeight: 700 }}>{m.label}</div>
                <div className="muted" style={{ fontSize: 13 }}>{m.desc}</div>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Volver({ onVolver }) {
  return (
    <button className="btn btn-outline btn-sm" onClick={onVolver} style={{ marginBottom: 16 }}>
      ← Volver
    </button>
  );
}

// ---------- Escanear documento (cámara real) ----------
function Escanear({ onVolver }) {
  const inputRef = useRef(null);
  const [preview, setPreview] = useState(null);

  function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreview(URL.createObjectURL(file));
  }

  return (
    <div>
      <Volver onVolver={onVolver} />
      <div className="card card-pad" style={{ textAlign: 'center' }}>
        <h2 style={{ marginTop: 0 }}>Escanear documento</h2>
        {!preview && (
          <>
            <div style={{ color: 'var(--green-600)', margin: '20px 0' }}><Icon.Camera size={56} /></div>
            <button className="btn btn-primary" style={{ width: '100%', padding: '16px 0', fontSize: 16 }}
              onClick={() => inputRef.current?.click()}>
              Tomar foto
            </button>
            <input ref={inputRef} type="file" accept="image/*" capture="environment"
              style={{ display: 'none' }} onChange={onFile} />
          </>
        )}
        {preview && (
          <>
            <img src={preview} alt="Documento capturado" style={{ maxWidth: '100%', borderRadius: 12, margin: '16px 0' }} />
            <div className="badge badge-green" style={{ marginBottom: 12 }}>✓ Documento capturado</div>
            <button className="btn btn-outline" style={{ width: '100%' }} onClick={() => setPreview(null)}>Tomar otra</button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- Leer NFC (Web NFC real si el navegador lo soporta) ----------
function Nfc({ onVolver }) {
  const [estado, setEstado] = useState('idle'); // idle | leyendo | ok | error | no_soportado
  const [dato, setDato] = useState(null);

  async function leerReal() {
    if (!('NDEFReader' in window)) {
      setEstado('no_soportado');
      return;
    }
    setEstado('leyendo');
    try {
      const reader = new window.NDEFReader();
      await reader.scan();
      reader.onreading = (event) => {
        setDato({ serial: event.serialNumber, simulado: false });
        setEstado('ok');
      };
    } catch (e) {
      setEstado('error');
    }
  }

  function simular() {
    setDato({ serial: 'SIM-' + Math.random().toString(16).slice(2, 10).toUpperCase(), simulado: true });
    setEstado('ok');
  }

  return (
    <div>
      <Volver onVolver={onVolver} />
      <div className="card card-pad" style={{ textAlign: 'center' }}>
        <h2 style={{ marginTop: 0 }}>Leer NFC</h2>
        <div style={{ color: 'var(--green-600)', margin: '20px 0' }}><Icon.Nfc size={56} /></div>

        {estado === 'idle' && (
          <button className="btn btn-primary" style={{ width: '100%', padding: '16px 0', fontSize: 16 }} onClick={leerReal}>
            Acercar tarjeta / credencial
          </button>
        )}
        {estado === 'leyendo' && <p className="muted">Acerca la tarjeta al lector…</p>}

        {(estado === 'no_soportado' || estado === 'error') && (
          <>
            <p className="muted" style={{ fontSize: 13 }}>
              {estado === 'no_soportado'
                ? 'Web NFC no está disponible en este navegador/dispositivo (funciona en Chrome para Android con NFC activado).'
                : 'No se pudo leer el NFC (permiso denegado o error del lector).'}
            </p>
            <button className="btn btn-outline" style={{ width: '100%' }} onClick={simular}>Simular lectura</button>
          </>
        )}

        {estado === 'ok' && dato && (
          <>
            <div className="badge badge-green" style={{ marginBottom: 8 }}>✓ Lectura {dato.simulado ? 'simulada' : 'NFC real'}</div>
            <div style={{ fontFamily: 'monospace', fontSize: 14 }}>{dato.serial}</div>
            <button className="btn btn-outline" style={{ width: '100%', marginTop: 16 }} onClick={() => { setEstado('idle'); setDato(null); }}>
              Leer otra
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- Cobrar (checkout simulado, pago único — no recurrente) ----------
function Cobrar({ onVolver }) {
  const [monto, setMonto] = useState('');
  const [metodo, setMetodo] = useState('tarjeta');
  const [estado, setEstado] = useState('idle'); // idle | procesando | listo

  async function cobrar() {
    setEstado('procesando');
    await new Promise((r) => setTimeout(r, 1200));
    setEstado('listo');
  }

  if (estado === 'listo') {
    return (
      <div>
        <Volver onVolver={onVolver} />
        <div className="card card-pad" style={{ textAlign: 'center' }}>
          <div style={{ color: 'var(--green-600)', margin: '10px 0' }}><Icon.CheckCircle size={56} /></div>
          <h2 style={{ margin: '0 0 4px' }}>Pago simulado exitoso</h2>
          <div style={{ fontSize: 22, fontWeight: 800 }}>$ {fmtInt(Number(monto) || 0)} CLP</div>
          <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>
            Simulación — sin pasarela de pago real conectada todavía. Cuando haya una integración
            real (ej. VirtualPos), este paso se reemplaza por el cobro efectivo.
          </p>
          <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={onVolver}>Listo</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Volver onVolver={onVolver} />
      <div className="card card-pad">
        <h2 style={{ marginTop: 0, textAlign: 'center' }}>Cobrar</h2>
        <div className="field"><label>Monto (CLP)</label>
          <input value={monto} onChange={(e) => setMonto(e.target.value.replace(/\D/g, ''))}
            placeholder="15000" style={{ fontSize: 20, textAlign: 'center' }} />
        </div>
        <div className="field" style={{ marginBottom: 16 }}>
          <label>Método</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {[['tarjeta', 'Tarjeta'], ['nfc', 'NFC'], ['qr', 'QR']].map(([v, l]) => (
              <button key={v} type="button" onClick={() => setMetodo(v)}
                className={`btn btn-sm ${metodo === v ? 'btn-primary' : 'btn-outline'}`} style={{ flex: 1 }}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <button className="btn btn-primary" style={{ width: '100%', padding: '16px 0', fontSize: 16 }}
          onClick={cobrar} disabled={!Number(monto) || estado === 'procesando'}>
          {estado === 'procesando' ? <span className="spinner" /> : `Cobrar $${fmtInt(Number(monto) || 0)}`}
        </button>
        <p className="muted" style={{ fontSize: 11, marginTop: 10, textAlign: 'center' }}>
          Pago único — no recurrente. Simulación, sin cargo real.
        </p>
      </div>
    </div>
  );
}
