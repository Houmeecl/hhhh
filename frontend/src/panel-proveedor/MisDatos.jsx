import { useEffect, useState } from 'react';
import { api } from '../api.js';

// Formulario de datos de la empresa. Se muestra como paso de bienvenida la
// primera vez (onboarding) y luego queda disponible para actualizar. La
// empresa lo completa desde su propio panel, tras entrar por el enlace que
// recibió por correo.
const CAMPOS = [
  { k: 'nombre_empresa', label: 'Razón social', req: true, ph: 'Empresa SpA' },
  { k: 'giro', label: 'Giro o actividad', ph: 'Explotación de minas de cobre' },
  { k: 'direccion', label: 'Dirección', ph: 'Av. Apoquindo 1234, Las Condes, Santiago', full: true },
  { k: 'telefono', label: 'Teléfono de contacto', ph: '+56 9 1234 5678' },
  { k: 'contacto_email', label: 'Correo de contacto', ph: 'contacto@empresa.cl', type: 'email' },
  { k: 'representante', label: 'Representante legal', ph: 'Nombre y apellido' },
  { k: 'cargo', label: 'Cargo', ph: 'Gerente General' },
];

export default function MisDatos({ onboarding = false, onListo }) {
  const [f, setF] = useState(null);
  const [rut, setRut] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [toast, setToast] = useState(null);
  const flash = (msg, err = false) => { setToast({ msg, err }); setTimeout(() => setToast(null), 4000); };

  useEffect(() => {
    api.proveedorPerfil().then(({ perfil }) => {
      setRut(perfil.rut);
      setF({
        nombre_empresa: perfil.nombre_empresa || '', giro: perfil.giro || '',
        direccion: perfil.direccion || '', telefono: perfil.telefono || '',
        contacto_email: perfil.contacto_email || '', representante: perfil.representante || '',
        cargo: perfil.cargo || '',
      });
    }).catch((e) => flash(e.message, true));
  }, []);

  async function guardar(e) {
    e.preventDefault();
    if (!f.nombre_empresa.trim()) { flash('Ingresa la razón social.', true); return; }
    setGuardando(true);
    try {
      await api.proveedorGuardarPerfil(f);
      flash('Datos guardados.');
      if (onListo) onListo();
    } catch (err) { flash(err.message, true); } finally { setGuardando(false); }
  }

  if (!f) return <div style={{ padding: 40 }}><span className="spinner dark" /> Cargando…</div>;

  return (
    <div style={{ maxWidth: 720 }}>
      {onboarding ? (
        <>
          <h1 style={{ marginTop: 0 }}>Bienvenido a sicr3p</h1>
          <p className="muted" style={{ fontSize: 14 }}>
            Completa los datos de tu empresa para dejar tu cuenta lista. Toma menos de un minuto y
            podrás actualizarlos cuando quieras.
          </p>
        </>
      ) : (
        <h1 style={{ marginTop: 0 }}>Datos de la empresa</h1>
      )}

      <form onSubmit={guardar} className="card">
        <div className="field">
          <label>RUT</label>
          <input value={rut} disabled style={{ fontFamily: 'monospace', opacity: 0.7 }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 12 }}>
          {CAMPOS.map((c) => (
            <div className="field" key={c.k} style={{ margin: 0, gridColumn: c.full ? '1 / -1' : undefined }}>
              <label>{c.label}{c.req && ' *'}</label>
              <input
                type={c.type || 'text'}
                value={f[c.k]}
                onChange={(e) => setF({ ...f, [c.k]: e.target.value })}
                placeholder={c.ph}
              />
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16 }}>
          <button className="btn btn-primary" type="submit" disabled={guardando}>
            {guardando ? <><span className="spinner" /> Guardando…</> : (onboarding ? 'Guardar y continuar' : 'Guardar cambios')}
          </button>
        </div>
      </form>

      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}
