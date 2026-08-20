import { useEffect, useState } from 'react';
import Icon from '../components/icons.jsx';
import Semaforo from './Semaforo.jsx';
import { apiCorredor } from './api.js';

// Alta y listado de empresas exportadoras — la ÚNICA pantalla del admin
// del Corredor.
//
// Por qué existe: `POST /exportadores` estaba escrito desde la primera
// tanda y ninguna pantalla lo llamaba. Un admin entraba al panel y veía
// las dos pestañas del operador —Cargas y Predios—, que para él están
// siempre vacías porque no tiene empresa asociada. O sea, entraba y no
// había nada, que es exactamente lo que pasó en producción.
//
// La clave temporal se muestra UNA vez, acá, y no se vuelve a poder
// consultar: el backend la devuelve en el response del alta y no la
// guarda en claro en ninguna parte. Si se pierde, se rota; no se recupera.

const fecha = (d) => (d ? new Date(d).toLocaleDateString('es-CL') : '—');

// Tres estados, no dos, y el que importa es el del medio: una empresa que
// entró pero sigue con la clave temporal NO puede operar (el backend le
// rechaza todo con 403). Antes los tres se distinguían solo por el color
// de una píldora que además decía lo mismo en dos de los tres casos
// ("entró el …"), y la diferencia real quedaba en letra chica gris al
// lado. Ahora cada estado dice EN EL TEXTO lo que es, lleva su color y
// —por .badge-sem— su propia forma de punto.
function accesoDe(e) {
  if (!e.ultimo_acceso) {
    return {
      estado: 'gris',
      texto: 'Nunca entró',
      detalle: 'Todavía no usa la clave que se le entregó.',
    };
  }
  if (e.must_reset_password) {
    return {
      estado: 'amarillo',
      texto: 'Clave temporal sin cambiar',
      detalle: `Entró el ${fecha(e.ultimo_acceso)}, pero no puede operar hasta definir su clave.`,
    };
  }
  return {
    estado: 'verde',
    texto: 'Cuenta activa',
    detalle: `Último acceso: ${fecha(e.ultimo_acceso)}`,
  };
}

const VACIO = {
  nombre_empresa: '', rut: '', pais: 'CL', eori: '',
  contacto_email: '', contacto_nombre: '', direccion: '',
};

