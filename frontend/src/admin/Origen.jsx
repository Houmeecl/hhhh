import { useEffect, useState } from 'react';
import { api, fmt, fmtInt, fmtFecha } from '../api.js';
import { Icon } from '../components/icons.jsx';
import { validarRut, formatearRut } from '../lib/rut.js';

// ============================================================
// Pasaporte de Origen — back-office de lotes minerales.
// El admin arma la cadena de custodia (mina → … → comprador) eslabón
// por eslabón; cada eslabón queda sellado con hash (append-only) y el
// pasaporte público vive en /lote/:codigo. sicr3p registra y estructura
// declaraciones — no certifica.
// ============================================================

const ROL_LABEL = {
  mina: 'Mina', planta: 'Planta', refineria: 'Refinería', transporte: 'Transporte',
  comerciante: 'Comerciante', exportador: 'Exportador', comprador: 'Comprador',
};
const MATERIAL_LABEL = {
  cobre_catodo: 'Cátodos de cobre', concentrado_cobre: 'Concentrado de cobre',
  litio_carbonato: 'Carbonato de litio', oro: 'Oro', otro: 'Otro mineral',
};
const DECLARACIONES = [
  { codigo: 'oecd_p1', label: 'OECD P1 — Sistema de gestión y política de cadena' },
  { codigo: 'oecd_p2', label: 'OECD P2 — Identificación y evaluación de riesgos (CAHRA)' },
  { codigo: 'oecd_p3', label: 'OECD P3 — Estrategia de respuesta a riesgos' },
  { codigo: 'oecd_p4', label: 'OECD P4 — Auditoría independiente (se registra, no la hace sicr3p)' },
  { codigo: 'oecd_p5', label: 'OECD P5 — Informe público anual' },
  { codigo: 'oecd_a2_conflicto', label: 'Anexo II — Sin apoyo a grupos armados no estatales' },
  { codigo: 'oecd_a2_ddhh', label: 'Anexo II — Sin abusos graves de DD.HH.' },
  { codigo: 'oecd_a2_corrupcion', label: 'Anexo II — Sin soborno ni lavado' },
  { codigo: 'oecd_a2_tributos', label: 'Anexo II — Impuestos y regalías pagados' },
  { codigo: 'dpp_identificador', label: 'DPP — Identificador único y QR' },
  { codigo: 'dpp_composicion', label: 'DPP — Composición declarada' },
  { codigo: 'dpp_actores', label: 'DPP — Actores de la cadena registrados' },
];
const ESTADOS_DECL = ['pendiente', 'declarado', 'con_evidencia', 'no_aplica'];

export default function Origen() {
  const [lotes, setLotes] = useState(null);
  const [sel, setSel] = useState(null);       // detalle del lote seleccionado
  const [msg, setMsg] = useState(null);
  const flash = (texto, error) => { setMsg({ texto, error }); setTimeout(() => setMsg(null), 5000); };

  const cargarLista = () => api.origenLotes().then((r) => setLotes(r.lotes)).catch((e) => flash(e.message, true));
  const abrirLote = (id) => api.origenLote(id).then(setSel).catch((e) => flash(e.message, true));

  useEffect(() => { cargarLista(); }, []);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Pasaporte de Origen</h1>
        <span className="muted" style={{ fontSize: 13 }}>
          Trazabilidad de lotes minerales — cadena de custodia con hash, alineada a OECD / CBAM / DPP.
        </span>
      </div>
      {msg && (
        <div className={`badge ${msg.error ? 'badge-red' : 'badge-green'}`} style={{ margin: '10px 0' }}>{msg.texto}</div>
      )}

      {!sel && <ListaLotes lotes={lotes} flash={flash} onAbrir={abrirLote} onCreado={(id) => { cargarLista(); abrirLote(id); }} />}
      {sel && <DetalleLote data={sel} flash={flash} onVolver={() => { setSel(null); cargarLista(); }} onRefrescar={() => abrirLote(sel.lote.id)} />}
    </div>
  );
}

