import { useEffect, useState } from 'react';
import { api, fmt, fmtInt, fmtFecha } from '../api.js';
import { Icon } from '../components/icons.jsx';
import { validarRut, formatearRut } from '../lib/rut.js';
import { PUNTOS_CORREDOR } from '../lib/corredor.js';
import Dropzone from '../components/Dropzone.jsx';

// ============================================================
// Pasaporte de Origen — back-office de lotes minerales.
// El admin arma la cadena de custodia (mina → … → comprador) eslabón
// por eslabón; cada eslabón queda sellado con hash (append-only) y el
// pasaporte público vive en /lote/:codigo. sicr3p registra y estructura
// declaraciones — no certifica.
// ============================================================

const TIPO_LABEL = {
  mineral: 'Mineral (minería)',
  producto: 'Producto (ciudad / mostrador sicr3p)',
  documental: 'Documental (Corredor Bioceánico)',
};
const ROL_LABEL = {
  mina: 'Mina', planta: 'Planta', refineria: 'Refinería', transporte: 'Transporte',
  comerciante: 'Comerciante', exportador: 'Exportador', comprador: 'Comprador',
  productor: 'Productor', proveedor: 'Proveedor', comercio: 'Comercio',
  punto_aduana_verde: 'Punto sicr3p',
  origen: 'Origen', deposito: 'Depósito', frontera: 'Frontera', puerto: 'Puerto', destino: 'Destino',
};
const MATERIAL_LABEL = {
  cobre_catodo: 'Cátodos de cobre', concentrado_cobre: 'Concentrado de cobre',
  litio_carbonato: 'Carbonato de litio', oro: 'Oro', otro: 'Otro',
  alimentos: 'Alimentos', bebidas: 'Bebidas', textil: 'Textil', embalajes: 'Embalajes',
  manufactura: 'Manufactura', quimicos: 'Químicos',
  carga_general: 'Carga general', carga_refrigerada: 'Carga refrigerada',
  granel: 'Granel', contenedor: 'Contenedor', documentos: 'Documentos',
};
// Catálogos por tipo (espejo del servicio backend; el servidor valida igual).
const MATERIALES_POR_TIPO = {
  mineral: ['cobre_catodo', 'concentrado_cobre', 'litio_carbonato', 'oro', 'otro'],
  producto: ['alimentos', 'bebidas', 'textil', 'embalajes', 'manufactura', 'quimicos', 'otro'],
  documental: ['carga_general', 'carga_refrigerada', 'granel', 'contenedor', 'documentos'],
};
const ROLES_POR_TIPO = {
  mineral: ['mina', 'planta', 'refineria', 'transporte', 'comerciante', 'exportador', 'comprador'],
  producto: ['productor', 'proveedor', 'transporte', 'comercio', 'punto_aduana_verde', 'comprador'],
  documental: ['origen', 'transporte', 'deposito', 'frontera', 'puerto', 'destino'],
};
// Rol de "autoservicio" (credencial de firma/atestación) por tipo de
// lote — hoy uno solo por tipo: el proveedor en lotes de producto, el
// puerto en lotes documentales del Corredor. `transporte` ya tiene su
// propio mecanismo (Tarjeta de Viaje, componente Tarjetas más abajo).
const ROL_CREDENCIAL_POR_TIPO = { producto: 'proveedor', documental: 'puerto' };
const ROL_CREDENCIAL_LABELS = {
  proveedor: { titulo: 'proveedor', empresa: 'Nombre de la empresa', placeholderEmpresa: 'Proveedor Demo SpA', rutLabel: 'RUT del proveedor' },
  puerto: { titulo: 'puerto', empresa: 'Autoridad portuaria', placeholderEmpresa: 'Puerto de Antofagasta', rutLabel: 'RUT de la autoridad portuaria' },
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

// Documentos del expediente — Carga Bioceánica (migración 043).
const TIPO_DOCUMENTO_LABEL = {
  factura: 'Factura comercial', packing_list: 'Packing list', carta_porte: 'Carta de porte',
  mic_dta: 'MIC/DTA', cert_origen: 'Certificado de origen', sag: 'Documento SAG',
  seguro: 'Seguro', pesaje: 'Comprobante de pesaje', foto: 'Fotografía',
  comprobante_frontera: 'Comprobante fronterizo', otro: 'Otro',
};
const TIPOS_DOCUMENTO_CARGA = Object.keys(TIPO_DOCUMENTO_LABEL);
const ESTADO_DOCUMENTO_LABEL = { leido: 'Leído', pendiente_revision: 'En revisión', sin_texto: 'Sin señal', rechazado: 'Rechazado' };
const SEMAFORO_LABEL = { verde: 'Completo', amarillo: 'Parcial', rojo: 'Sin documentos', gris: 'Sin criterio' };
const SEMAFORO_BADGE = { verde: 'badge-green', amarillo: 'badge-amber', rojo: 'badge-red', gris: 'badge-gray' };

export default function Origen() {
  const [lotes, setLotes] = useState(null);
  const [sel, setSel] = useState(null);       // detalle del lote seleccionado
  const [revision, setRevision] = useState(false); // cola de revisión de documentos (transversal a lotes)
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
        {!sel && (
          <button className="btn btn-sm btn-outline" style={{ marginLeft: 'auto' }} onClick={() => setRevision((v) => !v)}>
            {revision ? '← Volver a lotes' : 'Revisión de documentos'}
          </button>
        )}
      </div>
      {msg && (
        <div className={`badge ${msg.error ? 'badge-red' : 'badge-green'}`} style={{ margin: '10px 0' }}>{msg.texto}</div>
      )}

      {revision && !sel && <RevisionDocumentos flash={flash} />}
      {!revision && !sel && <ListaLotes lotes={lotes} flash={flash} onAbrir={abrirLote} onCreado={(id) => { cargarLista(); abrirLote(id); }} />}
      {sel && <DetalleLote data={sel} flash={flash} onVolver={() => { setSel(null); cargarLista(); }} onRefrescar={() => abrirLote(sel.lote.id)} />}
    </div>
  );
}

