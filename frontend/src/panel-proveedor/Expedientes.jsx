import { useEffect, useState } from 'react';
import { api, fmt, fmtInt, fmtFecha } from '../api.js';
import { validarRut } from '../lib/rut.js';

// ============================================================
// Expedientes de evidencia — cada venta con los documentos que la
// respaldan y, sobre todo, con lo que le FALTA.
//
// Lo que esta pantalla no hace, y es a propósito: no muestra emisiones,
// no clasifica el inventario del cliente y no comparte nada con nadie.
// Es la carpeta del proveedor, para el proveedor. Ve sus brechas antes
// que su cliente, que es la mitad del valor.
//
// El gris ("no se opina") se pinta distinto del verde en todas partes:
// un expediente de tipo "otro" no tiene documentos esperados definidos,
// así que no tiene porcentaje — y un porcentaje inventado sobre un
// denominador que nadie definió sería peor que no dar ninguno.
// ============================================================

const CLASE_SEMAFORO = {
  verde: 'badge-green',
  amarillo: 'badge-amber',
  rojo: 'badge-red',
  gris: 'badge-gray',
};

const ESTADO_LEGIBLE = {
  borrador: 'Borrador',
  abierto: 'Abierto',
  cerrado: 'Cerrado',
};

const NOMBRE_TIPO = {
  suministro: 'Suministro',
  servicio: 'Servicio',
  transporte: 'Transporte',
  arriendo: 'Arriendo',
  otro: 'Otro',
};