export default function Empresas() {
  const [lista, setLista] = useState(null);
  const [form, setForm] = useState(VACIO);
  const [creando, setCreando] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const [reciente, setReciente] = useState(null);   // { empresa, email, password }
  const [toast, setToast] = useState(null);
  const flash = (msg, err = false) => { setToast({ msg, err }); setTimeout(() => setToast(null), 5000); };

  const cargar = () => apiCorredor.exportadores()
    .then((r) => setLista(r.exportadores))
    .catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function crear() {
    setCreando(true);
    try {
      const r = await apiCorredor.crearExportador({
        ...form,
        pais: (form.pais || 'CL').toUpperCase(),
        eori: form.eori || null,
      });
      setReciente({
        empresa: r.exportador.nombre_empresa,
        email: r.usuario.email,
        password: r.password_temporal,
      });
      setForm(VACIO);
      setAbierto(false);
      cargar();
    } catch (err) { flash(err.message, true); } finally { setCreando(false); }
  }

  const listo = form.nombre_empresa.trim() && form.rut.trim() && form.contacto_email.trim();

  return (
    <>
      {toast && (
        <div className={`cor-aviso ${toast.err ? 'cor-aviso-alto' : 'cor-aviso-ok'}`} role="status">
          {toast.err ? <Icon.Alert size={16} /> : <Icon.CheckCircle size={16} />}
          <div>{toast.msg}</div>
        </div>
      )}

      {/* La credencial recién creada. Se queda en pantalla hasta que la
          cierran a propósito: si desapareciera sola, la clave se pierde. */}
      {reciente && (
        <div className="card card-pad cor-cred">
          <h3>Credencial de {reciente.empresa}</h3>
          <p className="cor-nota" style={{ marginTop: 0 }}>
            Se muestra una sola vez y no queda guardada: si se pierde, hay que rotarla.
            Entrégala por un canal distinto del que uses para el enlace de acceso.
          </p>
          <div className="table-scroll">
            <table className="data">
              <tbody>
                <tr><td style={{ width: 120 }}>Correo</td><td className="mono">{reciente.email}</td></tr>
                <tr><td>Clave temporal</td><td className="mono" style={{ fontWeight: 700 }}>{reciente.password}</td></tr>
              </tbody>
            </table>
          </div>
          <p className="cor-nota">
            Con esta clave no se puede operar: al entrar, la empresa tiene que definir la suya.
          </p>
          <button className="btn btn-outline btn-sm" style={{ marginTop: 12 }} onClick={() => setReciente(null)}>
            Ya la copié
          </button>
        </div>
      )}

      <div className="cor-head cor-head-fila">
        <div>
          <h1>Empresas exportadoras</h1>
          <p>Cada empresa entra con su propia cuenta y solo ve sus cargas y sus predios.</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setAbierto((v) => !v)}>
          {abierto ? 'Cancelar' : 'Enrolar empresa'}
        </button>
      </div>

      {abierto && (
        <div className="card card-pad cor-form" style={{ marginBottom: 18 }}>
          <div className="cor-grid cor-grid-ancho">
            <div className="field">
              <label>Nombre de la empresa</label>
              <input value={form.nombre_empresa} onChange={set('nombre_empresa')} placeholder="Agro del Sur Ltda." />
            </div>
            <div className="field">
              <label>RUT o identificador tributario</label>
              <input value={form.rut} onChange={set('rut')} placeholder="76.123.456-0" />
            </div>
            <div className="field">
              <label>País</label>
              <select value={form.pais} onChange={set('pais')}>
                <option value="CL">Chile</option>
                <option value="BR">Brasil</option>
                <option value="PY">Paraguay</option>
                <option value="AR">Argentina</option>
              </select>
            </div>
            <div className="field">
              <label>EORI (opcional)</label>
              <input value={form.eori} onChange={set('eori')} placeholder="BR1234567" />
            </div>
            <div className="field">
              <label>Correo de contacto</label>
              <input type="email" value={form.contacto_email} onChange={set('contacto_email')} placeholder="operaciones@empresa.cl" />
            </div>
            <div className="field">
              <label>Nombre del contacto (opcional)</label>
              <input value={form.contacto_nombre} onChange={set('contacto_nombre')} />
            </div>
          </div>
          <p className="cor-nota" style={{ margin: '12px 0 14px' }}>
            El EORI lo exige el EUDR para identificar a quien pone el producto en el mercado europeo.
            Se puede agregar después, pero sin él la declaración no se presenta.
          </p>
          <button className="btn btn-primary" onClick={crear} disabled={creando || !listo}>
            {creando ? <span className="spinner" /> : 'Crear empresa y su acceso'}
          </button>
        </div>
      )}

      {lista === null && <p className="muted"><span className="spinner dark" /> Cargando…</p>}

      {lista && lista.length === 0 && (
        <div className="card card-pad cor-vacio">
          <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>Todavía no hay ninguna empresa</h3>
          <p className="cor-nota" style={{ margin: 0 }}>
            Enrola la primera con el botón de arriba. Recibirás su clave temporal para entregársela;
            las cargas y los predios los registra cada empresa desde su propia cuenta.
          </p>
        </div>
      )}

      {lista && lista.length > 0 && (
        <div className="card">
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>Acceso</th>
                  <th className="num">Cargas</th>
                  <th className="num">Predios</th>
                  <th>Alta</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((e) => {
                  const acceso = accesoDe(e);
                  return (
                    <tr key={e.id}>
                      <td>
                        <b style={{ fontSize: 13.5 }}>{e.nombre_empresa}</b>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {e.pais} · {e.rut}{e.eori ? ` · EORI ${e.eori}` : ' · sin EORI'}
                        </div>
                      </td>
                      <td>
                        <Semaforo estado={acceso.estado}>{acceso.texto}</Semaforo>
                        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{acceso.detalle}</div>
                        <div className="muted mono" style={{ fontSize: 12 }}>{e.usuario_email || '—'}</div>
                      </td>
                      <td className="num">{e.n_cargas}</td>
                      <td className="num">{e.n_parcelas}</td>
                      <td className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fecha(e.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
