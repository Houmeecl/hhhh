import { useEffect, useState } from 'react';
import { api, fmtFecha } from '../api.js';
import { Icon } from '../components/icons.jsx';
import CrearCuentaWeb from './CrearCuentaWeb.jsx';
import { PUNTOS_CORREDOR } from '../lib/corredor.js';
import { puedeVerSeccion } from './secciones.js';

// Accesos externos: API para mandantes + códigos de prueba con créditos.
// Una cuenta con la sección 'proveedores' (más angosta que
// 'accesos_externos') llega a esta MISMA pantalla (AdminApp.jsx la deja
// pasar) pero solo ve la tab Proveedores — el resto de las entidades
// (mandantes/puertos/agencias/trazadores/códigos/puntos limpios) siguen
// exigiendo 'accesos_externos' completo, tanto acá como en el backend.
export default function Accesos({ user }) {
  // Fail-safe a propósito: la vista completa exige el chequeo POSITIVO
  // ('accesos_externos'); cualquier otro caso (solo 'proveedores', o
  // incluso `user` ausente si esta pantalla se llegara a montar sin la
  // guardia de ruta) cae en la vista angosta — nunca al revés.
  const puedeVerTodo = puedeVerSeccion(user, 'accesos_externos');
  const [tab, setTab] = useState(puedeVerTodo ? 'codigos' : 'proveedores');
  const [toast, setToast] = useState(null);
  const flash = (msg, err = false) => { setToast({ msg, err }); setTimeout(() => setToast(null), 3500); };

  return (
    <div>
      <div className="admin-head">
        <div>
          <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: 'var(--green-600)' }}><Icon.Qr size={24} /></span> {puedeVerTodo ? 'Accesos externos' : 'Proveedores'}
          </h1>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>
            {!puedeVerTodo
              ? 'Empresas proveedoras y sus cuentas de panel propio (login por llave USB para firmar lotes de producto en Pasaporte de Origen).'
              : 'Códigos de prueba con créditos (1 crédito = 1 factura), API keys para empresas mandantes, ' +
                'API keys para puertos (tránsito del Corredor por su punto), accesos para agencias de aduana ' +
                '(Pasaporte Bioceánico — sicr3p es su infraestructura documental, nunca se presenta como agencia) ' +
                'y cuentas de proveedor con login por llave USB para firmar lotes de producto en Pasaporte de Origen.'}
          </p>
        </div>
      </div>

      {puedeVerTodo && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
          <button className={`btn btn-sm ${tab === 'codigos' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('codigos')}>Códigos de prueba</button>
          <button className={`btn btn-sm ${tab === 'mandantes' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('mandantes')}>API mandantes</button>
          <button className={`btn btn-sm ${tab === 'puertos' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('puertos')}>API puertos</button>
          <button className={`btn btn-sm ${tab === 'agencias' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('agencias')}>Agencias de aduana</button>
          <button className={`btn btn-sm ${tab === 'trazadores' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('trazadores')}>Trazadores</button>
          <button className={`btn btn-sm ${tab === 'proveedores' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('proveedores')}>Proveedores</button>
          <button className={`btn btn-sm ${tab === 'puntos_limpios' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('puntos_limpios')}>Puntos limpios</button>
          <button className={`btn btn-sm ${tab === 'entregas' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('entregas')}>Entregas</button>
        </div>
      )}

      {tab === 'codigos' && puedeVerTodo && <Codigos flash={flash} />}
      {tab === 'mandantes' && puedeVerTodo && <Mandantes flash={flash} />}
      {tab === 'puertos' && puedeVerTodo && <Puertos flash={flash} />}
      {tab === 'agencias' && puedeVerTodo && <Agencias flash={flash} />}
      {tab === 'trazadores' && puedeVerTodo && <Trazadores flash={flash} />}
      {tab === 'proveedores' && <Proveedores flash={flash} />}
      {tab === 'puntos_limpios' && puedeVerTodo && <PuntosLimpios flash={flash} />}
      {tab === 'entregas' && <Entregas flash={flash} />}
      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}

// ============================================================
// Acuse de entregas: qué archivo exacto recibió cada empresa.
//
// La tabla `entregas` existe para responder esa pregunta y hasta acá solo
// se escribía — había INSERT y purga por retención, y ningún SELECT. Un
// registro que nadie puede leer no es un registro.
//
// El número que importa mirar es "salieron sin cifrar": si sube, hay
// empresas a las que nadie les entregó su clave de informes.
//
// No guarda el archivo, solo su hash: sirve para comparar contra lo que el
// cliente diga que recibió, no para volver a mandarlo.
// ============================================================
function Entregas({ flash }) {
  const [datos, setDatos] = useState({ entregas: [], en_claro: 0 });
  const [filtro, setFiltro] = useState({ empresa: '', desde: '', hasta: '' });
  const [cargando, setCargando] = useState(false);

  const cargar = () => {
    setCargando(true);
    api.accesosEntregas(filtro)
      .then(setDatos)
      .catch((e) => flash(e.message, true))
      .finally(() => setCargando(false));
  };
  useEffect(() => { cargar(); }, []);

  const TIPOS = {
    informe_sesion: 'Informe consolidado',
    informe_mensual: 'Informe mensual',
    comprobante_transporte: 'Comprobante transporte',
    carpeta_mandante: 'Carpeta mandante',
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card card-pad">
        <div className="form-row" style={{ gridTemplateColumns: '2fr 1fr 1fr auto', margin: 0, alignItems: 'end' }}>
          <div className="field"><label>Empresa o correo</label>
            <input value={filtro.empresa} onChange={(e) => setFiltro({ ...filtro, empresa: e.target.value })} /></div>
          <div className="field"><label>Desde</label>
            <input type="date" value={filtro.desde} onChange={(e) => setFiltro({ ...filtro, desde: e.target.value })} /></div>
          <div className="field"><label>Hasta</label>
            <input type="date" value={filtro.hasta} onChange={(e) => setFiltro({ ...filtro, hasta: e.target.value })} /></div>
          <button className="btn btn-primary" onClick={cargar} disabled={cargando}>
            {cargando ? <span className="spinner" /> : 'Buscar'}
          </button>
        </div>
        {datos.en_claro > 0 && (
          <p className="muted" style={{ fontSize: 13, marginTop: 12, marginBottom: 0 }}>
            <b>{datos.en_claro}</b> de {datos.entregas.length} salieron <b>sin cifrar</b>. Suele
            significar que a esa empresa nadie le entregó todavía su clave de informes — se hace
            desde la pestaña de códigos o de proveedores.
          </p>
        )}
      </div>

      <div className="card">
        <div className="table-scroll">
          <table className="data">
            <thead><tr>
              <th>Fecha</th><th>Tipo</th><th>Empresa</th><th>Enviado a</th>
              <th>Cifrado</th><th className="num">Peso</th><th>Huella del archivo</th>
            </tr></thead>
            <tbody>
              {datos.entregas.map((e) => (
                <tr key={e.id}>
                  <td className="muted" style={{ fontSize: 13 }}>{fmtFecha(e.created_at)}</td>
                  <td style={{ fontSize: 13 }}>{TIPOS[e.tipo] || e.tipo}{e.periodo && <div className="muted" style={{ fontSize: 12 }}>{e.periodo}</div>}</td>
                  <td style={{ fontSize: 13 }}>{e.proveedor_empresa || e.codigo_empresa || '—'}
                    {e.codigo && <div className="muted" style={{ fontFamily: 'monospace', fontSize: 11 }}>{e.codigo}</div>}</td>
                  <td className="muted" style={{ fontSize: 13 }}>{e.destinatario_email}</td>
                  <td>
                    <span className={`badge ${e.cifrado ? 'badge-green' : 'badge-yellow'}`}>
                      {e.cifrado ? 'Cifrado' : 'En claro'}
                    </span>
                  </td>
                  <td className="num muted" style={{ fontSize: 13 }}>{Math.round(e.bytes / 1024)} KB</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }} title={e.hash_archivo}>
                    {e.hash_archivo.slice(0, 16)}…
                  </td>
                </tr>
              ))}
              {datos.entregas.length === 0 && (
                <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 30 }}>
                  Sin entregas registradas para ese filtro.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Clave de informes: entregarla y rotarla.
//
// POR QUÉ ESTA COLUMNA EXISTE. Los PDF que se le entregan a una empresa
// salen cifrados con una clave suya. Durante un tiempo esa clave se creaba
// SOLA al mandar el archivo y, salvo en el flujo de cobros, la empresa
// nunca la recibía: le llegaba un PDF que no podía abrir. Ahora la clave
// nace cuando alguien se la entrega — y este botón es ese "alguien".
//
// Mientras diga "Sin clave", los informes de esa empresa salen EN CLARO a
// propósito. Es preferible a mandar un archivo ilegible, y el acuse de
// entregas lo deja anotado.
//
// LA CLAVE SE VE UNA SOLA VEZ. Después solo se puede reenviar por correo o
// rotar — mismo criterio que las claves de tarjeta de viaje y de llave de
// archivo. No hay pantalla que la muestre de vuelta.
// ============================================================
function ClaveInforme({ clase, item, flash, onCambio }) {
  const [ocupado, setOcupado] = useState(false);
  const [reciente, setReciente] = useState(null);

  // TRES estados, no dos. Antes esto era un booleano `IS NOT NULL` pintado
  // como "Clave entregada", y por eso una clave fantasma —creada por el bug
  // viejo, que nadie recibió— se veía EXACTAMENTE igual que una sana. El
  // operador no tenía forma de saber a quién había que atender.
  const tiene = item.tiene_clave_informe;
  const entregada = item.clave_informe_entregada_at;
  const fantasma = tiene && !entregada;

  async function accion(rotar, aMano = false) {
    if (rotar && !window.confirm(
      'Se genera una clave NUEVA y se le envía por correo.\n\n'
      + 'Los informes que ya recibió siguen abriéndose con la clave anterior: '
      + 'no se vuelven a cifrar. La nueva aplica solo a los que se envíen de ahora en adelante.\n\n'
      + '¿Rotar la clave?'
    )) return;
    setOcupado(true);
    try {
      const r = rotar
        ? await api.rotarClaveInforme(clase, item.id)
        : await api.entregarClaveInforme(clase, item.id, aMano);
      setReciente(r.clave);
      flash(r.entregada_at
        ? `Clave ${rotar ? 'rotada' : 'entregada'}${r.enviada_a ? ` y enviada a ${r.enviada_a}` : ' (marcada como entregada a mano)'}.`
        : 'La clave quedó emitida pero NO se pudo enviar: sigue sin entregar. Dictala y márcala a mano.');
      onCambio?.();
    } catch (e) { flash(e.message, true); }
    finally { setOcupado(false); }
  }

  return (
    <div>
      <span className={`badge ${entregada ? 'badge-green' : fantasma ? 'badge-yellow' : 'badge-gray'}`}>
        {entregada ? 'Entregada' : fantasma ? 'Emitida, sin entregar' : 'Sin clave'}
      </span>
      {entregada && (
        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{fmtFecha(entregada)}</div>
      )}

      <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className={`btn btn-sm ${fantasma ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => accion(false)} disabled={ocupado}>
          {entregada ? 'Reenviar' : 'Entregar clave'}
        </button>
        {tiene && (
          <button className="btn btn-outline btn-sm" onClick={() => accion(true)} disabled={ocupado}>
            Rotar
          </button>
        )}
      </div>

      {reciente && (
        <div style={{
          marginTop: 6, padding: '6px 8px', border: '1px solid var(--green)',
          borderRadius: 6, fontFamily: 'monospace', fontWeight: 700, fontSize: 13,
        }}>
          {reciente}
          <div className="muted" style={{ fontFamily: 'system-ui', fontWeight: 400, fontSize: 11, marginTop: 2 }}>
            Anótala ahora: no se vuelve a mostrar.
          </div>
          {/* Sin correo registrado, la clave se dicta por teléfono. Marcarla
              como entregada tiene que ser un acto explícito del operador —
              darlo por hecho es justo el error que causó las fantasma. */}
          {!item.clave_informe_entregada_at && (
            <button className="btn btn-outline btn-sm" style={{ marginTop: 6 }}
                    onClick={() => accion(false, true)} disabled={ocupado}>
              Ya se la entregué (marcar)
            </button>
          )}
        </div>
      )}

      {/* Lo que significa en la práctica, en una línea. Sin esto el estado
          intermedio no le dice nada a quien lo mira. */}
      {fantasma && (
        <div className="muted" style={{ fontSize: 11, marginTop: 3, lineHeight: 1.4 }}>
          Sus informes salen <b>sin cifrar</b>, y los que ya recibió cifrados
          <b> no los puede abrir</b> hasta que le entregues esta clave.
        </div>
      )}
      {!tiene && (
        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
          Sus informes salen sin cifrar.
        </div>
      )}
    </div>
  );
}

// Cuántas empresas tienen clave emitida y sin entregar. Es la lista de
// trabajo del operador: cada una es alguien que hoy no puede abrir lo que
// le mandamos. En régimen normal esto tiene que ser cero.
function AvisoClavesPendientes({ items }) {
  const n = items.filter((i) => i.tiene_clave_informe && !i.clave_informe_entregada_at).length;
  if (!n) return null;
  return (
    <div className="card card-pad" style={{ borderColor: 'var(--yellow, #d97706)', marginBottom: 12 }}>
      <b>{n} {n === 1 ? 'empresa tiene' : 'empresas tienen'} una clave de informes sin entregar.</b>
      <div className="muted" style={{ fontSize: 13, marginTop: 4, lineHeight: 1.5 }}>
        Se les generó una clave pero nunca se les envió, así que no pueden abrir los informes
        cifrados que ya recibieron. Entregársela desde acá manda <b>la misma</b> clave, así que
        esos archivos vuelven a ser legibles.
      </div>
    </div>
  );
}

function Codigos({ flash }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ cantidad: '5', creditos: '5', empresa: '', email: '', modo_juego: false });
  const [creando, setCreando] = useState(false);
  const [nuevos, setNuevos] = useState([]);

  const cargar = () => api.codigos().then((r) => setItems(r.codigos)).catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);

  async function crear() {
    setCreando(true);
    try {
      const { codigos } = await api.crearCodigos({
        cantidad: Number(form.cantidad) || 1, creditos: Number(form.creditos) || 5,
        empresa: form.empresa, email: form.email, modo_juego: form.modo_juego,
      });
      setNuevos(codigos.map((c) => c.codigo));
      cargar(); flash(`${codigos.length} código(s) generados.`);
    } catch (e) { flash(e.message, true); }
    finally { setCreando(false); }
  }

  async function toggle(c) {
    try { await api.editarCodigo(c.id, { activo: !c.activo }); cargar(); }
    catch (e) { flash(e.message, true); }
  }

  return (
    <div className="form-content-grid">
      <div style={{ display: 'grid', gap: 16 }}>
        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Generar códigos</h3>
          <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr', margin: '0 0 12px' }}>
            <div className="field"><label>Cantidad</label><input value={form.cantidad} onChange={(e) => setForm({ ...form, cantidad: e.target.value.replace(/\D/g, '') })} /></div>
            <div className="field"><label>Créditos c/u</label><input value={form.creditos} onChange={(e) => setForm({ ...form, creditos: e.target.value.replace(/\D/g, '') })} /></div>
            <div className="field"><label>Empresa (opcional)</label><input value={form.empresa} onChange={(e) => setForm({ ...form, empresa: e.target.value })} /></div>
            <div className="field"><label>Email (opcional)</label><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.modo_juego} onChange={(e) => setForm({ ...form, modo_juego: e.target.checked })} />
            Código de campaña "Sube y Suma" (habilita el juego de puntos para el equipo de esta empresa)
          </label>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={crear} disabled={creando}>
            {creando ? <span className="spinner" /> : 'Generar'}
          </button>
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            El invitado entra en <b>sicr3p.cl/prueba</b> con su código (o en <b>/suma/login</b> si es de campaña).
            Cada factura procesada consume 1 crédito.
          </p>
        </div>
        {nuevos.length > 0 && (
          <div className="card card-pad" style={{ borderColor: 'var(--green)' }}>
            <h3 style={{ marginTop: 0 }}>Recién generados</h3>
            {nuevos.map((c) => <div key={c} style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 15, padding: '4px 0' }}>{c}</div>)}
          </div>
        )}
      </div>

      <AvisoClavesPendientes items={items} />
      <div className="card">
        <div className="table-scroll">
        <table className="data">
          <thead><tr><th>Código</th><th>Empresa</th><th className="num">Créditos</th><th>Último uso</th><th>Conexión</th><th>Clave de informes</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {items.map((c) => {
              const conexion = c.creditos_usados > 0
                ? { texto: 'Usó créditos', clase: 'badge-green' }
                : c.primera_conexion_at
                  ? { texto: 'Conectado, sin usar créditos', clase: 'badge-yellow' }
                  : { texto: 'No conectado', clase: 'badge-gray' };
              return (
              <tr key={c.id}>
                <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>
                  {c.codigo}
                  {c.modo_juego && <div><span className="badge badge-gray" style={{ fontSize: 10, marginTop: 2 }}>Sube y Suma</span></div>}
                </td>
                <td className="muted" style={{ fontSize: 13 }}>{c.empresa || '—'}{c.email && <div style={{ fontSize: 12 }}>{c.email}</div>}</td>
                <td className="num"><b>{c.creditos - c.creditos_usados}</b> / {c.creditos}</td>
                <td className="muted" style={{ fontSize: 13 }}>{c.ultimo_uso ? fmtFecha(c.ultimo_uso) : '—'}</td>
                <td><span className={`badge ${conexion.clase}`}>{conexion.texto}</span></td>
                <td>
                  {/* Una campaña de "Sube y Suma" NUNCA porta clave: la
                      comparten todos los jugadores y ellos entran por magic
                      link, sin recibir clave alguna. Sus informes salen en
                      claro a propósito. */}
                  {c.modo_juego
                    ? <span className="muted" style={{ fontSize: 12 }}>No aplica (campaña)</span>
                    : <ClaveInforme clase="codigos" item={c} flash={flash} onCambio={cargar} />}
                </td>
                <td><span className={`badge ${c.activo ? 'badge-green' : 'badge-gray'}`}>{c.activo ? 'Activo' : 'Inactivo'}</span></td>
                <td><button className="btn btn-outline btn-sm" onClick={() => toggle(c)}>{c.activo ? 'Desactivar' : 'Activar'}</button></td>
              </tr>
              );
            })}
            {items.length === 0 && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 30 }}>Sin códigos generados.</td></tr>}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}

function Mandantes({ flash }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ nombre_empresa: '', rut: '', email: '' });
  const [tokenNuevo, setTokenNuevo] = useState(null);
  const [creando, setCreando] = useState(false);
  const [gestion, setGestion] = useState(null); // mandante siendo gestionado (webhook + proveedores)
  const [cuentaWeb, setCuentaWeb] = useState(null); // mandante al que se le está creando el acceso web

  const cargar = () => api.mandantes().then((r) => setItems(r.mandantes)).catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);

  async function crear() {
    setCreando(true);
    try {
      const { mandante, token } = await api.crearMandante(form);
      setTokenNuevo({ empresa: mandante.nombre_empresa, token });
      setForm({ nombre_empresa: '', rut: '', email: '' });
      cargar(); flash('Mandante creado.');
    } catch (e) { flash(e.message, true); }
    finally { setCreando(false); }
  }

  async function toggle(m) {
    try { await api.editarMandante(m.id, { activo: !m.activo }); cargar(); }
    catch (e) { flash(e.message, true); }
  }

  return (
    <div className="form-content-grid">
      <div style={{ display: 'grid', gap: 16 }}>
        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Nuevo mandante</h3>
          <div className="field"><label>Empresa</label><input value={form.nombre_empresa} onChange={(e) => setForm({ ...form, nombre_empresa: e.target.value })} /></div>
          <div className="field"><label>RUT</label><input value={form.rut} onChange={(e) => setForm({ ...form, rut: e.target.value })} /></div>
          <div className="field" style={{ marginBottom: 14 }}><label>Email (opcional)</label><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={crear} disabled={creando || !form.nombre_empresa || !form.rut}>
            {creando ? <span className="spinner" /> : 'Crear y generar API key'}
          </button>
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            La API key se muestra <b>una sola vez</b>. El mandante consulta a sus proveedores con el header <code>X-Api-Key</code> (ver README).
          </p>
        </div>
        {tokenNuevo && (
          <div className="card card-pad" style={{ borderColor: 'var(--green)' }}>
            <h3 style={{ marginTop: 0 }}>API key de {tokenNuevo.empresa}</h3>
            <div style={{ fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all', background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>{tokenNuevo.token}</div>
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Cópiala ahora: no volverá a mostrarse.</p>
          </div>
        )}
      </div>

      <div className="card">
        <div className="table-scroll">
        <table className="data">
          <thead><tr><th>Empresa</th><th>RUT</th><th>Último uso</th><th>Estado</th><th>Acceso web</th><th></th></tr></thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.id}>
                <td><b>{m.nombre_empresa}</b>{m.email && <div className="muted" style={{ fontSize: 12 }}>{m.email}</div>}</td>
                <td>{m.rut}</td>
                <td className="muted" style={{ fontSize: 13 }}>{m.ultimo_uso ? fmtFecha(m.ultimo_uso) : 'Nunca'}</td>
                <td><span className={`badge ${m.activo ? 'badge-green' : 'badge-gray'}`}>{m.activo ? 'Activa' : 'Inactiva'}</span></td>
                <td>
                  {m.tiene_cuenta_web
                    ? <span className="badge badge-green">Creada</span>
                    : <button className="btn btn-outline btn-sm" onClick={() => setCuentaWeb(m)}>Crear acceso web</button>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-outline btn-sm" onClick={() => setGestion(m)}>Gestionar</button>{' '}
                  <button className="btn btn-outline btn-sm" onClick={() => toggle(m)}>{m.activo ? 'Desactivar' : 'Activar'}</button>
                </td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 30 }}>Sin mandantes registrados.</td></tr>}
          </tbody>
        </table>
        </div>
      </div>

      {gestion && <GestionMandante mandante={gestion} flash={flash} onClose={() => { setGestion(null); cargar(); }} />}
      {cuentaWeb && (
        <CrearCuentaWeb
          entidad={cuentaWeb} nombreEntidad={cuentaWeb.nombre_empresa}
          crear={api.crearCuentaMandante}
          onCreada={cargar}
          onClose={() => setCuentaWeb(null)}
        />
      )}
    </div>
  );
}


// ---------- Modal: gestión de un mandante (webhook + permisos finos) ----------
function GestionMandante({ mandante, flash, onClose }) {
  const [webhook, setWebhook] = useState(mandante.webhook_url || '');
  const [proveedores, setProveedores] = useState([]);
  const [nuevoRut, setNuevoRut] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = () => api.proveedoresMandante(mandante.id).then((r) => setProveedores(r.proveedores)).catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);

  async function guardarWebhook() {
    setGuardando(true);
    try {
      await api.editarMandante(mandante.id, { webhook_url: webhook });
      flash('Webhook actualizado.');
    } catch (e) { flash(e.message, true); }
    finally { setGuardando(false); }
  }

  async function agregar() {
    try {
      await api.agregarProveedorMandante(mandante.id, nuevoRut);
      setNuevoRut(''); cargar(); flash('Proveedor agregado a la lista.');
    } catch (e) { flash(e.message, true); }
  }

  async function quitar(p) {
    try { await api.quitarProveedorMandante(mandante.id, p.id); cargar(); }
    catch (e) { flash(e.message, true); }
  }

  return (
    <div className="modal-bg" onClick={(e) => e.target.className === 'modal-bg' && onClose()}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <h2 style={{ marginTop: 0 }}>{mandante.nombre_empresa}</h2>

        <h3 style={{ fontSize: 15, marginBottom: 6 }}>Webhook</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Notifica esta URL (POST) cada vez que se procesa una sesión nueva de este mandante.
        </p>
        <div className="field"><input value={webhook} onChange={(e) => setWebhook(e.target.value)} placeholder="https://tu-sistema.cl/hooks/sicr3p" /></div>
        <button className="btn btn-outline btn-sm" onClick={guardarWebhook} disabled={guardando}>
          {guardando ? <span className="spinner" /> : 'Guardar webhook'}
        </button>

        <h3 style={{ fontSize: 15, margin: '20px 0 6px' }}>Proveedores permitidos</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Sin ninguno agregado, el mandante ve a todos los proveedores que le facturaron (comportamiento por defecto).
          Agrega al menos uno para restringir el acceso solo a esos RUT.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input value={nuevoRut} onChange={(e) => setNuevoRut(e.target.value)} placeholder="76.123.456-0" style={{ flex: 1 }} />
          <button className="btn btn-primary btn-sm" onClick={agregar} disabled={!nuevoRut}>Agregar</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {proveedores.map((p) => (
            <span key={p.id} className="badge badge-gray" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {p.rut_proveedor}
              <button onClick={() => quitar(p)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 700 }}>×</button>
            </span>
          ))}
          {proveedores.length === 0 && <span className="muted" style={{ fontSize: 13 }}>Sin restricción (ve todos).</span>}
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="btn btn-outline" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

// ---------- Puertos: acceso completo (tipo mandante) por punto del Corredor ----------
// A diferencia de mandantes (RUT receptor sobre facturas nacionales), un
// puerto se ancla a un punto_id del Corredor (PUNTOS_CORREDOR) y ve el
// tránsito documental que pasa por ese punto — dominio distinto, propio.
function Puertos({ flash }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ nombre: '', punto_id: '' });
  const [tokenNuevo, setTokenNuevo] = useState(null);
  const [creando, setCreando] = useState(false);
  const [cuentaWeb, setCuentaWeb] = useState(null); // puerto al que se le está creando el acceso web

  const cargar = () => api.puertos().then((r) => setItems(r.puertos)).catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);

  async function crear() {
    setCreando(true);
    try {
      const { puerto, token } = await api.crearPuerto(form);
      setTokenNuevo({ nombre: puerto.nombre, token });
      setForm({ nombre: '', punto_id: '' });
      cargar(); flash('Puerto creado.');
    } catch (e) { flash(e.message, true); }
    finally { setCreando(false); }
  }

  async function toggle(p) {
    try { await api.editarPuerto(p.id, { activo: !p.activo }); cargar(); }
    catch (e) { flash(e.message, true); }
  }

  return (
    <div className="form-content-grid">
      <div style={{ display: 'grid', gap: 16 }}>
        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Nuevo puerto</h3>
          <div className="field"><label>Nombre</label><input value={form.nombre} placeholder="Puerto de Antofagasta" onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></div>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Punto del Corredor</label>
            <select value={form.punto_id} onChange={(e) => setForm({ ...form, punto_id: e.target.value })}>
              <option value="">— Selecciona —</option>
              {PUNTOS_CORREDOR.map((p) => (
                <option key={p.id} value={p.id}>{p.nombre} ({p.pais})</option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={crear} disabled={creando || !form.nombre || !form.punto_id}>
            {creando ? <span className="spinner" /> : 'Crear y generar API key'}
          </button>
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            La API key se muestra <b>una sola vez</b>. El puerto consulta el tránsito de su punto con el
            header <code>X-Api-Key</code> contra <code>/api/puerto/transitos</code>.
          </p>
        </div>
        {tokenNuevo && (
          <div className="card card-pad" style={{ borderColor: 'var(--green)' }}>
            <h3 style={{ marginTop: 0 }}>API key de {tokenNuevo.nombre}</h3>
            <div style={{ fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all', background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>{tokenNuevo.token}</div>
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Cópiala ahora: no volverá a mostrarse.</p>
          </div>
        )}
      </div>

      <div className="card">
        <div className="table-scroll">
        <table className="data">
          <thead><tr><th>Nombre</th><th>Punto</th><th>Último uso</th><th>Estado</th><th>Acceso web</th><th></th></tr></thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td><b>{p.nombre}</b></td>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{p.punto_id}</td>
                <td className="muted" style={{ fontSize: 13 }}>{p.ultimo_uso ? fmtFecha(p.ultimo_uso) : 'Nunca'}</td>
                <td><span className={`badge ${p.activo ? 'badge-green' : 'badge-gray'}`}>{p.activo ? 'Activa' : 'Inactiva'}</span></td>
                <td>
                  {p.tiene_cuenta_web
                    ? <span className="badge badge-green">Creada</span>
                    : <button className="btn btn-outline btn-sm" onClick={() => setCuentaWeb(p)}>Crear acceso web</button>}
                </td>
                <td><button className="btn btn-outline btn-sm" onClick={() => toggle(p)}>{p.activo ? 'Desactivar' : 'Activar'}</button></td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 30 }}>Sin puertos registrados.</td></tr>}
          </tbody>
        </table>
        </div>
      </div>
      {cuentaWeb && (
        <CrearCuentaWeb
          entidad={cuentaWeb} nombreEntidad={cuentaWeb.nombre}
          crear={api.crearCuentaPuerto}
          onCreada={cargar}
          onClose={() => setCuentaWeb(null)}
        />
      )}
    </div>
  );
}

// Agencias de aduana (panel /panel-agencia — Pasaporte Bioceánico): la
// agencia sigue realizando la tramitación oficial; sicr3p es su
// infraestructura documental y de trazabilidad — nunca se presenta como
// agencia de aduanas. Mismo patrón que Puertos, sin punto_id (se ancla
// por lotes_minerales.agencia_id, no por punto del Corredor).
function Agencias({ flash }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ nombre: '', rut: '' });
  const [tokenNuevo, setTokenNuevo] = useState(null);
  const [creando, setCreando] = useState(false);
  const [cuentaWeb, setCuentaWeb] = useState(null);

  const cargar = () => api.agencias().then((r) => setItems(r.agencias)).catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);

  async function crear() {
    setCreando(true);
    try {
      const { agencia, token } = await api.crearAgencia(form);
      setTokenNuevo({ nombre: agencia.nombre, token });
      setForm({ nombre: '', rut: '' });
      cargar(); flash('Agencia creada.');
    } catch (e) { flash(e.message, true); }
    finally { setCreando(false); }
  }

  async function toggle(a) {
    try { await api.editarAgencia(a.id, { activo: !a.activo }); cargar(); }
    catch (e) { flash(e.message, true); }
  }

  return (
    <div className="form-content-grid">
      <div style={{ display: 'grid', gap: 16 }}>
        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Nueva agencia de aduana</h3>
          <div className="field"><label>Nombre</label><input value={form.nombre} placeholder="Agencia de Aduanas Ejemplo Ltda." onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></div>
          <div className="field" style={{ marginBottom: 14 }}><label>RUT (opcional)</label><input value={form.rut} placeholder="76.123.456-0" onChange={(e) => setForm({ ...form, rut: e.target.value })} /></div>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={crear} disabled={creando || !form.nombre}>
            {creando ? <span className="spinner" /> : 'Crear y generar API key'}
          </button>
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            La API key se muestra <b>una sola vez</b>. Para el panel web de la agencia usa "Crear acceso web"
            abajo — la pantalla de captura de documentos vive en <code>/panel-agencia</code> (tablet/PC).
          </p>
        </div>
        {tokenNuevo && (
          <div className="card card-pad" style={{ borderColor: 'var(--green)' }}>
            <h3 style={{ marginTop: 0 }}>API key de {tokenNuevo.nombre}</h3>
            <div style={{ fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all', background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>{tokenNuevo.token}</div>
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Cópiala ahora: no volverá a mostrarse.</p>
          </div>
        )}
      </div>

      <div className="card">
        <div className="table-scroll">
        <table className="data">
          <thead><tr><th>Nombre</th><th>RUT</th><th>Último uso</th><th>Estado</th><th>Acceso web</th><th></th></tr></thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id}>
                <td><b>{a.nombre}</b></td>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{a.rut || '—'}</td>
                <td className="muted" style={{ fontSize: 13 }}>{a.ultimo_uso ? fmtFecha(a.ultimo_uso) : 'Nunca'}</td>
                <td><span className={`badge ${a.activo ? 'badge-green' : 'badge-gray'}`}>{a.activo ? 'Activa' : 'Inactiva'}</span></td>
                <td>
                  {a.tiene_cuenta_web
                    ? <span className="badge badge-green">Creada</span>
                    : <button className="btn btn-outline btn-sm" onClick={() => setCuentaWeb(a)}>Crear acceso web</button>}
                </td>
                <td><button className="btn btn-outline btn-sm" onClick={() => toggle(a)}>{a.activo ? 'Desactivar' : 'Activar'}</button></td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 30 }}>Sin agencias registradas.</td></tr>}
          </tbody>
        </table>
        </div>
      </div>
      {cuentaWeb && (
        <CrearCuentaWeb
          entidad={cuentaWeb} nombreEntidad={cuentaWeb.nombre}
          crear={api.crearCuentaAgencia}
          onCreada={cargar}
          onClose={() => setCuentaWeb(null)}
        />
      )}
    </div>
  );
}

// Trazadores: un tercero externo al que se le da una lista blanca de RUT
// específicos. Dos caminos de acceso a los mismos datos (migración 060):
// cuenta web propia (/panel-trazador, email+contraseña) para un operador
// humano, o API key para un socio cuyo propio sistema integra (ej.
// Kontax) — la key es opcional, no todo trazador la necesita.
function Trazadores({ flash }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ nombre: '' });
  const [creando, setCreando] = useState(false);
  const [cuentaWeb, setCuentaWeb] = useState(null);
  const [gestion, setGestion] = useState(null);
  const [tokenNuevo, setTokenNuevo] = useState(null);
  const [generando, setGenerando] = useState('');

  const cargar = () => api.accesosTrazadores().then((r) => setItems(r.trazadores)).catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);

  async function crear() {
    setCreando(true);
    try {
      await api.accesosCrearTrazador(form.nombre);
      setForm({ nombre: '' });
      cargar(); flash('Trazador creado.');
    } catch (e) { flash(e.message, true); }
    finally { setCreando(false); }
  }

  async function toggle(t) {
    try { await api.accesosEditarTrazador(t.id, { activo: !t.activo }); cargar(); }
    catch (e) { flash(e.message, true); }
  }

  async function generarApiKey(t) {
    setGenerando(t.id);
    try {
      const { token } = await api.accesosGenerarApiKeyTrazador(t.id);
      setTokenNuevo({ nombre: t.nombre, token });
      cargar();
    } catch (e) { flash(e.message, true); }
    finally { setGenerando(''); }
  }

  return (
    <div className="form-content-grid">
      <div style={{ display: 'grid', gap: 16 }}>
        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Nuevo trazador</h3>
          <div className="field" style={{ marginBottom: 14 }}><label>Nombre</label><input value={form.nombre} placeholder="Trazador Ejemplo Ltda." onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></div>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={crear} disabled={creando || !form.nombre}>
            {creando ? <span className="spinner" /> : 'Crear'}
          </button>
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            Usa "Crear acceso web" y "Gestionar RUT" para un operador humano, o "Generar API key"
            si el trazador integra su propio sistema (ej. Kontax) — ambos caminos ven los mismos RUT autorizados.
          </p>
        </div>
        {tokenNuevo && (
          <div className="card card-pad" style={{ borderColor: 'var(--green)' }}>
            <h3 style={{ marginTop: 0 }}>API key de {tokenNuevo.nombre}</h3>
            <div style={{ fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all', background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>{tokenNuevo.token}</div>
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Cópiala ahora: no volverá a mostrarse.</p>
          </div>
        )}
      </div>

      <div className="card">
        <div className="table-scroll">
        <table className="data">
          <thead><tr><th>Nombre</th><th>Estado</th><th>Acceso web</th><th>API key</th><th></th></tr></thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.id}>
                <td><b>{t.nombre}</b></td>
                <td><span className={`badge ${t.activo ? 'badge-green' : 'badge-gray'}`}>{t.activo ? 'Activo' : 'Inactivo'}</span></td>
                <td>
                  {t.tiene_cuenta_web
                    ? <span className="badge badge-green">Creada</span>
                    : <button className="btn btn-outline btn-sm" onClick={() => setCuentaWeb(t)}>Crear acceso web</button>}
                </td>
                <td>
                  {t.tiene_api_key
                    ? <span className="badge badge-green">Creada</span>
                    : <button className="btn btn-outline btn-sm" onClick={() => generarApiKey(t)} disabled={generando === t.id}>
                        {generando === t.id ? <span className="spinner" /> : 'Generar API key'}
                      </button>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-outline btn-sm" onClick={() => setGestion(t)}>Gestionar RUT</button>{' '}
                  <button className="btn btn-outline btn-sm" onClick={() => toggle(t)}>{t.activo ? 'Desactivar' : 'Activar'}</button>
                </td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 30 }}>Sin trazadores registrados.</td></tr>}
          </tbody>
        </table>
        </div>
      </div>

      {gestion && <GestionRutsTrazador trazador={gestion} flash={flash} onClose={() => { setGestion(null); cargar(); }} />}
      {cuentaWeb && (
        <CrearCuentaWeb
          entidad={cuentaWeb} nombreEntidad={cuentaWeb.nombre}
          crear={api.accesosCrearCuentaTrazador}
          onCreada={cargar}
          onClose={() => setCuentaWeb(null)}
        />
      )}
    </div>
  );
}

// ---------- Modal: whitelist de RUT de un trazador ----------
function GestionRutsTrazador({ trazador, flash, onClose }) {
  const [ruts, setRuts] = useState([]);
  const [nuevoRut, setNuevoRut] = useState('');
  const [agregando, setAgregando] = useState(false);

  const cargar = () => api.accesosRutsTrazador(trazador.id).then((r) => setRuts(r.ruts)).catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);

  async function agregar() {
    setAgregando(true);
    try {
      await api.accesosAgregarRutTrazador(trazador.id, nuevoRut);
      setNuevoRut(''); cargar(); flash('RUT agregado a la lista.');
    } catch (e) { flash(e.message, true); }
    finally { setAgregando(false); }
  }

  async function quitar(r) {
    try { await api.accesosQuitarRutTrazador(trazador.id, r.id); cargar(); }
    catch (e) { flash(e.message, true); }
  }

  return (
    <div className="modal-bg" onClick={(e) => e.target.className === 'modal-bg' && onClose()}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <h2 style={{ marginTop: 0 }}>{trazador.nombre}</h2>

        <h3 style={{ fontSize: 15, marginBottom: 6 }}>RUT autorizados</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          El trazador solo puede consultar los cruces de los RUT que agregues aquí — cualquier otro RUT le
          será rechazado con acceso denegado.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input value={nuevoRut} onChange={(e) => setNuevoRut(e.target.value)} placeholder="76.123.456-0" style={{ flex: 1 }} />
          <button className="btn btn-primary btn-sm" onClick={agregar} disabled={!nuevoRut || agregando}>
            {agregando ? <span className="spinner" /> : 'Agregar'}
          </button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {ruts.map((r) => (
            <span key={r.id} className="badge badge-gray" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {r.rut}
              <button onClick={() => quitar(r)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 700 }}>×</button>
            </span>
          ))}
          {ruts.length === 0 && <span className="muted" style={{ fontSize: 13 }}>Sin RUT autorizados todavía.</span>}
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="btn btn-outline" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

// Proveedores como entidad persistente (panel /panel-proveedor, login
// FIDO2 propio): el alta acá solo crea la empresa (nombre_empresa + RUT,
// sin API key — no hay integración M2M en esta ronda). Qué lote puede
// firmar cada proveedor se asigna en Pasaporte de Origen (Origen.jsx,
// componente AsignarProveedor), sin tocar la credencial de un solo uso
// (rol='puerto') que sigue vigente para lotes documentales.
function Proveedores({ flash }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ nombre_empresa: '', rut: '' });
  const [creando, setCreando] = useState(false);
  const [cuentaWeb, setCuentaWeb] = useState(null);

  const cargar = () => api.accesosProveedores().then((r) => setItems(r.proveedores)).catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);

  async function crear() {
    setCreando(true);
    try {
      await api.accesosCrearProveedor(form);
      setForm({ nombre_empresa: '', rut: '' });
      cargar(); flash('Proveedor creado.');
    } catch (e) { flash(e.message, true); }
    finally { setCreando(false); }
  }

  async function toggle(p) {
    try { await api.accesosEditarProveedor(p.id, { activo: !p.activo }); cargar(); }
    catch (e) { flash(e.message, true); }
  }

  return (
    <div className="form-content-grid">
      <div style={{ display: 'grid', gap: 16 }}>
        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Nuevo proveedor</h3>
          <div className="field"><label>Empresa</label><input value={form.nombre_empresa} placeholder="Proveedor Ejemplo Ltda." onChange={(e) => setForm({ ...form, nombre_empresa: e.target.value })} /></div>
          <div className="field" style={{ marginBottom: 14 }}><label>RUT</label><input value={form.rut} placeholder="76.123.456-0" onChange={(e) => setForm({ ...form, rut: e.target.value })} /></div>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={crear} disabled={creando || !form.nombre_empresa || !form.rut}>
            {creando ? <span className="spinner" /> : 'Crear proveedor'}
          </button>
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            Con "Crear acceso web" le das a este proveedor una cuenta propia (email + contraseña temporal) para
            entrar a <code>/panel-proveedor</code> y registrar su llave USB — con ella firma, sin contraseña,
            los lotes de producto que le asignes en Pasaporte de Origen.
          </p>
        </div>
      </div>

      <AvisoClavesPendientes items={items} />
      <div className="card">
        <div className="table-scroll">
        <table className="data">
          <thead><tr><th>Empresa</th><th>RUT</th><th>Último uso</th><th>Estado</th><th>Acceso web</th><th>Clave de informes</th><th></th></tr></thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td><b>{p.nombre_empresa}</b>{p.contacto_email && <div className="muted" style={{ fontSize: 12 }}>{p.contacto_email}</div>}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{p.rut}</td>
                <td className="muted" style={{ fontSize: 13 }}>{p.ultimo_uso ? fmtFecha(p.ultimo_uso) : 'Nunca'}</td>
                <td><span className={`badge ${p.activo ? 'badge-green' : 'badge-gray'}`}>{p.activo ? 'Activo' : 'Inactivo'}</span></td>
                <td>
                  {p.tiene_cuenta_web
                    ? <span className="badge badge-green">Creada</span>
                    : <button className="btn btn-outline btn-sm" onClick={() => setCuentaWeb(p)}>Crear acceso web</button>}
                </td>
                {/* Sus comprobantes de transporte salen cifrados con esta
                    clave. Sin entregarla, salen en claro. */}
                <td><ClaveInforme clase="proveedores" item={p} flash={flash} onCambio={cargar} /></td>
                <td><button className="btn btn-outline btn-sm" onClick={() => toggle(p)}>{p.activo ? 'Desactivar' : 'Activar'}</button></td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 30 }}>Sin proveedores registrados.</td></tr>}
          </tbody>
        </table>
        </div>
      </div>
      {cuentaWeb && (
        <CrearCuentaWeb
          entidad={cuentaWeb} nombreEntidad={cuentaWeb.nombre_empresa}
          crear={api.accesosProveedorCrearCuenta}
          onCreada={cargar}
          onClose={() => setCuentaWeb(null)}
        />
      )}
    </div>
  );
}

// Puntos limpios ("Sube y Suma"): lugares de entrega de envases con
// cartel QR imprimible. Con coordenadas, el registro del jugador exige
// cercanía; sin ellas, solo el QR. "Campaña" restringe el punto a los
// jugadores de un código de campaña (vacío = todas).
function PuntosLimpios({ flash }) {
  const [items, setItems] = useState([]);
  const [codigos, setCodigos] = useState([]);
  const [form, setForm] = useState({ nombre: '', direccion: '', lat: '', lng: '', codigo_id: '' });
  const [creando, setCreando] = useState(false);

  const cargar = () => api.accesosPuntosLimpios().then((r) => setItems(r.puntos)).catch((e) => flash(e.message, true));
  useEffect(() => {
    cargar();
    api.codigos().then((r) => setCodigos((r.codigos || []).filter((c) => c.modo_juego))).catch(() => {});
  }, []);

  async function crear() {
    setCreando(true);
    try {
      await api.accesosCrearPuntoLimpio({
        nombre: form.nombre, direccion: form.direccion || null,
        lat: form.lat || null, lng: form.lng || null,
        codigo_id: form.codigo_id || null,
      });
      setForm({ nombre: '', direccion: '', lat: '', lng: '', codigo_id: '' });
      cargar(); flash('Punto limpio creado.');
    } catch (e) { flash(e.message, true); }
    finally { setCreando(false); }
  }

  async function toggle(p) {
    try { await api.accesosEditarPuntoLimpio(p.id, { activo: !p.activo }); cargar(); }
    catch (e) { flash(e.message, true); }
  }

  async function cartel(p) {
    try { await api.accesosCartelPuntoLimpio(p.id, p.nombre); }
    catch (e) { flash(e.message, true); }
  }

  return (
    <div className="form-content-grid">
      <div className="card card-pad">
        <h3 style={{ marginTop: 0 }}>Nuevo punto limpio</h3>
        <div className="field" style={{ marginBottom: 12 }}><label>Nombre</label><input value={form.nombre} placeholder="Punto limpio casino central" onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></div>
        <div className="field" style={{ marginBottom: 12 }}><label>Dirección (opcional)</label><input value={form.direccion} placeholder="Av. Ejemplo 1234, Antofagasta" onChange={(e) => setForm({ ...form, direccion: e.target.value })} /></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div className="field" style={{ minWidth: 0 }}><label>Latitud (opcional)</label><input value={form.lat} placeholder="-23.650000" onChange={(e) => setForm({ ...form, lat: e.target.value })} /></div>
          <div className="field" style={{ minWidth: 0 }}><label>Longitud (opcional)</label><input value={form.lng} placeholder="-70.400000" onChange={(e) => setForm({ ...form, lng: e.target.value })} /></div>
        </div>
        <div className="field" style={{ marginBottom: 14 }}>
          <label>Campaña</label>
          <select value={form.codigo_id} onChange={(e) => setForm({ ...form, codigo_id: e.target.value })}>
            <option value="">Todas las campañas</option>
            {codigos.map((c) => <option key={c.id} value={c.id}>{c.codigo} — {c.empresa || 'sin empresa'}</option>)}
          </select>
        </div>
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={crear} disabled={creando || !form.nombre}>
          {creando ? <span className="spinner" /> : 'Crear'}
        </button>
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          Con coordenadas, el registro exige que el jugador esté cerca del punto. Imprime el
          cartel QR y pégalo en el punto limpio: al escanearlo se abre la pantalla de reciclaje.
        </p>
      </div>

      <div className="card">
        <div className="table-scroll">
        <table className="data">
          <thead><tr><th>Nombre</th><th>Campaña</th><th>Coordenadas</th><th>Entregas</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td><b>{p.nombre}</b>{p.direccion && <div className="muted" style={{ fontSize: 12 }}>{p.direccion}</div>}</td>
                <td className="muted" style={{ fontSize: 13 }}>{p.campana_codigo ? `${p.campana_codigo}${p.campana_empresa ? ` — ${p.campana_empresa}` : ''}` : 'Todas'}</td>
                <td>{p.lat != null ? <span className="badge badge-green">Con cercanía</span> : <span className="badge badge-gray">Solo QR</span>}</td>
                <td>{p.n_entregas}</td>
                <td><span className={`badge ${p.activo ? 'badge-green' : 'badge-gray'}`}>{p.activo ? 'Activo' : 'Inactivo'}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-outline btn-sm" onClick={() => cartel(p)}>Cartel QR</button>{' '}
                  <button className="btn btn-outline btn-sm" onClick={() => toggle(p)}>{p.activo ? 'Desactivar' : 'Activar'}</button>
                </td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 30 }}>Sin puntos limpios registrados.</td></tr>}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