export default function Expedientes() {
  const [datos, setDatos] = useState(null);
  const [abierto, setAbierto] = useState(null);
  const [toast, setToast] = useState(null);
  const flash = (msg, err = false) => { setToast({ msg, err }); setTimeout(() => setToast(null), 4000); };

  const cargar = () => api.proveedorExpedientes().then(setDatos);
  useEffect(() => { cargar().catch((e) => flash(e.message, true)); }, []);

  if (!datos) return <div style={{ padding: 40 }}><span className="spinner dark" /> Cargando…</div>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Expedientes de evidencia</h1>
      <p className="muted" style={{ fontSize: 14, maxWidth: 780 }}>{datos.aviso}</p>

      <NuevoExpediente
        vocabulario={datos.vocabulario}
        alCrear={() => cargar().catch(() => {})}
        flash={flash}
      />

      {datos.expedientes.length === 0 ? (
        <div className="card card-pad">
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Todavía no abres expedientes. Parte por una factura de venta cualquiera: el expediente
            te va a decir qué documentos le faltan para quedar respaldada.
          </p>
        </div>
      ) : (
        <div className="card card-pad" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Tus expedientes</h3>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Orden de compra</th>
                  <th>Faena</th>
                  <th>Tipo</th>
                  <th>Período</th>
                  <th>Documentos</th>
                  <th>Cobertura</th>
                  <th>Pendientes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {datos.expedientes.map((e) => (
                  <tr key={e.id}>
                    <td>{e.cliente_nombre}</td>
                    <td>{e.orden_compra || <span className="muted">—</span>}</td>
                    <td>{e.faena || <span className="muted">—</span>}</td>
                    <td>{NOMBRE_TIPO[e.tipo] || e.tipo}</td>
                    <td>{e.periodo || <span className="muted">—</span>}</td>
                    <td>
                      {e.documentos_total}
                      {e.documentos_declarados > 0 && (
                        <span className="muted" style={{ fontSize: 11 }}>
                          {' '}({e.documentos_declarados} solo declarado{e.documentos_declarados > 1 ? 's' : ''})
                        </span>
                      )}
                    </td>
                    <td><Cobertura resumen={e} /></td>
                    <td>{e.pendientes.length}</td>
                    <td>
                      <button className="btn btn-outline btn-sm" onClick={() => setAbierto(e.id)}>
                        Abrir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {abierto && (
        <Detalle
          id={abierto}
          vocabulario={datos.vocabulario}
          alCerrar={() => { setAbierto(null); cargar().catch(() => {}); }}
          flash={flash}
        />
      )}

      <NoAcredita lista={datos.no_acredita} notaScope={datos.nota_scope} />

      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}

// ---------- La cobertura, con el gris bien separado del verde ----------
function Cobertura({ resumen }) {
  const clase = CLASE_SEMAFORO[resumen.semaforo] || 'badge-gray';
  // null NO es 0: es "no se opina". Mostrar "0%" acá sería decirle al
  // proveedor que no tiene respaldo cuando lo que pasa es que su tipo de
  // expediente no define qué documentos esperar.
  if (resumen.cobertura_documental === null || resumen.cobertura_documental === undefined) {
    return (
      <span className={`badge ${clase}`} title="Este tipo de expediente no define qué documentos se esperan, así que no hay porcentaje que calcular.">
        No se opina
      </span>
    );
  }
  return (
    <span className={`badge ${clase}`}>
      {resumen.cobertura_documental}% · {resumen.estado_cobertura}
    </span>
  );
}

// ---------- Abrir un expediente ----------
function NuevoExpediente({ vocabulario, alCrear, flash }) {
  const [abierto, setAbierto] = useState(false);
  const [form, setForm] = useState({
    cliente_nombre: '', cliente_rut: '', orden_compra: '', contrato: '',
    faena: '', centro_costo: '', periodo: '', glosa: '', tipo: 'suministro',
  });
  const [guardando, setGuardando] = useState(false);
  const set = (k) => (ev) => setForm((f) => ({ ...f, [k]: ev.target.value }));

  async function crear(ev) {
    ev.preventDefault();
    setGuardando(true);
    try {
      await api.proveedorExpedienteCrear(form);
      setForm({
        cliente_nombre: '', cliente_rut: '', orden_compra: '', contrato: '',
        faena: '', centro_costo: '', periodo: '', glosa: '', tipo: 'suministro',
      });
      setAbierto(false);
      alCrear();
      flash('Expediente abierto.');
    } catch (e) { flash(e.message, true); }
    finally { setGuardando(false); }
  }

  if (!abierto) {
    return (
      <div style={{ marginBottom: 20 }}>
        <button className="btn btn-primary" onClick={() => setAbierto(true)}>Abrir expediente</button>
      </div>
    );
  }

  return (
    <form className="card card-pad" style={{ marginBottom: 20 }} onSubmit={crear}>
      <h3 style={{ marginTop: 0 }}>Abrir expediente</h3>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Un expediente por factura de venta. La orden de compra y el contrato son los que después
        consolidan varias facturas del mismo encargo.
      </p>
      <div className="form-row">
        <div className="field"><label>Cliente</label>
          <input value={form.cliente_nombre} onChange={set('cliente_nombre')} required
            placeholder="Nombre de tu cliente" /></div>
        <div className="field"><label>RUT del cliente</label>
          <input value={form.cliente_rut} onChange={set('cliente_rut')} placeholder="77.777.777-7" />
          <AvisoRut valor={form.cliente_rut} /></div>
        <div className="field"><label>Orden de compra</label>
          <input value={form.orden_compra} onChange={set('orden_compra')} placeholder="OC 12345" /></div>
        <div className="field"><label>Contrato</label>
          <input value={form.contrato} onChange={set('contrato')} /></div>
        <div className="field"><label>Faena o destino</label>
          <input value={form.faena} onChange={set('faena')} placeholder="Nombre de la faena" /></div>
        <div className="field"><label>Centro de costo</label>
          <input value={form.centro_costo} onChange={set('centro_costo')} /></div>
        <div className="field"><label>Período</label>
          <input value={form.periodo} onChange={set('periodo')} placeholder="2026-07" /></div>
        <div className="field"><label>Tipo</label>
          <select value={form.tipo} onChange={set('tipo')}>
            {vocabulario.tipos.map((t) => (
              <option key={t} value={t}>{NOMBRE_TIPO[t] || t}</option>
            ))}
          </select></div>
      </div>
      <div className="field" style={{ marginTop: 10 }}>
        <label>Qué se vendió</label>
        <input value={form.glosa} onChange={set('glosa')}
          placeholder="Mantención de correas transportadoras" />
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        El tipo decide qué documentos se esperan. «Otro» no define ninguno: el expediente queda
        sin porcentaje, no en 0%.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" disabled={guardando}>
          {guardando ? 'Abriendo…' : 'Abrir'}
        </button>
        <button type="button" className="btn btn-outline" onClick={() => setAbierto(false)}>Cancelar</button>
      </div>
    </form>
  );
}

// ---------- El expediente abierto ----------
function Detalle({ id, vocabulario, alCerrar, flash }) {
  const [datos, setDatos] = useState(null);
  const [candidatos, setCandidatos] = useState(null);
  // El documento del RCV que el proveedor eligió enganchar. Es LA pieza
  // que convierte un documento "solo declarado" en uno respaldado: sin
  // este vínculo el backend no tiene con qué probar la procedencia, y
  // /candidatos no tendría para qué existir.
  const [desdeRcv, setDesdeRcv] = useState(null);

  const cargar = () => api.proveedorExpediente(id).then(setDatos);
  useEffect(() => { cargar().catch((e) => flash(e.message, true)); }, [id]);

  async function verCandidatos() {
    try { setCandidatos((await api.proveedorExpedienteCandidatos(id)).candidatos); }
    catch (e) { flash(e.message, true); }
  }

  async function soltar(docId) {
    try { await api.proveedorExpedienteSoltarDoc(id, docId); await cargar(); flash('Documento soltado.'); }
    catch (e) { flash(e.message, true); }
  }

  async function cerrarExpediente() {
    try {
      await api.proveedorExpedienteEditar(id, { estado: 'cerrado' });
      await cargar();
      flash('Expediente cerrado. Puedes reabrirlo cuando quieras.');
    } catch (e) { flash(e.message, true); }
  }

  async function reabrir() {
    try { await api.proveedorExpedienteEditar(id, { estado: 'abierto' }); await cargar(); }
    catch (e) { flash(e.message, true); }
  }

  if (!datos) return <div className="card card-pad"><span className="spinner dark" /> Cargando expediente…</div>;

  const { expediente: e, documentos, resumen } = datos;

  return (
    <div className="card card-pad" style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: '0 0 4px' }}>
            {e.cliente_nombre}{' '}
            <span className={`badge ${e.estado === 'cerrado' ? 'badge-gray' : 'badge-green'}`}>
              {ESTADO_LEGIBLE[e.estado] || e.estado}
            </span>
          </h3>
          <div className="muted" style={{ fontSize: 13 }}>
            {[e.orden_compra, e.contrato, e.faena, e.periodo].filter(Boolean).join(' · ') || 'Sin OC, contrato ni faena'}
          </div>
          {e.glosa && <div style={{ fontSize: 13, marginTop: 6 }}>{e.glosa}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {e.estado === 'cerrado'
            ? <button className="btn btn-outline btn-sm" onClick={reabrir}>Reabrir</button>
            : <button className="btn btn-outline btn-sm" onClick={cerrarExpediente}>Cerrar expediente</button>}
          {/* "Volver", no "Cerrar": cerrar un expediente es otra cosa —el
              estado 'cerrado'— y llamar igual a las dos acciones mandaba al
              proveedor a buscar algo que este botón no hace. */}
          <button className="btn btn-outline btn-sm" onClick={alCerrar}>Volver</button>
        </div>
      </div>

      <div style={{ margin: '14px 0' }}>
        <Cobertura resumen={resumen} />
        <span className="muted" style={{ fontSize: 12, marginLeft: 10 }}>
          {resumen.documentos_respaldados} de {resumen.documentos_total} documentos con respaldo en sicr3p
        </span>
      </div>

      <h4 style={{ marginBottom: 6 }}>Documentos</h4>
      {documentos.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>Todavía no enganchas documentos.</p>
      ) : (
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Rol</th><th>Documento</th><th className="num">Cantidad</th><th>Asociación</th>
                <th>Base del prorrateo</th><th>Respaldo</th><th />
              </tr>
            </thead>
            <tbody>
              {documentos.map((d) => {
                const rol = vocabulario.roles.find((r) => r.codigo === d.rol);
                const respaldado = Boolean(d.factura_id || d.dte_proveedor_id);
                return (
                  <tr key={d.id}>
                    <td>{rol?.nombre || d.rol}</td>
                    <td>
                      {d.descripcion}
                      {d.fecha && <div className="muted" style={{ fontSize: 11 }}>{fmtFecha(d.fecha)}</div>}
                    </td>
                    <td className="num">
                      {d.cantidad != null
                        ? `${fmt(d.cantidad)}${d.unidad ? ` ${d.unidad}` : ''}`
                        : <span className="muted">—</span>}
                    </td>
                    <td>
                      {d.asociacion === 'directa'
                        ? 'Directa'
                        : `${d.asociacion === 'confirmada' ? 'Confirmada' : 'Compartida'} ${fmt(d.porcentaje)}%`}
                    </td>
                    <td>{d.base_prorrateo || (d.asociacion === 'directa' ? <span className="muted">—</span> : <span className="badge badge-amber">Falta</span>)}</td>
                    <td>
                      {respaldado
                        ? <span className="badge badge-green">En sicr3p</span>
                        : <span className="badge badge-gray" title="Existe según tu declaración; sicr3p no tiene el documento.">Solo declarado</span>}
                    </td>
                    <td>
                      <button className="btn btn-outline btn-sm" onClick={() => soltar(d.id)}>Soltar</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Las compras del propio RCV van ARRIBA del formulario a propósito:
          engancharlas desde acá es el camino que deja el documento
          respaldado, y escribirlo a mano deja uno "solo declarado". El
          orden de la pantalla tiene que empujar hacia el camino bueno. */}
      <div style={{ marginTop: 16 }}>
        <button className="btn btn-outline btn-sm" onClick={verCandidatos}>
          Ver compras de mi RCV
        </button>
        {candidatos && (
          candidatos.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>
              No hay compras de tu RCV para este período. Conecta el SII o ajusta el período del expediente.
            </p>
          ) : (
            <div className="table-scroll" style={{ marginTop: 10 }}>
              <table className="data">
                <thead>
                  <tr><th>Fecha</th><th>Proveedor</th><th>Folio</th><th className="num">Total</th><th /></tr>
                </thead>
                <tbody>
                  {candidatos.slice(0, 25).map((c) => (
                    <tr key={c.id}>
                      <td>{c.fecha ? fmtFecha(c.fecha) : '—'}</td>
                      <td>{c.razon_social || c.rut_contraparte}</td>
                      <td>{c.folio}</td>
                      <td className="num">{fmtInt(c.total)}</td>
                      <td>
                        <button
                          className="btn btn-outline btn-sm"
                          disabled={desdeRcv?.id === c.id}
                          onClick={() => setDesdeRcv(c)}
                        >
                          {desdeRcv?.id === c.id ? 'Elegida' : 'Enganchar'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted" style={{ fontSize: 12 }}>
                Tú decides cuál respalda esta venta y en qué proporción — sicr3p no lo hace por ti.
              </p>
            </div>
          )
        )}
      </div>

      <AgregarDocumento
        id={id} vocabulario={vocabulario} desdeRcv={desdeRcv}
        alLimpiarRcv={() => setDesdeRcv(null)}
        alAgregar={() => { setDesdeRcv(null); cargar().catch(() => {}); }}
        flash={flash}
      />

      <h4 style={{ marginTop: 20, marginBottom: 6 }}>Qué le falta</h4>
      {resumen.pendientes.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>Sin brechas registradas.</p>
      ) : (
        <ul style={{ fontSize: 13, lineHeight: 1.7, paddingLeft: 20, margin: 0 }}>
          {resumen.pendientes.map((p, i) => (
            <li key={`${p.codigo}-${i}`}>{p.detalle}</li>
          ))}
        </ul>
      )}

      <h4 style={{ marginTop: 20, marginBottom: 6 }}>Clasificación potencial</h4>
      {/* Cuando no hay categoría, no se inventa una: el mismo gris de la
          cobertura. Es la única parte del producto donde sicr3p dice algo
          sobre la contabilidad del cliente, así que es donde menos se
          puede rellenar con un valor por defecto. */}
      {resumen.scope.cliente.categoria_potencial ? (
        <p style={{ fontSize: 13, margin: 0 }}>
          Para tu cliente esto sería <strong>Alcance {resumen.scope.cliente.alcance_potencial} · Categoría{' '}
          {resumen.scope.cliente.categoria_potencial}</strong> — {resumen.scope.cliente.nombre_categoria}.
        </p>
      ) : (
        <p style={{ fontSize: 13, margin: 0 }}>
          <span className="badge badge-gray">Sin categoría</span>
        </p>
      )}
      <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>{resumen.scope.cliente.nota}</p>
      <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>{resumen.scope.proveedor.nota}</p>
    </div>
  );
}

// ---------- Enganchar un documento ----------
// `desdeRcv` es la compra que el proveedor eligió de su RCV. Cuando viene,
// el documento se guarda CON su `dte_proveedor_id` y queda respaldado; sin
// ella, queda "solo declarado" y aparece como brecha. Los dos caminos son
// legítimos —registrar un declarado es mejor que no verlo— pero tienen que
// verse distintos en pantalla, porque significan cosas distintas.
function AgregarDocumento({ id, vocabulario, desdeRcv, alLimpiarRcv, alAgregar, flash }) {
  const vacio = {
    rol: 'compra_relacionada', asociacion: 'directa', porcentaje: 100,
    base_prorrateo: '', descripcion: '', emisor_rut: '', folio: '', fecha: '',
    monto: '', cantidad: '', unidad: '',
  };
  const [form, setForm] = useState(vacio);
  const [guardando, setGuardando] = useState(false);
  const set = (k) => (ev) => setForm((f) => ({ ...f, [k]: ev.target.value }));

  // Al elegir una compra del RCV se precarga lo que el SII ya sabe de ella.
  // El proveedor puede corregir cualquier campo: lo que NO cambia es el
  // vínculo, que viaja aparte en `desdeRcv.id`.
  useEffect(() => {
    if (!desdeRcv) return;
    setForm((f) => ({
      ...f,
      descripcion: `${desdeRcv.razon_social || desdeRcv.rut_contraparte || 'Compra'} — folio ${desdeRcv.folio}`,
      folio: String(desdeRcv.folio || ''),
      emisor_rut: desdeRcv.rut_contraparte || '',
      fecha: desdeRcv.fecha ? String(desdeRcv.fecha).slice(0, 10) : '',
      monto: desdeRcv.total ?? '',
    }));
  }, [desdeRcv]);

  async function agregar(ev) {
    ev.preventDefault();
    setGuardando(true);
    try {
      await api.proveedorExpedienteAgregarDoc(id, {
        ...form,
        // EL VÍNCULO. Sin esta línea el documento nace "solo declarado"
        // por mucho que el proveedor lo haya elegido de su propio RCV.
        dte_proveedor_id: desdeRcv?.id || null,
        porcentaje: form.asociacion === 'directa' ? 100 : Number(form.porcentaje),
        monto: form.monto === '' ? null : Number(form.monto),
        cantidad: form.cantidad === '' ? null : Number(form.cantidad),
        fecha: form.fecha || null,
      });
      setForm(vacio);
      alAgregar();
      flash(desdeRcv ? 'Documento enganchado con respaldo en tu RCV.' : 'Documento declarado registrado.');
    } catch (e) { flash(e.message, true); }
    finally { setGuardando(false); }
  }

  return (
    <form onSubmit={agregar} style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--linea, #e3e8ef)' }}>
      <h4 style={{ marginTop: 0 }}>Enganchar un documento</h4>

      {desdeRcv ? (
        <div className="card card-pad" style={{ marginBottom: 12, padding: '10px 14px' }}>
          <span className="badge badge-green">Con respaldo</span>{' '}
          <span style={{ fontSize: 13 }}>
            Folio {desdeRcv.folio} de {desdeRcv.razon_social || desdeRcv.rut_contraparte}, de tu RCV.
          </span>{' '}
          <button type="button" className="btn btn-outline btn-sm" onClick={alLimpiarRcv}>Quitar</button>
        </div>
      ) : (
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Sin elegir una compra de tu RCV, este documento queda <strong>solo declarado</strong>:
          se registra igual y aparece como brecha. Verlo es mejor que no verlo.
        </p>
      )}

      <div className="form-row">
        <div className="field"><label>Rol</label>
          <select value={form.rol} onChange={set('rol')}>
            {vocabulario.roles.map((r) => <option key={r.codigo} value={r.codigo}>{r.nombre}</option>)}
          </select></div>
        <div className="field"><label>Descripción</label>
          <input value={form.descripcion} onChange={set('descripcion')} required
            placeholder="Factura 8891 — Combustibles del Norte" /></div>
        <div className="field"><label>Asociación</label>
          <select value={form.asociacion} onChange={set('asociacion')}>
            <option value="directa">Directa (100%)</option>
            <option value="confirmada">Confirmada (parcial)</option>
            <option value="compartida">Compartida (prorrateada)</option>
          </select></div>
        {form.asociacion !== 'directa' && (
          <>
            <div className="field"><label>Porcentaje</label>
              <input type="number" min="1" max="100" value={form.porcentaje} onChange={set('porcentaje')} /></div>
            <div className="field"><label>Base del prorrateo</label>
              <input value={form.base_prorrateo} onChange={set('base_prorrateo')}
                placeholder="por consumo de la faena" /></div>
          </>
        )}
        {/* La cantidad que declara ESTE documento: es contra lo que se
            compara la de los demás para decidir si coinciden. */}
        <div className="field"><label>Cantidad que declara</label>
          <input type="number" step="any" min="0" value={form.cantidad} onChange={set('cantidad')}
            placeholder="50" /></div>
        <div className="field"><label>Unidad</label>
          <input value={form.unidad} onChange={set('unidad')} placeholder="unidad, kg, L" /></div>
        <div className="field"><label>Folio</label>
          <input value={form.folio} onChange={set('folio')} /></div>
        <div className="field"><label>RUT del emisor</label>
          <input value={form.emisor_rut} onChange={set('emisor_rut')} placeholder="77.777.777-7" />
          <AvisoRut valor={form.emisor_rut} /></div>
        <div className="field"><label>Fecha</label>
          <input type="date" value={form.fecha} onChange={set('fecha')} /></div>
        <div className="field"><label>Monto</label>
          <input type="number" value={form.monto} onChange={set('monto')} /></div>
      </div>
      <button className="btn btn-primary btn-sm" disabled={guardando}>
        {guardando ? 'Enganchando…' : 'Enganchar'}
      </button>
    </form>
  );
}

// Un RUT con el dígito verificador malo se normaliza igual de bien que uno
// bueno, y después el cruce por igualdad con dte_proveedor.rut_contraparte
// —la razón entera de normalizarlo— no calza nunca, sin que nadie se
// entere. El módulo 11 es lo único que atrapa eso. El backend lo rechaza
// igual (routes/expedientes.js, rutDe); esto es para verlo al escribir.
function AvisoRut({ valor }) {
  const v = String(valor || '').trim();
  if (!v || validarRut(v)) return null;
  return (
    <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
      Revisa el dígito verificador.
    </div>
  );
}

function NoAcredita({ lista, notaScope }) {
  return (
    <div className="card card-pad">
      <h3 style={{ marginTop: 0 }}>Qué acredita y qué no</h3>
      <p style={{ fontSize: 13, marginTop: 0 }}>
        Un expediente muestra qué documentos existen, de dónde vienen y cuáles faltan.
      </p>
      <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, paddingLeft: 20, margin: 0 }}>
        {lista.map((t) => <li key={t}>{t}</li>)}
      </ul>
      <p className="muted" style={{ fontSize: 13, marginBottom: 0, marginTop: 10 }}>
        <strong>{notaScope}</strong>
      </p>
    </div>
  );
}
