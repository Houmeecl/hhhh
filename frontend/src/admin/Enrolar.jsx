import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, fmtFecha } from '../api.js';
import { validarRut, formatearRut } from '../lib/rut.js';
import CrearCuentaWeb from './CrearCuentaWeb.jsx';

// Enrolar una empresa en un solo paso: RUT (autocompleta razón social desde
// el SII al salir del campo) + correo → crea la empresa y envía la
// invitación. La empresa completa el resto (datos + conectar el SII) sola,
// desde su propio panel, al entrar por el enlace del correo.
//
// Debajo del formulario vive la COLA: las empresas que quedaron a medio
// enrolar. Está acá y no en una pantalla propia porque es el mismo trabajo
// —dar de alta empresas— y porque el paso que más se olvidaba (emitir el
// contrato) solo se podía hacer desde Contabilidad, a dos clics de distancia
// de donde el admin estaba parado.
export default function Enrolar() {
  const navigate = useNavigate();
  const [rut, setRut] = useState('');
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [sii, setSii] = useState(null); // null | 'consultando' | { razonSocial }
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState(null); // { empresa, acceso }
  const [refresco, setRefresco] = useState(0); // sube para que la cola vuelva a pedir
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
      setRefresco((n) => n + 1);
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

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Enrolar empresa</h1>

      {resultado ? (
        <div className="card" style={{ maxWidth: 560 }}>
          <div className="badge badge-green" style={{ marginBottom: 12 }}>
            {resultado.reenviada ? 'Invitación reenviada' : 'Empresa enrolada'}
          </div>
          <p style={{ fontSize: 14 }}>
            <strong>{resultado.empresa.nombre_empresa}</strong>{' '}
            <span style={{ fontFamily: 'monospace' }}>{formatearRut(resultado.empresa.rut)}</span>
            {resultado.ya_existia && ' (ya estaba registrada)'} — {resultado.acceso.correo_enviado === false
              ? 'la invitación no pudo enviarse por correo.'
              : `recibió la invitación por correo${resultado.reenviada ? ` en ${resultado.acceso.email}` : ''}.`}
          </p>
          {/* Antes acá decía que la empresa "conecta el SII desde su propio
              panel" y se terminaba la frase. No era cierto: el panel recién
              se le abre cuando tiene contrato, y eso lo emitimos nosotros.
              La empresa quedaba en "Cuenta en revisión" y el admin creía
              haber terminado. */}
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
            Al entrar define su clave y completa los datos de su empresa. Después
            <strong> falta que le emitas el contrato</strong>: hasta entonces ve
            «Cuenta en revisión» y no puede conectar el SII. La vas a encontrar
            abajo, en la cola, cuando le toque.
          </p>
          {resultado.acceso?.dev_activation_link && (
            <p className="muted" style={{ fontSize: 12, wordBreak: 'break-all' }}>
              Enlace de invitación: <code>{resultado.acceso.dev_activation_link}</code>
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <button className="btn btn-primary" onClick={reiniciar}>Enrolar otra empresa</button>
            <button className="btn btn-outline" onClick={() => navigate('/admin/sii')}>Ir a la contabilidad de carbono</button>
          </div>
        </div>
      ) : (
        <>
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
        </>
      )}

      <ColaOnboarding flash={flash} refresco={refresco} />

      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}

// Etiquetas de las etapas de services/onboarding.js. El texto largo
// ('descripcion') viene del backend para que no se contradigan; acá solo
// vive lo corto y el color.
const ETAPA = {
  sin_cuenta: { texto: 'Sin acceso web', color: 'badge-amber' },
  cuenta_suspendida: { texto: 'Cuenta suspendida', color: 'badge-red' },
  invitacion_vencida: { texto: 'Invitación vencida', color: 'badge-amber' },
  sin_activar: { texto: 'Invitación enviada', color: 'badge-gray' },
  sin_datos: { texto: 'Completando datos', color: 'badge-gray' },
  sin_contrato: { texto: 'Falta el contrato', color: 'badge-amber' },
};

const diasDesde = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));

