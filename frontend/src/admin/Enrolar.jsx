import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { validarRut, formatearRut } from '../lib/rut.js';

// Enrolar una empresa en un solo paso: RUT (autocompleta razón social desde
// el SII al salir del campo) + correo → crea la empresa y envía la
// invitación. La empresa completa el resto (datos + conectar el SII) sola,
// desde su propio panel, al entrar por el enlace del correo.
export default function Enrolar() {
  const navigate = useNavigate();
  const [rut, setRut] = useState('');
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [sii, setSii] = useState(null); // null | 'consultando' | { razonSocial }
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState(null); // { empresa, acceso }
  const [toast, setToast] = useState(null);
  const flash = (msg, err = false) => { setToast({ msg, err }); setTimeout(() => setToast(null), 4000); };

  async function consultarSii() {
    if (!validarRut(rut) || sii) return; // ya consultado, o RUT incompleto: no gastar la llamada
    setSii('consultando');
    try {
      const { situacion } = await api.consultarRutSii(rut);
      setSii({ razonSocial: situacion.razonSocial });
      if (!nombre.trim() && situacion.razonSocial) setNombre(situacion.razonSocial);
    } catch {
      setSii(null); // módulo apagado o sin datos: se completa el nombre a mano, sin bloquear
    }
  }

  async function enrolar(e) {
    e.preventDefault();
    if (!validarRut(rut)) { flash('El RUT no es válido.', true); return; }
    if (!nombre.trim()) { flash('Escribe el nombre de la empresa.', true); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { flash('Ingresa un correo válido.', true); return; }
    setOcupado(true);
    try {
      const { empresa, ya_existia } = await api.adminSiiCrearEmpresa({ nombre_empresa: nombre, rut });
      // Si la empresa YA tenía acceso web, enrolar de nuevo no es un error:
      // casi siempre el admin está acá porque el correo se perdió. Se reenvía
      // la invitación al correo ya registrado de esa cuenta. El otro 409
      // ('email_en_uso') es distinto — el correo pertenece a otra cuenta — y
      // ahí sí corresponde mostrar el error, no reenviar nada.
      let acceso, reenviada = false;
      try {
        acceso = await api.accesosProveedorCrearCuenta(empresa.id, { email });
      } catch (err) {
        if (err.data?.codigo !== 'entidad_con_cuenta') throw err;
        acceso = await api.accesosProveedorReenviarInvitacion(empresa.id);
        reenviada = true;
      }
      setResultado({ empresa, acceso, ya_existia, reenviada });
      flash(acceso.correo_enviado === false
        ? `${reenviada ? 'Invitación reenviada' : 'Empresa enrolada'}; el correo no pudo enviarse — comparte el enlace de abajo.`
        : reenviada
          ? `Esta empresa ya estaba enrolada — le reenviamos la invitación a ${acceso.email}.`
          : 'Empresa enrolada e invitación enviada por correo.');
    } catch (err) { flash(err.message, true); } finally { setOcupado(false); }
  }

  function reiniciar() {
    setRut(''); setNombre(''); setEmail(''); setSii(null); setResultado(null);
  }

  if (resultado) {
    const { empresa, acceso } = resultado;
    return (
      <div>
        <h1 style={{ marginTop: 0 }}>Enrolar empresa</h1>
        <div className="card" style={{ maxWidth: 560 }}>
          <div className="badge badge-green" style={{ marginBottom: 12 }}>
            {resultado.reenviada ? 'Invitación reenviada' : 'Empresa enrolada'}
          </div>
          <p style={{ fontSize: 14 }}>
            <strong>{empresa.nombre_empresa}</strong> <span style={{ fontFamily: 'monospace' }}>{formatearRut(empresa.rut)}</span>
            {resultado.ya_existia && ' (ya estaba registrada)'} — {acceso.correo_enviado === false
              ? 'la invitación no pudo enviarse por correo.'
              : `recibió la invitación por correo${resultado.reenviada ? ` en ${acceso.email}` : ''}.`} Al entrar, la empresa
            completa sus datos y conecta el SII desde su propio panel.
          </p>
          {acceso?.dev_activation_link && (
            <p className="muted" style={{ fontSize: 12, wordBreak: 'break-all' }}>
              Enlace de invitación: <code>{acceso.dev_activation_link}</code>
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <button className="btn btn-primary" onClick={reiniciar}>Enrolar otra empresa</button>
            <button className="btn btn-outline" onClick={() => navigate('/admin/sii')}>Ir a la contabilidad de carbono</button>
          </div>
        </div>
        {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Enrolar empresa</h1>
      <p className="muted" style={{ fontSize: 14, maxWidth: 640, marginTop: 0 }}>
        Ingresa el RUT y el correo de la empresa. Al enrolarla se le envía una invitación para que
        active su cuenta, complete sus datos y conecte el SII desde su propio panel.
      </p>

      <form onSubmit={enrolar} className="card" style={{ maxWidth: 480 }}>
        <div className="field">
          <label>RUT de la empresa</label>
          <input value={rut} onChange={(e) => setRut(e.target.value)} onBlur={consultarSii} placeholder="76000000-0" />
        </div>
        <div className="field">
          <label>Nombre de la empresa {sii === 'consultando' && <span className="spinner" style={{ marginLeft: 6 }} />}</label>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Empresa SpA" />
          {sii && sii !== 'consultando' && (
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Completado desde el SII con el RUT.</div>
          )}
        </div>
        <div className="field">
          <label>Correo de la empresa</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contacto@empresa.cl" autoComplete="off" />
        </div>
        <button className="btn btn-primary" type="submit" disabled={ocupado}>
          {ocupado ? <><span className="spinner" /> Enrolando…</> : 'Enrolar y enviar invitación'}
        </button>
      </form>

      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}
