import { useState } from 'react';
import { Link } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';
import { api } from '../api.js';

// Ejercicio de derechos sobre datos personales (Ley 21.719). Formulario
// público: quien ejerce puede no tener cuenta —el contacto de una
// empresa, un conductor, alguien que postuló hace un año—, así que se
// identifica con su RUT o su correo, no con una sesión.
const VACIO = { derecho: 'acceso', rut: '', email: '', nombre: '', detalle: '' };

// El texto de cada derecho está escrito para alguien que no sabe de
// leyes: primero qué consigue, después cómo se llama.
const DERECHOS = [
  ['acceso', 'Saber qué datos míos tienen', 'Te entregamos todo lo que hay asociado a tu RUT o tu correo, y para qué se usa.'],
  ['rectificacion', 'Corregir un dato equivocado', 'Cuéntanos cuál está mal y cuál es el correcto.'],
  ['supresion', 'Eliminar mis datos', 'Se elimina lo que se pueda. Hay documentos contables que la ley obliga a conservar; te decimos cuáles y por qué.'],
  ['oposicion', 'Que dejen de usarlos', 'Pides que se deje de tratar tu información.'],
  ['portabilidad', 'Llevarme mis datos', 'Te los entregamos en un archivo que puedas usar en otra parte.'],
];

export default function MisDatos() {
  const [f, setF] = useState(VACIO);
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState(null);
  const [error, setError] = useState(null);

  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  async function enviar(e) {
    e.preventDefault();
    setError(null); setEnviando(true);
    try { setListo(await api.solicitarArcop(f)); }
    catch (err) { setError(err.message); }
    finally { setEnviando(false); }
  }

  if (listo) {
    return (
      <PublicLayout>
        <div className="card card-pad" style={{ maxWidth: 640, margin: '40px auto', textAlign: 'center' }}>
          <h1 style={{ marginTop: 0 }}>Solicitud recibida</h1>
          <p>{listo.mensaje}</p>
          {listo.plazo_dias && (
            <p className="muted" style={{ fontSize: 14 }}>
              Nos comprometemos a responderte dentro de {listo.plazo_dias} días.
            </p>
          )}
          <Link to="/" className="btn btn-outline">Volver al inicio</Link>
        </div>
      </PublicLayout>
    );
  }

  const elegido = DERECHOS.find(([k]) => k === f.derecho);

  return (
    <PublicLayout>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <h1>Tus datos personales</h1>
        <p className="muted">
          Puedes pedirnos saber qué datos tuyos tenemos, corregirlos, eliminarlos,
          oponerte a su uso o llevártelos. No necesitas tener cuenta.
        </p>

        <form className="card card-pad" onSubmit={enviar} style={{ marginTop: 18 }}>
          <div className="field">
            <label>¿Qué quieres hacer? *</label>
            <div style={{ display: 'grid', gap: 8, marginTop: 6 }}>
              {DERECHOS.map(([k, titulo, detalle]) => (
                <label
                  key={k}
                  className="result-box"
                  style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', margin: 0, fontWeight: 400, fontSize: 14 }}
                >
                  <input
                    type="radio" name="derecho" value={k} checked={f.derecho === k}
                    onChange={() => set('derecho', k)} style={{ marginTop: 3 }}
                  />
                  <span><b>{titulo}</b><br /><span className="muted" style={{ fontSize: 13 }}>{detalle}</span></span>
                </label>
              ))}
            </div>
          </div>

          <p className="muted" style={{ fontSize: 13, margin: '16px 0 6px' }}>
            Identifícate con tu RUT o con tu correo. Con cualquiera de los dos basta.
          </p>
          <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="field"><label>RUT</label>
              <input placeholder="12.345.678-9" value={f.rut} onChange={(e) => set('rut', e.target.value)} /></div>
            <div className="field"><label>Correo</label>
              <input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></div>
            <div className="field"><label>Tu nombre</label>
              <input value={f.nombre} onChange={(e) => set('nombre', e.target.value)} /></div>
          </div>

          <div className="field">
            <label>
              {f.derecho === 'rectificacion'
                ? '¿Qué dato está equivocado y cuál es el correcto? *'
                : 'Algo más que quieras contarnos'}
            </label>
            <textarea rows={4} value={f.detalle} onChange={(e) => set('detalle', e.target.value)} />
          </div>

          {f.derecho === 'supresion' && (
            <p className="muted" style={{ fontSize: 13 }}>
              Ten en cuenta: los documentos contables ya emitidos y sellados no se pueden eliminar
              —la ley obliga a conservarlos como respaldo tributario—. Te responderemos exactamente
              qué se eliminó y qué quedó, con su fundamento.
            </p>
          )}

          {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
          <button className="btn btn-primary" disabled={enviando}>
            {enviando ? <><span className="spinner" /> Enviando…</> : `Solicitar: ${elegido?.[1] || ''}`}
          </button>
        </form>
      </div>
    </PublicLayout>
  );
}
