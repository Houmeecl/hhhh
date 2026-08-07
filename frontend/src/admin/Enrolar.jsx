import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { validarRut } from '../lib/rut.js';

// Asistente para enrolar un cliente de punta a punta, reuniendo en una sola
// pantalla lo que antes estaba disperso:
//   1. RUT  → consulta la situación tributaria pública del SII (prellena).
//   2. Datos → crea la empresa (proveedor) con validación de módulo 11.
//   3. Acceso web → crea la cuenta del panel del cliente y envía el correo
//      para que defina su clave.
//   4. Conectar SII → deja la empresa lista para generar (descarga de RCV).
// Reusa endpoints existentes; no duplica lógica de negocio.
const PASOS = ['Empresa (SII)', 'Datos', 'Acceso web', 'Conectar SII'];

export default function Enrolar() {
  const navigate = useNavigate();
  const [paso, setPaso] = useState(0);
  const [toast, setToast] = useState(null);
  const flash = (msg, err = false) => { setToast({ msg, err }); setTimeout(() => setToast(null), 4000); };

  // Estado compartido entre pasos.
  const [rut, setRut] = useState('');
  const [nombre, setNombre] = useState('');
  const [giro, setGiro] = useState('');
  const [email, setEmail] = useState('');
  const [empresa, setEmpresa] = useState(null); // { id, nombre_empresa, rut }
  const [sii, setSii] = useState(null); // null | 'consultando' | { razonSocial, giro }
  const [acceso, setAcceso] = useState(null); // { correo_enviado, dev_activation_link }
  const [ocupado, setOcupado] = useState(false);

  async function consultarSii() {
    if (!validarRut(rut)) { flash('El RUT no es válido.', true); return; }
    setSii('consultando');
    try {
      const { situacion } = await api.consultarRutSii(rut);
      const g = situacion.actividades?.[0]?.descripcion || '';
      setSii({ razonSocial: situacion.razonSocial, giro: g });
      if (!nombre.trim() && situacion.razonSocial) setNombre(situacion.razonSocial);
      if (!giro && g) setGiro(g);
    } catch {
      setSii(null);
      flash('No se pudo consultar el SII (o el módulo está apagado). Puedes escribir los datos a mano.', true);
    }
  }

  async function crearEmpresa() {
    if (!nombre.trim()) { flash('Escribe el nombre de la empresa.', true); return; }
    if (!validarRut(rut)) { flash('El RUT no es válido.', true); return; }
    setOcupado(true);
    try {
      const r = await api.adminSiiCrearEmpresa({ nombre_empresa: nombre, rut });
      setEmpresa(r.empresa);
      if (r.ya_existia) flash('Ese RUT ya estaba registrado — se continúa con la empresa existente.');
      setPaso(2);
    } catch (e) { flash(e.message, true); } finally { setOcupado(false); }
  }

  async function crearAcceso() {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { flash('Ingresa un correo válido para el acceso.', true); return; }
    setOcupado(true);
    try {
      const r = await api.accesosProveedorCrearCuenta(empresa.id, { email });
      setAcceso(r);
      if (r.correo_enviado === false) {
        flash('Cuenta creada, pero no se pudo enviar el correo. Comparte el enlace a mano.', true);
      } else {
        flash('Acceso creado y correo de ingreso enviado.');
      }
      setPaso(3);
    } catch (e) { flash(e.message, true); } finally { setOcupado(false); }
  }

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Enrolar cliente</h1>
      <p className="muted" style={{ fontSize: 14, maxWidth: 720, marginTop: 0 }}>
        Da de alta un cliente de principio a fin: trae sus datos del SII, crea la empresa, entrega el
        acceso web (con correo para que defina su clave) y déjalo listo para conectar el SII y generar.
      </p>

      <Stepper paso={paso} />

      {paso === 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>1. RUT de la empresa</h2>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="field" style={{ margin: 0 }}>
              <label>RUT</label>
              <input value={rut} onChange={(e) => setRut(e.target.value)} placeholder="76000000-0" />
            </div>
            <button className="btn btn-outline" onClick={consultarSii} disabled={sii === 'consultando'}>
              {sii === 'consultando' ? <><span className="spinner" /> Consultando SII…</> : 'Consultar en el SII'}
            </button>
            <button className="btn btn-primary" onClick={() => { if (!validarRut(rut)) { flash('El RUT no es válido.', true); return; } setPaso(1); }}>
              Continuar
            </button>
          </div>
          {sii && sii !== 'consultando' && (
            <div className="card" style={{ marginTop: 14, background: 'var(--bg)' }}>
              <div style={{ fontWeight: 600 }}>{sii.razonSocial || '(sin razón social en el SII)'}</div>
              {sii.giro && <div className="muted" style={{ fontSize: 13 }}>{sii.giro}</div>}
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Dato público de la situación tributaria — se usa solo para prellenar.</div>
            </div>
          )}
        </div>
      )}

      {paso === 1 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>2. Datos de la empresa</h2>
          <div className="field"><label>RUT</label><input value={rut} onChange={(e) => setRut(e.target.value)} placeholder="76000000-0" /></div>
          <div className="field"><label>Nombre de la empresa</label><input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Empresa SpA" /></div>
          {giro && <div className="field"><label>Giro (referencial)</label><input value={giro} onChange={(e) => setGiro(e.target.value)} /></div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn btn-outline" onClick={() => setPaso(0)}>Atrás</button>
            <button className="btn btn-primary" onClick={crearEmpresa} disabled={ocupado}>
              {ocupado ? <><span className="spinner" /> Creando…</> : 'Crear empresa y seguir'}
            </button>
          </div>
        </div>
      )}

      {paso === 2 && empresa && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>3. Acceso web del cliente</h2>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            {empresa.nombre_empresa} <span style={{ fontFamily: 'monospace' }}>{empresa.rut}</span> — se creará su cuenta
            del panel del cliente y le llegará un correo para definir su clave.
          </p>
          <div className="field" style={{ maxWidth: 360 }}>
            <label>Correo del cliente</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contacto@empresa.cl" autoComplete="off" />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn btn-outline" onClick={() => setPaso(3)}>Omitir por ahora</button>
            <button className="btn btn-primary" onClick={crearAcceso} disabled={ocupado}>
              {ocupado ? <><span className="spinner" /> Creando acceso…</> : 'Crear acceso y enviar correo'}
            </button>
          </div>
        </div>
      )}

      {paso === 3 && empresa && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>4. Conectar el SII</h2>
          <div className="badge badge-green" style={{ marginBottom: 12 }}>Cliente enrolado</div>
          <ul className="muted" style={{ fontSize: 14, lineHeight: 1.7, paddingLeft: 18 }}>
            <li>Empresa <strong>{empresa.nombre_empresa}</strong> <span style={{ fontFamily: 'monospace' }}>{empresa.rut}</span> creada.</li>
            <li>{acceso
              ? (acceso.correo_enviado === false ? 'Acceso creado (el correo no salió — comparte el enlace de abajo).' : 'Acceso web creado y correo de ingreso enviado.')
              : 'Acceso web pendiente (lo omitiste): puedes crearlo luego en Accesos externos.'}</li>
          </ul>
          {acceso?.dev_activation_link && (
            <p className="muted" style={{ fontSize: 12, wordBreak: 'break-all' }}>
              Enlace de activación: <code>{acceso.dev_activation_link}</code>
            </p>
          )}
          <p style={{ fontSize: 14 }}>
            Para descargar y calcular su Registro de Compras y Ventas, conéctate al SII con el RUT y la
            clave de la empresa. El cliente también puede conectarlo desde su propio panel.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => navigate('/admin/sii')}>Conectar SII y generar</button>
            <button className="btn btn-outline" onClick={() => {
              // Reiniciar para enrolar otro cliente.
              setPaso(0); setRut(''); setNombre(''); setGiro(''); setEmail('');
              setEmpresa(null); setSii(null); setAcceso(null);
            }}>Enrolar otro cliente</button>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}

function Stepper({ paso }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
      {PASOS.map((t, i) => (
        <div key={t} style={{
          display: 'flex', alignItems: 'center', gap: 6, fontSize: 13,
          color: i === paso ? 'var(--text)' : 'var(--muted)', fontWeight: i === paso ? 700 : 400,
        }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, borderRadius: '50%', fontSize: 12,
            background: i < paso ? 'var(--verde, #16a34a)' : i === paso ? 'var(--text)' : 'var(--border, #ddd)',
            color: i <= paso ? '#fff' : 'var(--muted)',
          }}>{i < paso ? '✓' : i + 1}</span>
          {t}
          {i < PASOS.length - 1 && <span className="muted" style={{ margin: '0 2px' }}>→</span>}
        </div>
      ))}
    </div>
  );
}
