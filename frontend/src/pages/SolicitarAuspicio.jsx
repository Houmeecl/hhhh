import { useState } from 'react';
import { Link } from 'react-router-dom';
import PublicLayout from '../components/PublicLayout.jsx';
import { api } from '../api.js';

// Postulación pública al programa Ruta sicr3p. Enviar el formulario NO
// crea nada: deja una postulación que alguien revisa y acepta o rechaza
// desde el panel. El texto lo dice, para no prometer una relación que
// todavía no existe.
const VACIO = {
  nombre_empresa: '', rut: '', contacto_nombre: '', contacto_email: '', contacto_telefono: '',
  aporta_vehiculo: false, aporta_monetario: false, aporta_difusion: false,
  vehiculo: { marca: '', modelo: '', patente: '', anio: '' },
  ciudades: '', mensaje: '',
};

const APORTES = [
  ['aporta_vehiculo', 'Un vehículo', 'Para recorrer las ciudades de la gira. Se formaliza con un contrato de comodato.'],
  ['aporta_monetario', 'Aporte monetario', 'Para financiar las jornadas. El monto se acuerda antes de firmar.'],
  ['aporta_difusion', 'Difusión o espacios', 'Convocatoria, salas, participación de ejecutivos.'],
];

export default function SolicitarAuspicio() {
  const [f, setF] = useState(VACIO);
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState(null);
  const [error, setError] = useState(null);

  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setVeh = (k, v) => setF((x) => ({ ...x, vehiculo: { ...x.vehiculo, [k]: v } }));

  async function enviar(e) {
    e.preventDefault();
    setError(null); setEnviando(true);
    try { setListo(await api.solicitarAuspicio(f)); }
    catch (err) { setError(err.message); }
    finally { setEnviando(false); }
  }

  if (listo) {
    return (
      <PublicLayout>
        <div className="card card-pad" style={{ maxWidth: 640, margin: '40px auto', textAlign: 'center' }}>
          <h1 style={{ marginTop: 0 }}>Postulación recibida</h1>
          <p>{listo.mensaje}</p>
          <p className="muted" style={{ fontSize: 14 }}>
            Recibirla no significa que el auspicio esté aprobado: la revisamos y te respondemos.
            Si avanzamos, te llega el convenio para revisar antes de firmar nada.
          </p>
          <Link to="/" className="btn btn-outline">Volver al inicio</Link>
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <h1>Auspiciar la Ruta sicr3p</h1>
        <p className="muted">
          La Ruta sicr3p recorre ciudades y centros industriales levantando información
          de emisiones de Alcance 3 con proveedores. Auspiciarla es aportar los medios
          para que esas jornadas ocurran.
        </p>
        <p className="muted" style={{ fontSize: 14 }}>
          El convenio deja claro que el auspicio <b>no da control</b> sobre la metodología,
          los resultados ni la evaluación de proveedores, y que ser auspiciador no permite
          afirmar que sicr3p o los proveedores fueron certificados o aprobados por tu empresa.
        </p>

        <form className="card card-pad" onSubmit={enviar} style={{ marginTop: 18 }}>
          <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="field"><label>Empresa *</label>
              <input required value={f.nombre_empresa} onChange={(e) => set('nombre_empresa', e.target.value)} /></div>
            <div className="field"><label>RUT *</label>
              <input required placeholder="76.123.456-7" value={f.rut} onChange={(e) => set('rut', e.target.value)} /></div>
            <div className="field"><label>Tu nombre</label>
              <input value={f.contacto_nombre} onChange={(e) => set('contacto_nombre', e.target.value)} /></div>
            <div className="field"><label>Correo *</label>
              <input required type="email" value={f.contacto_email} onChange={(e) => set('contacto_email', e.target.value)} /></div>
            <div className="field"><label>Teléfono</label>
              <input value={f.contacto_telefono} onChange={(e) => set('contacto_telefono', e.target.value)} /></div>
            <div className="field"><label>Ciudades de interés</label>
              <input placeholder="Antofagasta, Calama…" value={f.ciudades} onChange={(e) => set('ciudades', e.target.value)} /></div>
          </div>

          <div className="field" style={{ marginTop: 8 }}>
            <label>¿Con qué puedes aportar? *</label>
            <div style={{ display: 'grid', gap: 8, marginTop: 6 }}>
              {APORTES.map(([k, titulo, detalle]) => (
                // font-weight/size explícitos: `.field label` los fija para
                // la etiqueta de un campo, y acá la etiqueta es la opción.
                <label key={k} className="result-box" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', margin: 0, fontWeight: 400, fontSize: 14 }}>
                  <input type="checkbox" checked={f[k]} onChange={(e) => set(k, e.target.checked)} style={{ marginTop: 3 }} />
                  <span><b>{titulo}</b><br /><span className="muted" style={{ fontSize: 13 }}>{detalle}</span></span>
                </label>
              ))}
            </div>
          </div>

          {f.aporta_vehiculo && (
            <div style={{ marginTop: 14 }}>
              <p className="muted" style={{ fontSize: 13, margin: '0 0 6px' }}>
                Del vehículo que ofreces. Si todavía no está definido, déjalo en blanco.
              </p>
              <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr' }}>
                {[['marca', 'Marca'], ['modelo', 'Modelo'], ['patente', 'Patente'], ['anio', 'Año']].map(([k, l]) => (
                  <div className="field" key={k}><label>{l}</label>
                    <input value={f.vehiculo[k]} onChange={(e) => setVeh(k, e.target.value)} /></div>
                ))}
              </div>
            </div>
          )}

          <div className="field"><label>Cuéntanos algo más</label>
            <textarea rows={4} value={f.mensaje} onChange={(e) => set('mensaje', e.target.value)} /></div>

          {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
          <button className="btn btn-primary" disabled={enviando}>
            {enviando ? <><span className="spinner" /> Enviando…</> : 'Enviar postulación'}
          </button>
        </form>
      </div>
    </PublicLayout>
  );
}