// Las empresas que quedaron a medio camino, y en qué puerta.
//
// Lo único que se ofrece como botón es lo que está en NUESTRAS manos
// (`bloqueado_por === 'sicr3p'`). Las que esperan por la empresa se listan
// igual, pero sin acción: inventarle un botón al admin sobre algo que no
// depende de él es ruido, y hace que la cola deje de leerse.
function ColaOnboarding({ flash, refresco }) {
  const [cola, setCola] = useState(null); // null mientras carga
  const [ocupada, setOcupada] = useState(null); // id de la empresa con acción en curso
  const [cuentaWeb, setCuentaWeb] = useState(null);

  const cargar = () => api.onboardingEmpresas()
    .then(setCola)
    .catch((e) => { setCola({ empresas: [], esperando_por_nosotros: 0 }); flash(e.message, true); });

  useEffect(() => { cargar(); }, [refresco]);

  async function accionar(emp) {
    setOcupada(emp.id);
    try {
      if (emp.accion === 'emitir_contrato') {
        await api.adminSiiEmitirContrato(emp.id);
        flash(`Contrato emitido en borrador — a ${emp.nombre_empresa} ya se le abrió el panel.`);
      } else if (emp.accion === 'reenviar_invitacion') {
        const r = await api.accesosProveedorReenviarInvitacion(emp.id);
        flash(r.correo_enviado === false
          ? 'No se pudo enviar el correo. Revisa el transporte de correo.'
          : `Invitación reenviada a ${r.email || emp.email}.`);
      }
      cargar();
    } catch (e) { flash(e.message, true); } finally { setOcupada(null); }
  }

  if (cola === null) return <div className="muted" style={{ marginTop: 26, fontSize: 13 }}><span className="spinner" /> Cargando la cola…</div>;

  return (
    <div style={{ marginTop: 30 }}>
      <h2 style={{ fontSize: 17, marginBottom: 4 }}>Empresas a medio enrolar</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: 0, maxWidth: 640 }}>
        {cola.empresas.length === 0
          ? 'Ninguna. Todas las empresas activas tienen su cuenta, sus datos y su contrato.'
          : cola.esperando_por_nosotros === 0
            ? `${cola.empresas.length} ${cola.empresas.length === 1 ? 'empresa está' : 'empresas están'} en camino, todas esperando por ellas mismas. Nada pendiente de nuestro lado.`
            : `${cola.esperando_por_nosotros} de ${cola.empresas.length} ${cola.esperando_por_nosotros === 1 ? 'espera' : 'esperan'} por nosotros.`}
      </p>

      {cola.empresas.length > 0 && (
        <div className="card">
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr><th>Empresa</th><th>Estado</th><th>Esperando</th><th></th></tr>
              </thead>
              <tbody>
                {cola.empresas.map((e) => {
                  const et = ETAPA[e.etapa] || { texto: e.etapa, color: 'badge-gray' };
                  const nuestra = e.bloqueado_por === 'sicr3p';
                  const dias = diasDesde(e.created_at);
                  return (
                    <tr key={e.id}>
                      {/* El RUT y el correo van bajo el nombre y no en
                          columnas propias: con seis columnas la tabla obligaba
                          a scrollear medio metro en el celular para llegar al
                          botón, que es lo único accionable de la fila. */}
                      <td>
                        <b>{e.nombre_empresa}</b>
                        <div className="muted" style={{ fontFamily: 'monospace', fontSize: 12 }}>{formatearRut(e.rut)}</div>
                        {e.email && <div className="muted" style={{ fontSize: 12 }}>{e.email}</div>}
                      </td>
                      <td>
                        <span className={`badge ${et.color}`}>{et.texto}</span>
                        <div className="muted" style={{ fontSize: 12, marginTop: 3, maxWidth: 300 }}>{e.descripcion}</div>
                        {e.etapa === 'sin_activar' && e.invitacion_expira && (
                          <div className="muted" style={{ fontSize: 12 }}>Vence el {fmtFecha(e.invitacion_expira)}.</div>
                        )}
                        <div style={{ fontSize: 12, marginTop: 3 }}>
                          Esperando a {nuestra ? <b>nosotros</b> : <span className="muted">la empresa</span>}
                        </div>
                      </td>
                      <td className="muted" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                        {dias === 0 ? 'hoy' : `${dias} ${dias === 1 ? 'día' : 'días'}`}
                      </td>
                      <td>
                        {e.accion === 'crear_acceso' && (
                          <button className="btn btn-outline btn-sm" onClick={() => setCuentaWeb(e)}>Crear acceso web</button>
                        )}
                        {(e.accion === 'emitir_contrato' || e.accion === 'reenviar_invitacion') && (
                          <button className="btn btn-primary btn-sm" disabled={ocupada === e.id} onClick={() => accionar(e)}>
                            {ocupada === e.id
                              ? <span className="spinner" />
                              : e.accion === 'emitir_contrato' ? 'Emitir contrato' : 'Reenviar invitación'}
                          </button>
                        )}
                        {/* Reactivar una cuenta suspendida no se hace desde acá:
                            vive en Usuarios y es una decisión distinta a enrolar. */}
                        {e.accion === 'reactivar' && (
                          <Link className="btn btn-outline btn-sm" to="/admin/usuarios">Ver en Usuarios</Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {cuentaWeb && (
        <CrearCuentaWeb
          entidad={cuentaWeb}
          nombreEntidad={cuentaWeb.nombre_empresa}
          crear={api.accesosProveedorCrearCuenta}
          onCreada={cargar}
          onClose={() => { setCuentaWeb(null); cargar(); }}
        />
      )}
    </div>
  );
}