// ---------- Cola de revisión de documentos — SOLO Carga Bioceánica ----------
// Único humano-en-el-medio del proyecto: acotado a lote_documentos
// (el autoservicio público /cargar sigue siendo 422-solo, sin cambios).
function RevisionDocumentos({ flash }) {
  const [items, setItems] = useState(null);
  const [resolviendo, setResolviendo] = useState(null); // id en curso

  const cargar = () => api.origenRevisionDocumentos().then((r) => setItems(r.pendientes)).catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, []);

  async function resolver(id, accion) {
    if (accion === 'rechazar' && !window.confirm('¿Rechazar este documento? Se borra su binario y queda registrado como rechazo.')) return;
    setResolviendo(id);
    try {
      await api.origenResolverRevision(id, { accion });
      flash(accion === 'aprobar' ? 'Documento aprobado y sellado en la cadena.' : 'Documento rechazado.');
      cargar();
    } catch (e) { flash(e.message, true); }
    finally { setResolviendo(null); }
  }

  return (
    <div className="card card-pad" style={{ marginTop: 14 }}>
      <h3 style={{ marginTop: 0 }}>Documentos pendientes de revisión</h3>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        Documentos del expediente que no pasaron el umbral de legibilidad automática — el binario se guarda
        SOLO mientras está aquí. Apruébalo (entra a la cadena de hash) o recházalo (se borra el binario, queda
        el registro sin el archivo, mismo patrón que el autoservicio público).
      </p>
      {!items ? <div className="skeleton" style={{ height: 60 }} /> : !items.length ? (
        <p className="muted">Sin documentos pendientes.</p>
      ) : (
        <div className="table-scroll">
          <table className="data">
            <thead><tr><th>Lote</th><th>Tipo</th><th>Archivo</th><th>Etapa</th><th>Fecha</th><th></th></tr></thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id}>
                  <td style={{ fontFamily: 'monospace' }}>{d.lote_codigo}</td>
                  <td>{TIPO_DOCUMENTO_LABEL[d.tipo_documento] || d.tipo_documento}</td>
                  <td>{d.archivo_original}</td>
                  <td className="muted">{d.etapa_lectura || '—'}</td>
                  <td>{fmtFecha(d.created_at)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm btn-primary" style={{ marginRight: 6 }}
                      disabled={resolviendo === d.id} onClick={() => resolver(d.id, 'aprobar')}>
                      Aprobar
                    </button>
                    <button className="btn btn-sm btn-outline" disabled={resolviendo === d.id} onClick={() => resolver(d.id, 'rechazar')}>
                      Rechazar
                    </button>
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

// ---------- Lista + creación ----------
function ListaLotes({ lotes, flash, onAbrir, onCreado }) {
  const [form, setForm] = useState({ tipo: 'producto', material: 'alimentos', cantidad: '', unidad: 't', pais_origen: 'CL', faena_origen: '', rut_titular: '', codigo_nc: '' });
  const [creando, setCreando] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const cambiarTipo = (e) => {
    const tipo = e.target.value;
    setForm((f) => ({ ...f, tipo, material: MATERIALES_POR_TIPO[tipo][0] }));
  };

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
        <h3 style={{ marginTop: 0 }}>Nuevo lote</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          <div className="field"><label>Tipo de pasaporte</label>
            <select value={form.tipo} onChange={cambiarTipo}>
              {Object.entries(TIPO_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="field"><label>{form.tipo === 'documental' ? 'Tipo de carga' : 'Material / rubro'}</label>
            <select value={form.material} onChange={set('material')}>
              {MATERIALES_POR_TIPO[form.tipo].map((v) => <option key={v} value={v}>{MATERIAL_LABEL[v] || v}</option>)}
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
              <thead><tr><th>Código</th><th>Tipo</th><th>Material</th><th className="num">Cantidad</th><th>Origen</th><th>Estado</th><th className="num">Eslabones</th><th></th></tr></thead>
              <tbody>
                {lotes.map((l) => (
                  <tr key={l.id}>
                    <td style={{ fontFamily: 'monospace' }}>{l.codigo}</td>
                    <td><span className="badge badge-gray" style={{ fontSize: 11 }}>{l.tipo || 'mineral'}</span></td>
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

      <DemoTorre flash={flash} />
    </>
  );
}

// ---------- Demo torre de control (mapa + camión + mensajes) ----------
// Un clic arma la demo completa: lote documental del Corredor con su
// eslabón de origen, la credencial del camión (tarjeta de viaje) y la
// credencial del operador de torre (terminal rol pos). Las claves se
// muestran UNA sola vez. Guion completo: docs/TORRE-DE-CONTROL.md.
function DemoTorre({ flash }) {
  const [demo, setDemo] = useState(null);
  const [creando, setCreando] = useState(false);

  async function crear() {
    setCreando(true);
    try {
      const r = await api.origenDemoTorre();
      setDemo(r);
      flash(`Demo lista: lote ${r.lote.codigo}.`);
    } catch (e) { flash(e.message, true); }
    finally { setCreando(false); }
  }

  return (
    <div className="card card-pad" style={{ marginTop: 14 }}>
      <h3 style={{ marginTop: 0 }}>🗼 Demo torre de control</h3>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Crea en un clic la demo del Corredor: <strong>3 camiones</strong> — dos ya EN MOVIMIENTO en puntos
        distintos y un tercero que aparece en el mapa recién cuando su chofer activa la tarjeta con el
        primer paso — más la credencial de torre que los comanda a todos. La flota completa se ve en
        <span className="mono"> /torre</span> y cada camión tiene su torre propia en <span className="mono">/torre/LM-…</span>.
        La torre envía "puerto", "puerto seco" o <strong>designa zona de estacionamiento</strong> al chofer.
      </p>
      {!demo && (
        <button className="btn btn-primary" onClick={crear} disabled={creando}>
          {creando ? <span className="spinner" /> : 'Crear demo'}
        </button>
      )}
      {demo && (
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="badge badge-red" style={{ justifySelf: 'start' }}>
            Estas claves se muestran UNA sola vez — anótalas ahora.
          </div>
          <div className="table-scroll">
            <table className="data">
              <thead><tr><th>Rol</th><th>Dónde entra</th><th>Credencial</th><th>Clave</th></tr></thead>
              <tbody>
                {demo.camiones.map((c, i) => (
                  <tr key={c.tarjeta.serial}>
                    <td><strong>{c.tarjeta.portador || `Camión ${i + 1}`}</strong>{' '}
                      <span className="muted" style={{ fontSize: 11 }}>
                        ({c.lote.en_movimiento ? 'en movimiento' : 'aparece al activar'})
                      </span></td>
                    <td><a href={c.urls.credencial} target="_blank" rel="noreferrer" className="mono">{c.urls.credencial}</a></td>
                    <td className="mono">{c.tarjeta.serial}</td>
                    <td className="mono">{c.tarjeta.clave}</td>
                  </tr>
                ))}
                <tr>
                  <td><strong>Torre</strong> (operador de todos)</td>
                  <td><a href="/torre" target="_blank" rel="noreferrer" className="mono">/torre</a></td>
                  <td className="mono">{demo.torre.serial}</td>
                  <td className="mono">{demo.torre.clave}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            Proyecta <a href="/torre" target="_blank" rel="noreferrer">la flota</a> en pantalla grande (entra con la
            credencial de torre): verás dos camiones ya en ruta. Abre la credencial del camión 3 en un teléfono,
            registra su primer paso… y aparece en el mapa (~5 s). Desde la torre de cada lote puedes enviarle
            "puerto", "puerto seco" o una zona de estacionamiento. Guion completo:
            <span className="mono"> docs/TORRE-DE-CONTROL.md</span>.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------- Detalle: cadena + declaraciones ----------
function DetalleLote({ data, flash, onVolver, onRefrescar }) {
  const { lote, eslabones, declaraciones, documentos, semaforo, balance, emisiones, normativo, integridad } = data;
  const abierto = lote.estado === 'abierto';
  const rolesDelTipo = ROLES_POR_TIPO[lote.tipo || 'mineral'] || ROLES_POR_TIPO.mineral;
  const [e, setE] = useState({ rol: rolesDelTipo[0], rut_empresa: '', nombre_empresa: '', pais: 'CL', fecha: '', cantidad: '', co2e_aportado: '', visibilidad: 'publico', punto_control: '' });
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
        <span className="badge badge-gray">{TIPO_LABEL[lote.tipo || 'mineral']}</span>
        <span className={`badge ${integridad.valido ? 'badge-green' : 'badge-red'}`}>
          {integridad.valido ? '✓ Cadena íntegra' : '⚠ Cadena alterada'}
        </span>
        <span className={`badge ${lote.estado === 'abierto' ? 'badge-green' : 'badge-gray'}`}>{lote.estado}</span>
        {balance.alerta && <span className="badge badge-amber">⚠ Merma {fmt(balance.merma_pct, 1)}%</span>}
        {lote.tipo === 'documental' && semaforo && (
          <span className={`badge ${SEMAFORO_BADGE[semaforo.color] || 'badge-gray'}`}>
            📄 Documentos: {SEMAFORO_LABEL[semaforo.color] || semaforo.color}
          </span>
        )}
        <a className="btn btn-sm btn-outline" href={`/lote/${lote.codigo}`} target="_blank" rel="noreferrer">Ver pasaporte público ↗</a>
        <a className="btn btn-sm btn-outline" href={api.expedienteLoteUrl(lote.codigo)} target="_blank" rel="noreferrer">Expediente PDF ↗</a>
        {abierto && <button className="btn btn-sm btn-outline" onClick={cerrar}>Cerrar lote</button>}
      </div>

      <Tarjetas lote={lote} abierto={abierto} flash={flash} />
      {ROL_CREDENCIAL_POR_TIPO[lote.tipo] && (
        <CredencialesProveedor lote={lote} rol={ROL_CREDENCIAL_POR_TIPO[lote.tipo]} abierto={abierto} flash={flash} />
      )}
      {lote.tipo === 'documental' && (
        <>
          <AgenciaAsignada lote={lote} abierto={abierto} flash={flash} onRefrescar={onRefrescar} />
          <Documentos lote={lote} abierto={abierto} documentos={documentos} semaforo={semaforo} flash={flash} onRefrescar={onRefrescar} />
        </>
      )}

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
                  {rolesDelTipo.map((v) => <option key={v} value={v}>{ROL_LABEL[v] || v}</option>)}
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
          {normativo.oecd && (
            <>OECD {normativo.oecd.pasos_cubiertos}/{normativo.oecd.pasos_total} pasos ·{' '}
            Anexo II {normativo.oecd.anexo2_cubiertas}/{normativo.oecd.anexo2_total} ·{' '}</>
          )}
          CBAM {normativo.cbam.listo ? 'datos completos' : `faltan: ${normativo.cbam.faltantes.join(', ')}`}
          {!normativo.cbam.aplicable && ' (material fuera del Anexo I vigente)'} ·
          DPP {normativo.dpp.listo ? 'completo' : `faltan: ${normativo.dpp.faltantes.join(', ')}`}
        </p>
        <div className="table-scroll">
          <table className="data">
            <thead><tr><th>Declaración</th><th>Estado</th></tr></thead>
            <tbody>
              {(normativo.oecd ? DECLARACIONES : DECLARACIONES.filter((d) => d.codigo.startsWith('dpp_'))).map((d) => (
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
  const [placaTracto, setPlacaTracto] = useState('');
  const [placaSemi, setPlacaSemi] = useState('');
  const [conductorNombre, setConductorNombre] = useState('');
  const [conductorDoc, setConductorDoc] = useState('');
  const [emitiendo, setEmitiendo] = useState(false);
  const [nueva, setNueva] = useState(null); // { tarjeta, clave } — clave visible UNA vez

  const cargar = () => api.origenTarjetas(lote.id).then((r) => setItems(r.tarjetas)).catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, [lote.id]);

  async function emitir() {
    setEmitiendo(true);
    try {
      const r = await api.origenEmitirTarjeta(lote.id, {
        portador: portador || null, uid_fisico: uid || null,
        placa_tracto: placaTracto || null, placa_semirremolque: placaSemi || null,
        conductor_nombre: conductorNombre || null, conductor_documento: conductorDoc || null,
      });
      (r.advertencias || []).forEach((a) => flash(a, true));
      setNueva(r);
      setPortador(''); setUid(''); setPlacaTracto(''); setPlacaSemi(''); setConductorNombre(''); setConductorDoc('');
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="field" style={{ margin: 0, flex: 1, minWidth: 160 }}>
              <label>Portador (transportista)</label>
              <input value={portador} placeholder="Transportes Andinos Ltda." onChange={(e) => setPortador(e.target.value)} />
            </div>
            <div className="field" style={{ margin: 0, flex: 1, minWidth: 160 }}>
              <label>UID físico del chip (opcional)</label>
              <input value={uid} placeholder="04:A3:2B:..." onChange={(e) => setUid(e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="field" style={{ margin: 0, flex: 1, minWidth: 140 }}>
              <label>Placa tracto (opcional)</label>
              <input value={placaTracto} placeholder="BRA2E19" onChange={(e) => setPlacaTracto(e.target.value)} />
            </div>
            <div className="field" style={{ margin: 0, flex: 1, minWidth: 140 }}>
              <label>Placa semirremolque (opcional)</label>
              <input value={placaSemi} placeholder="XY123AB" onChange={(e) => setPlacaSemi(e.target.value)} />
            </div>
            <div className="field" style={{ margin: 0, flex: 1, minWidth: 160 }}>
              <label>Conductor (opcional)</label>
              <input value={conductorNombre} placeholder="Juan Pérez" onChange={(e) => setConductorNombre(e.target.value)} />
            </div>
            <div className="field" style={{ margin: 0, flex: 1, minWidth: 140 }}>
              <label>Documento conductor (opcional)</label>
              <input value={conductorDoc} placeholder="12.345.678-9" onChange={(e) => setConductorDoc(e.target.value)} />
            </div>
            <button className="btn btn-primary" onClick={emitir} disabled={emitiendo}>
              {emitiendo ? <span className="spinner" /> : 'Emitir tarjeta'}
            </button>
          </div>
          <p className="muted" style={{ fontSize: 11, margin: 0 }}>
            Placa y conductor son opcionales y su formato no se valida estrictamente — varían mucho entre
            Brasil, Paraguay, Argentina y Chile.
          </p>
        </div>
      )}

      {!items ? <div className="skeleton" style={{ height: 40 }} /> : !items.length ? (
        <p className="muted" style={{ fontSize: 13 }}>Sin tarjetas emitidas para este lote.</p>
      ) : (
        <div className="table-scroll">
          <table className="data">
            <thead><tr><th>Serial</th><th>Portador</th><th>Vehículo</th><th>Conductor</th><th className="num">Pasos</th><th>Última actividad</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id}>
                  <td style={{ fontFamily: 'monospace' }}>{t.serial}</td>
                  <td>{t.portador || '—'}</td>
                  <td>{[t.placa_tracto, t.placa_semirremolque].filter(Boolean).join(' / ') || '—'}</td>
                  <td>{t.conductor_nombre || '—'}</td>
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

// ---------- Agencia de aduana asignada al expediente ----------
// Sin agencia asignada, el expediente nunca aparece en /panel-agencia
// (routes/agencia.js filtra por agencia_id). La agencia sigue realizando
// la tramitación oficial; sicr3p es su infraestructura documental.
function AgenciaAsignada({ lote, abierto, flash, onRefrescar }) {
  const [agencias, setAgencias] = useState(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => { api.agencias().then((r) => setAgencias(r.agencias)).catch((e) => flash(e.message, true)); }, []);

  async function asignar(e) {
    const agenciaId = e.target.value;
    setGuardando(true);
    try {
      await api.origenEditarLote(lote.id, { agencia_id: agenciaId });
      flash(agenciaId ? 'Agencia asignada.' : 'Agencia desasignada.');
      onRefrescar();
    } catch (err) { flash(err.message, true); }
    finally { setGuardando(false); }
  }

  return (
    <div className="card card-pad" style={{ marginBottom: 14 }}>
      <h3 style={{ marginTop: 0 }}>Agencia de aduana</h3>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        La agencia sigue realizando la tramitación oficial; sicr3p es su infraestructura documental y de
        trazabilidad. Solo la agencia asignada ve este expediente en <span className="mono">/panel-agencia</span>.
      </p>
      {!agencias ? <div className="skeleton" style={{ height: 30 }} /> : (
        <div className="field" style={{ maxWidth: 320, marginBottom: 0 }}>
          <select value={lote.agencia_id || ''} onChange={asignar} disabled={!abierto || guardando}>
            <option value="">— Sin asignar —</option>
            {agencias.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

// ---------- Documentos del expediente — Carga Bioceánica (migración 043) ----------
function Documentos({ lote, abierto, documentos, semaforo, flash, onRefrescar }) {
  const [tipoDocumento, setTipoDocumento] = useState(TIPOS_DOCUMENTO_CARGA[0]);
  const [subiendo, setSubiendo] = useState(false);

  async function subir(files) {
    if (!files?.length) return;
    setSubiendo(true);
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append('archivo', file);
        fd.append('tipo_documento', tipoDocumento);
        const r = await api.origenSubirDocumento(lote.id, fd);
        flash(r.documento.estado === 'pendiente_revision'
          ? `${file.name}: sin señal suficiente — queda en revisión.`
          : `${file.name}: sellado en la cadena de documentos.`);
      }
      onRefrescar();
    } catch (e) { flash(e.message, true); }
    finally { setSubiendo(false); }
  }

  return (
    <div className="card card-pad" style={{ marginBottom: 14 }}>
      <h3 style={{ marginTop: 0 }}>Documentos del expediente</h3>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        Factura, packing list, carta de porte, MIC/DTA, certificado de origen, documentos SAG, seguro,
        pesaje, fotografías y comprobantes fronterizos. Cada documento entra a su propia cadena de hash
        (aislada de la cadena de custodia). Lo que no se lee automáticamente queda en la cola de revisión.
      </p>

      {semaforo && (
        <div style={{ marginBottom: 12 }}>
          <span className={`badge ${SEMAFORO_BADGE[semaforo.color] || 'badge-gray'}`}>
            {SEMAFORO_LABEL[semaforo.color] || semaforo.color}
          </span>
          {semaforo.faltantes.length > 0 && (
            <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
              Faltan: {semaforo.faltantes.map((t) => TIPO_DOCUMENTO_LABEL[t] || t).join(', ')}
            </span>
          )}
        </div>
      )}

      {abierto && (
        <div style={{ marginBottom: 12 }}>
          <div className="field" style={{ maxWidth: 280, marginBottom: 10 }}>
            <label>Tipo de documento a subir</label>
            <select value={tipoDocumento} onChange={(e) => setTipoDocumento(e.target.value)}>
              {TIPOS_DOCUMENTO_CARGA.map((v) => <option key={v} value={v}>{TIPO_DOCUMENTO_LABEL[v]}</option>)}
            </select>
          </div>
          {subiendo ? (
            <div style={{ padding: 20, textAlign: 'center' }}><span className="spinner dark" /> Subiendo…</div>
          ) : (
            <Dropzone onFiles={subir} />
          )}
        </div>
      )}

      {!documentos?.length ? (
        <p className="muted" style={{ fontSize: 13 }}>Sin documentos cargados todavía.</p>
      ) : (
        <div className="table-scroll">
          <table className="data">
            <thead><tr><th>Tipo</th><th>Archivo</th><th>Estado</th><th>Fecha</th></tr></thead>
            <tbody>
              {documentos.map((d) => (
                <tr key={d.id}>
                  <td>{TIPO_DOCUMENTO_LABEL[d.tipo_documento] || d.tipo_documento}</td>
                  <td>{d.archivo_original}</td>
                  <td>
                    <span className={`badge ${d.estado === 'leido' ? 'badge-green' : d.estado === 'pendiente_revision' ? 'badge-amber' : 'badge-gray'}`}>
                      {ESTADO_DOCUMENTO_LABEL[d.estado] || d.estado}
                    </span>
                  </td>
                  <td>{fmtFecha(d.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Credencial de Firma del Proveedor: atestación con credencial propia
// (serial+clave) para el eslabón 'proveedor' — NO es firma electrónica con
// validez legal (Ley N° 19.799). Identidad (RUT+empresa) fijada por el
// admin al emitir; un solo uso.
function CredencialesProveedor({ lote, rol, abierto, flash }) {
  const labels = ROL_CREDENCIAL_LABELS[rol] || ROL_CREDENCIAL_LABELS.proveedor;
  const [items, setItems] = useState(null);
  const [rut, setRut] = useState('');
  const [nombreEmpresa, setNombreEmpresa] = useState('');
  const [puntoId, setPuntoId] = useState(rol === 'puerto' ? PUNTOS_CORREDOR[0]?.id || '' : '');
  const [emitiendo, setEmitiendo] = useState(false);
  const [nueva, setNueva] = useState(null); // { credencial, clave } — clave visible UNA vez

  const cargar = () =>
    api.origenCredencialesProveedor(lote.id).then((r) => setItems(r.credenciales)).catch((e) => flash(e.message, true));
  useEffect(() => { cargar(); }, [lote.id]);

  async function emitir() {
    if (!validarRut(rut)) { flash('RUT inválido.', true); return; }
    if (!nombreEmpresa.trim()) { flash(`Falta el nombre de la/el ${labels.titulo}.`, true); return; }
    if (rol === 'puerto' && !puntoId) { flash('Falta el punto del Corredor.', true); return; }
    setEmitiendo(true);
    try {
      const r = await api.origenEmitirCredencialProveedor(lote.id, {
        rol, rut_empresa: formatearRut(rut), nombre_empresa: nombreEmpresa.trim(),
        ...(rol === 'puerto' ? { punto_id: puntoId } : {}),
      });
      setNueva(r);
      setRut('');
      setNombreEmpresa('');
      cargar();
    } catch (e) { flash(e.message, true); }
    finally { setEmitiendo(false); }
  }

  async function toggleActivo(c) {
    try {
      await api.origenEditarCredencialProveedor(c.id, { activo: !c.activo });
      cargar();
    } catch (e) { flash(e.message, true); }
  }

  return (
    <div className="card card-pad" style={{ marginBottom: 14 }}>
      <h3 style={{ marginTop: 0 }}>Credencial de firma del {labels.titulo} (atestación)</h3>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        Emite la credencial, descarga el <b>PDF con QR</b> y envíasela al {labels.titulo} con la clave. Con ella
        confirma (una sola vez) su eslabón en la cadena de custodia. <b>Esto NO es una firma electrónica con
        validez legal (Ley N° 19.799)</b> — es una atestación sellada por hash, con la identidad fijada aquí,
        no la que declare quien firma.
      </p>

      {nueva && (
        <div style={{ padding: '12px 16px', background: 'var(--bg)', borderRadius: 12, marginBottom: 12 }}>
          <b>Credencial {nueva.credencial.serial} emitida.</b>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            Clave del {labels.titulo} (visible SOLO ahora — entrégala junto con la credencial):
            <div style={{ fontFamily: 'monospace', fontSize: 18, marginTop: 4 }}>{nueva.clave}</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Página de firma: <span style={{ fontFamily: 'monospace' }}>{`${window.location.origin}/f/${nueva.credencial.serial}`}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-sm btn-primary" onClick={() => api.abrirCredencialProveedor(lote.id, nueva.credencial.id).catch((e) => flash(e.message, true))}>
              Descargar credencial PDF
            </button>
            <button className="btn btn-sm btn-outline" onClick={() => setNueva(null)}>Entendido, ocultar clave</button>
          </div>
        </div>
      )}

      {abierto && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
          <div className="field" style={{ margin: 0, flex: 1, minWidth: 160 }}>
            <label>{labels.rutLabel}</label>
            <input value={rut} placeholder="76.123.456-0" onChange={(e) => setRut(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0, flex: 1, minWidth: 160 }}>
            <label>{labels.empresa}</label>
            <input value={nombreEmpresa} placeholder={labels.placeholderEmpresa} onChange={(e) => setNombreEmpresa(e.target.value)} />
          </div>
          {rol === 'puerto' && (
            <div className="field" style={{ margin: 0, flex: 1, minWidth: 200 }}>
              <label>Punto del Corredor</label>
              <select value={puntoId} onChange={(e) => setPuntoId(e.target.value)}>
                {PUNTOS_CORREDOR.map((p) => (
                  <option key={p.id} value={p.id}>{p.nombre}</option>
                ))}
              </select>
            </div>
          )}
          <button className="btn btn-primary" onClick={emitir} disabled={emitiendo}>
            {emitiendo ? <span className="spinner" /> : 'Emitir credencial'}
          </button>
        </div>
      )}

      {!items ? <div className="skeleton" style={{ height: 40 }} /> : !items.length ? (
        <p className="muted" style={{ fontSize: 13 }}>Sin credenciales emitidas para este lote.</p>
      ) : (
        <div className="table-scroll">
          <table className="data">
            <thead><tr><th>Serial</th><th>RUT</th><th>Empresa</th><th>Firmada</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontFamily: 'monospace' }}>{c.serial}</td>
                  <td>{c.rut_empresa}</td>
                  <td>{c.nombre_empresa}</td>
                  <td>{c.firmado_at ? fmtFecha(c.firmado_at) : <span className="badge badge-gray">sin firmar</span>}</td>
                  <td><span className={`badge ${c.activo ? 'badge-green' : 'badge-gray'}`}>{c.activo ? 'activa' : 'inactiva'}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm btn-outline" style={{ marginRight: 6 }}
                      onClick={() => api.abrirCredencialProveedor(lote.id, c.id).catch((e) => flash(e.message, true))}>
                      Credencial
                    </button>
                    <button className="btn btn-sm btn-outline" onClick={() => toggleActivo(c)}>{c.activo ? 'Desactivar' : 'Reactivar'}</button>
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