// ---------- Lista + creación ----------
function ListaLotes({ lotes, flash, onAbrir, onCreado }) {
  const [form, setForm] = useState({ material: 'cobre_catodo', cantidad: '', unidad: 't', pais_origen: 'CL', faena_origen: '', rut_titular: '', codigo_nc: '' });
  const [creando, setCreando] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function crear() {
    const n = Number(form.cantidad);
    if (!n || n <= 0) { flash('Cantidad inválida.', true); return; }
    if (form.rut_titular && !validarRut(form.rut_titular)) { flash('RUT del titular inválido.', true); return; }
    setCreando(true);
    try {
      const { lote } = await api.origenCrearLote({ ...form, cantidad: n });
      flash(`Lote ${lote.codigo} creado.`);
      onCreado(lote.id);
    } catch (e) { flash(e.message, true); }
    finally { setCreando(false); }
  }

  return (
    <>
      <div className="card card-pad" style={{ margin: '14px 0' }}>
        <h3 style={{ marginTop: 0 }}>Nuevo lote mineral</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          <div className="field"><label>Material</label>
            <select value={form.material} onChange={set('material')}>
              {Object.entries(MATERIAL_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="field"><label>Cantidad</label>
            <input inputMode="decimal" value={form.cantidad} placeholder="100" onChange={set('cantidad')} />
          </div>
          <div className="field"><label>Unidad</label>
            <select value={form.unidad} onChange={set('unidad')}><option value="t">t</option><option value="kg">kg</option></select>
          </div>
          <div className="field"><label>País origen (ISO-2)</label>
            <input value={form.pais_origen} maxLength={2} onChange={(e) => setForm((f) => ({ ...f, pais_origen: e.target.value.toUpperCase() }))} />
          </div>
          <div className="field"><label>Faena / instalación</label>
            <input value={form.faena_origen} placeholder="Mina Los Andes" onChange={set('faena_origen')} />
          </div>
          <div className="field"><label>RUT titular (opcional)</label>
            <input value={form.rut_titular} placeholder="76.123.456-0" onChange={set('rut_titular')} />
          </div>
          <div className="field"><label>Código NC UE (opcional)</label>
            <input value={form.codigo_nc} placeholder="740311" onChange={set('codigo_nc')} />
          </div>
        </div>
        <button className="btn btn-primary" onClick={crear} disabled={creando || !form.cantidad}>
          {creando ? <span className="spinner" /> : 'Crear lote'}
        </button>
      </div>

      <div className="card card-pad">
        <h3 style={{ marginTop: 0 }}>Lotes</h3>
        {!lotes ? <div className="skeleton" style={{ height: 60 }} /> : !lotes.length ? (
          <p className="muted">Aún no hay lotes. Crea el primero arriba.</p>
        ) : (
          <div className="table-scroll">
            <table className="data">
              <thead><tr><th>Código</th><th>Material</th><th className="num">Cantidad</th><th>Origen</th><th>Estado</th><th className="num">Eslabones</th><th></th></tr></thead>
              <tbody>
                {lotes.map((l) => (
                  <tr key={l.id}>
                    <td style={{ fontFamily: 'monospace' }}>{l.codigo}</td>
                    <td>{MATERIAL_LABEL[l.material] || l.material}</td>
                    <td className="num">{fmt(l.cantidad, 3)} {l.unidad}</td>
                    <td>{l.pais_origen}{l.faena_origen ? ` · ${l.faena_origen}` : ''}</td>
                    <td><span className={`badge ${l.estado === 'abierto' ? 'badge-green' : 'badge-gray'}`}>{l.estado}</span></td>
                    <td className="num">{fmtInt(l.n_eslabones)}</td>
                    <td><button className="btn btn-sm btn-outline" onClick={() => onAbrir(l.id)}>Abrir</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ---------- Detalle: cadena + declaraciones ----------
function DetalleLote({ data, flash, onVolver, onRefrescar }) {
  const { lote, eslabones, declaraciones, balance, emisiones, normativo, integridad } = data;
  const abierto = lote.estado === 'abierto';
  const [e, setE] = useState({ rol: 'mina', rut_empresa: '', nombre_empresa: '', pais: 'CL', fecha: '', cantidad: '', co2e_aportado: '', visibilidad: 'publico', punto_control: '' });
  const [guardando, setGuardando] = useState(false);
  const setF = (k) => (ev) => setE((f) => ({ ...f, [k]: ev.target.value }));
  const declPor = new Map(declaraciones.map((d) => [d.codigo, d]));

  async function agregar() {
    if (e.pais === 'CL' && !validarRut(e.rut_empresa)) { flash('RUT inválido para actor chileno.', true); return; }
    if (!e.fecha) { flash('Falta la fecha.', true); return; }
    setGuardando(true);
    try {
      const body = {
        rol: e.rol, rut_empresa: e.rut_empresa || null, nombre_empresa: e.nombre_empresa || null,
        pais: e.pais, fecha: e.fecha,
        cantidad: e.cantidad === '' ? null : Number(e.cantidad),
        co2e_aportado: e.co2e_aportado === '' ? 0 : Number(e.co2e_aportado),
        visibilidad: e.visibilidad,
        datos: e.punto_control ? { punto_control: e.punto_control } : {},
      };
      const r = await api.origenAgregarEslabon(lote.id, body);
      (r.advertencias || []).forEach((a) => flash(a, true));
      flash(`Eslabón #${r.eslabon.eslabon} sellado en la cadena.`);
      setE((f) => ({ ...f, rut_empresa: '', nombre_empresa: '', cantidad: '', co2e_aportado: '', punto_control: '' }));
      onRefrescar();
    } catch (err) { flash(err.message, true); }
    finally { setGuardando(false); }
  }

  async function declarar(codigo, estado) {
    try {
      await api.origenDeclarar(lote.id, codigo, { estado });
      onRefrescar();
    } catch (err) { flash(err.message, true); }
  }

  async function cerrar() {
    if (!window.confirm(`¿Cerrar el lote ${lote.codigo}? No se podrán agregar más eslabones y el hash final quedará anclado en la cadena pública global.`)) return;
    try {
      const r = await api.origenCerrar(lote.id);
      flash(r.anclaje
        ? `Lote cerrado y anclado en la cadena global (eslabón #${r.anclaje.eslabon}).`
        : 'Lote cerrado.');
      onRefrescar();
    } catch (err) { flash(err.message, true); }
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0', flexWrap: 'wrap' }}>
        <button className="btn btn-sm btn-outline" onClick={onVolver}>← Volver</button>
        <b style={{ fontFamily: 'monospace' }}>{lote.codigo}</b>
        <span className={`badge ${integridad.valido ? 'badge-green' : 'badge-red'}`}>
          {integridad.valido ? '✓ Cadena íntegra' : '⚠ Cadena alterada'}
        </span>
        <span className={`badge ${lote.estado === 'abierto' ? 'badge-green' : 'badge-gray'}`}>{lote.estado}</span>
        {balance.alerta && <span className="badge badge-amber">⚠ Merma {fmt(balance.merma_pct, 1)}%</span>}
        <a className="btn btn-sm btn-outline" href={`/lote/${lote.codigo}`} target="_blank" rel="noreferrer">Ver pasaporte público ↗</a>
        <a className="btn btn-sm btn-outline" href={api.expedienteLoteUrl(lote.codigo)} target="_blank" rel="noreferrer">Expediente PDF ↗</a>
        {abierto && <button className="btn btn-sm btn-outline" onClick={cerrar}>Cerrar lote</button>}
      </div>

      <Tarjetas lote={lote} abierto={abierto} flash={flash} />

      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <h3 style={{ marginTop: 0 }}>Cadena de custodia ({fmtInt(lote.n_eslabones)} eslabones)</h3>
        {eslabones.length > 0 && (
          <div className="table-scroll" style={{ marginBottom: 12 }}>
            <table className="data">
              <thead><tr><th>#</th><th>Rol</th><th>Empresa</th><th>País</th><th>Fecha</th><th className="num">Cantidad</th><th className="num">t CO2e</th><th>Visibilidad</th><th>DTE</th></tr></thead>
              <tbody>
                {eslabones.map((es) => (
                  <tr key={es.eslabon}>
                    <td>{es.eslabon}</td>
                    <td>{ROL_LABEL[es.rol] || es.rol}</td>
                    <td>{es.nombre_empresa || (es.rut_empresa ? formatearRut(es.rut_empresa) : '—')}</td>
                    <td>{es.pais}</td>
                    <td>{fmtFecha(es.fecha)}</td>
                    <td className="num">{es.cantidad != null ? fmt(es.cantidad, 3) : '—'}</td>
                    <td className="num">{fmt(es.co2e_aportado, 4)}</td>
                    <td><span className="badge badge-gray" style={{ fontSize: 11 }}>{es.visibilidad}</span></td>
                    <td>{es.factura_id ? '✓' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {abierto ? (
          <>
            <h4 style={{ margin: '4px 0 8px' }}>Agregar eslabón</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              <div className="field"><label>Rol</label>
                <select value={e.rol} onChange={setF('rol')}>
                  {Object.entries(ROL_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="field"><label>País (ISO-2)</label>
                <input value={e.pais} maxLength={2} onChange={(ev) => setE((f) => ({ ...f, pais: ev.target.value.toUpperCase() }))} />
              </div>
              <div className="field"><label>RUT empresa{e.pais !== 'CL' ? ' (opcional)' : ''}</label>
                <input value={e.rut_empresa} placeholder="76.123.456-0" onChange={setF('rut_empresa')} />
              </div>
              <div className="field"><label>Nombre empresa</label>
                <input value={e.nombre_empresa} onChange={setF('nombre_empresa')} />
              </div>
              <div className="field"><label>Fecha</label>
                <input type="date" value={e.fecha} onChange={setF('fecha')} />
              </div>
              <div className="field"><label>Cantidad ({lote.unidad}, opcional)</label>
                <input inputMode="decimal" value={e.cantidad} onChange={setF('cantidad')} />
              </div>
              <div className="field"><label>t CO2e aportadas</label>
                <input inputMode="decimal" value={e.co2e_aportado} placeholder="0" onChange={setF('co2e_aportado')} />
              </div>
              <div className="field"><label>Punto de control (opcional)</label>
                <input value={e.punto_control} placeholder="Paso Sico / Puerto Antofagasta" onChange={setF('punto_control')} />
              </div>
              <div className="field"><label>Visibilidad</label>
                <select value={e.visibilidad} onChange={setF('visibilidad')}>
                  <option value="publico">Público</option>
                  <option value="cadena">Solo cadena</option>
                  <option value="privado">Privado</option>
                </select>
              </div>
            </div>
            <button className="btn btn-primary" onClick={agregar} disabled={guardando}>
              {guardando ? <span className="spinner" /> : 'Sellar eslabón'}
            </button>
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              Los eslabones no se editan ni borran (romperían el hash). Un error se corrige agregando un eslabón nuevo.
            </p>
          </>
        ) : (
          <p className="muted">Lote cerrado: la cadena quedó sellada.</p>
        )}
      </div>

      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <h3 style={{ marginTop: 0 }}>Checklist normativo</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          OECD {normativo.oecd.pasos_cubiertos}/{normativo.oecd.pasos_total} pasos ·
          Anexo II {normativo.oecd.anexo2_cubiertas}/{normativo.oecd.anexo2_total} ·
          CBAM {normativo.cbam.listo ? 'datos completos' : `faltan: ${normativo.cbam.faltantes.join(', ')}`}
          {!normativo.cbam.aplicable && ' (material fuera del Anexo I vigente)'} ·
          DPP {normativo.dpp.listo ? 'completo' : `faltan: ${normativo.dpp.faltantes.join(', ')}`}
        </p>
        <div className="table-scroll">
          <table className="data">
            <thead><tr><th>Declaración</th><th>Estado</th></tr></thead>
            <tbody>
              {DECLARACIONES.map((d) => (
                <tr key={d.codigo}>
                  <td>{d.label}</td>
                  <td>
                    <select value={declPor.get(d.codigo)?.estado || 'pendiente'} onChange={(ev) => declarar(d.codigo, ev.target.value)}>
                      {ESTADOS_DECL.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card card-pad">
        <h3 style={{ marginTop: 0 }}>Emisiones incorporadas</h3>
        <p style={{ margin: 0, fontSize: 14 }}>
          Declaradas: <b>{emisiones.declarado_t != null ? `${fmt(emisiones.declarado_t, 4)} t CO2e/t` : 'sin declarar'}</b> ·
          Trazadas: <b>{emisiones.trazado_t != null ? `${fmt(emisiones.trazado_t, 4)} t CO2e/t` : '—'}</b>
          {emisiones.advertencia && <span className="badge badge-amber" style={{ marginLeft: 8 }}>⚠ divergen {fmt(emisiones.divergencia_pct, 1)}%</span>}
        </p>
        <p className="muted" style={{ fontSize: 12 }}>
          Los valores declarados (directas/indirectas por tonelada, método y fuente) se editan vía API PATCH del lote —
          UI de edición en la próxima iteración.
        </p>
      </div>
    </>
  );
}

// ---------- Tarjetas de viaje del lote ----------
// La tarjeta NFC/RFID viaja con la carga: cualquiera que la lea abre el
// pasaporte (/v/SERIAL); el portador, con su clave, registra pasos.
function Tarjetas({ lote, abierto, flash }) {
  const [items, setItems] = useState(null);
  const [portador, setPortador] = useState('');
  const [uid, setUid] = useState('');
  const [emitiendo, setEmitiendo] = useState(false);
  const [nueva, setNueva] = useState(null); // { tarjeta, clave } — clave visible UNA vez

  const cargar = () => api.origenTarjetas(lote.id).then((r) => setItems(r.tarjetas)).catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, [lote.id]);

  async function emitir() {
    setEmitiendo(true);
    try {
      const r = await api.origenEmitirTarjeta(lote.id, { portador: portador || null, uid_fisico: uid || null });
      setNueva(r);
      setPortador('');
      setUid('');
      cargar();
    } catch (e) { flash(e.message, true); }
    finally { setEmitiendo(false); }
  }

  async function toggleActivo(t) {
    try {
      await api.origenEditarTarjeta(t.id, { activo: !t.activo });
      cargar();
    } catch (e) { flash(e.message, true); }
  }

  return (
    <div className="card card-pad" style={{ marginBottom: 14 }}>
      <h3 style={{ marginTop: 0 }}>Tarjetas de viaje (credencial virtual con QR)</h3>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        Sin chip: emite la tarjeta, descarga la <b>credencial PDF con QR</b> y envíasela al transportista
        (WhatsApp o impresa). Quien escanee el QR ve el pasaporte del lote; solo el portador con su clave
        registra pasos. La página <b style={{ fontFamily: 'monospace' }}>/v/SERIAL</b> es la credencial viva
        en el teléfono. Guía: docs/TARJETA-VIAJE.md.
      </p>

      {nueva && (
        <div style={{ padding: '12px 16px', background: 'var(--bg)', borderRadius: 12, marginBottom: 12 }}>
          <b>Tarjeta {nueva.tarjeta.serial} emitida.</b>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            Clave del portador (visible SOLO ahora — entrégala impresa junto con la tarjeta):
            <div style={{ fontFamily: 'monospace', fontSize: 18, marginTop: 4 }}>{nueva.clave}</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Credencial viva: <span style={{ fontFamily: 'monospace' }}>{`${window.location.origin}/v/${nueva.tarjeta.serial}`}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-sm btn-primary" onClick={() => api.abrirCredencialTarjeta(lote.id, nueva.tarjeta.id).catch((e) => flash(e.message, true))}>
              Descargar credencial PDF
            </button>
            <button className="btn btn-sm btn-outline" onClick={() => setNueva(null)}>Entendido, ocultar clave</button>
          </div>
        </div>
      )}

      {abierto && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
          <div className="field" style={{ margin: 0, flex: 1, minWidth: 160 }}>
            <label>Portador (transportista)</label>
            <input value={portador} placeholder="Transportes Andinos Ltda." onChange={(e) => setPortador(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0, flex: 1, minWidth: 160 }}>
            <label>UID físico del chip (opcional)</label>
            <input value={uid} placeholder="04:A3:2B:..." onChange={(e) => setUid(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={emitir} disabled={emitiendo}>
            {emitiendo ? <span className="spinner" /> : 'Emitir tarjeta'}
          </button>
        </div>
      )}

      {!items ? <div className="skeleton" style={{ height: 40 }} /> : !items.length ? (
        <p className="muted" style={{ fontSize: 13 }}>Sin tarjetas emitidas para este lote.</p>
      ) : (
        <div className="table-scroll">
          <table className="data">
            <thead><tr><th>Serial</th><th>Portador</th><th className="num">Pasos</th><th>Última actividad</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id}>
                  <td style={{ fontFamily: 'monospace' }}>{t.serial}</td>
                  <td>{t.portador || '—'}</td>
                  <td className="num">{fmtInt(t.pasos_registrados)}</td>
                  <td>{t.ultima_actividad ? fmtFecha(t.ultima_actividad) : '—'}</td>
                  <td><span className={`badge ${t.activo ? 'badge-green' : 'badge-gray'}`}>{t.activo ? 'activa' : 'inactiva'}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm btn-outline" style={{ marginRight: 6 }}
                      onClick={() => api.abrirCredencialTarjeta(lote.id, t.id).catch((e) => flash(e.message, true))}>
                      Credencial
                    </button>
                    <button className="btn btn-sm btn-outline" onClick={() => toggleActivo(t)}>{t.activo ? 'Desactivar' : 'Reactivar'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
