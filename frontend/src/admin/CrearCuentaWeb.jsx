import { useState } from 'react';
import PasswordUnaVez from '../components/PasswordUnaVez.jsx';

// ---------- Modal: crear el acceso web (login propio) de un puerto o mandante ----------
// Distinto de la API key (integración de sistemas): esto crea una cuenta
// humana (email+contraseña) atada solo a ESTA entidad, que entra por su
// propio panel (/panel-puerto o /panel-mandante) — mismo flujo de
// activación por correo que las cuentas sicrep/aduana_verde.
//
// Vive en su propio archivo —y no dentro de Accesos.jsx, donde nació—
// porque la cola de onboarding (admin/Enrolar.jsx) necesita el MISMO
// modal para las empresas que quedaron sin acceso web. Se movió tal cual:
// duplicarlo habría dejado dos formularios que crean cuentas y que se
// separan al primer cambio.
function CrearCuentaWeb({ entidad, nombreEntidad, crear, onClose, onCreada }) {
  const [email, setEmail] = useState('');
  const [nombre, setNombre] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [resultado, setResultado] = useState(null);

  async function submit() {
    setEnviando(true);
    setError('');
    try {
      const r = await crear(entidad.id, { email, nombre });
      setResultado(r);
      onCreada();
    } catch (e) { setError(e.message); }
    finally { setEnviando(false); }
  }

  return (
    <div className="modal-bg" onClick={(e) => e.target.className === 'modal-bg' && onClose()}>
      <div className="modal" style={{ maxWidth: 440 }}>
        <h2 style={{ marginTop: 0 }}>Acceso web de {nombreEntidad}</h2>
        {resultado ? (
          <>
            {resultado.password && <PasswordUnaVez password={resultado.password} />}
            {/* Cuando la creación también manda correo (proveedor): avisar del
                mail de ingreso además del password temporal de respaldo. */}
            {resultado.correo_enviado !== undefined && (
              <>
                <div className="badge badge-green" style={{ display: 'block', padding: 12, margin: '10px 0' }}>
                  {resultado.correo_enviado ? 'Se envió un correo para que ingrese y defina su clave.' : 'No se pudo enviar el correo — comparte este enlace a mano:'}
                </div>
                {resultado.dev_activation_link && (
                  <div style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all', background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
                    {resultado.dev_activation_link}
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          <>
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
              Crea un login propio (email + contraseña) para que {nombreEntidad} entre a su panel web —
              distinto de la API key, que sigue sirviendo para integraciones de sistemas.
            </p>
            <div className="field"><label>Correo</label><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contacto@empresa.cl" /></div>
            <div className="field" style={{ marginBottom: 14 }}><label>Nombre</label><input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Persona de contacto" /></div>
            {error && <div className="badge badge-red" style={{ display: 'block', padding: 10, marginBottom: 12 }}>{error}</div>}
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={submit} disabled={enviando || !email || !nombre}>
              {enviando ? <span className="spinner" /> : 'Crear acceso web'}
            </button>
          </>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="btn btn-outline" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

export default CrearCuentaWeb;
