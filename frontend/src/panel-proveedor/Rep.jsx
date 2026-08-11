import { useEffect, useState } from 'react';
import { api, fmt, fmtInt, fmtFecha } from '../api.js';
import { Icon } from '../components/icons.jsx';
import Dropzone from '../components/Dropzone.jsx';
import { MATERIALES_REP, calcularReciclabilidad, UMBRAL_EXENCION_REP_KG, EXENCION_REP_NOTA } from '../lib/rep.js';

// ============================================================
// Ley REP (20.920) desde el panel de la empresa — sin POS.
//
// La empresa es el productor obligado por la ley: acá mantiene su
// catálogo de productos (composición del envase de UNA unidad), sube su
// factura de venta como evidencia (foto desde el teléfono en terreno, o
// PDF/XML) y la "pega" a sus productos con las unidades vendidas. El
// resumen muestra los kilos de envases puestos en el mercado por
// material y período — el insumo de su declaración en RETC/SGR.
// El % de reciclabilidad en vivo es solo vista previa: el servidor
// SIEMPRE recalcula (services/rep.js).
// ============================================================

const COMPONENTE_VACIO = { material: 'plasticos', peso_gr: '', cantidad: '1', reciclable: true };

export default function Rep() {
  const [productos, setProductos] = useState(null);
  const [ventas, setVentas] = useState(null);
  const [resumen, setResumen] = useState(null);
  const [aviso, setAviso] = useState('');
  const [toast, setToast] = useState(null);
  const flash = (msg, err = false) => { setToast({ msg, err }); setTimeout(() => setToast(null), 4000); };

  const cargarProductos = () => api.proveedorRepProductos().then((d) => setProductos(d.productos));
  const cargarVentas = () => api.proveedorRepVentas().then((d) => { setVentas(d.ventas); setResumen(d.resumen); setAviso(d.aviso); });

  useEffect(() => {
    cargarProductos().catch((e) => flash(e.message, true));
    cargarVentas().catch((e) => flash(e.message, true));
  }, []);

  if (!productos || !ventas) return <div style={{ padding: 40 }}><span className="spinner dark" /> Cargando…</div>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Ley REP — envases y embalajes</h1>
      <p className="muted" style={{ fontSize: 14, maxWidth: 760 }}>
        Declara la composición del envase de cada producto una sola vez. Después, por cada venta,
        sube la factura (sirve la foto desde tu teléfono) y pégala a los productos vendidos:
        sicr3p lleva los <b>kilos de envases puestos en el mercado por material</b>, que es lo que
        tu empresa declara en RETC/SGR.
      </p>

      <ResumenRep resumen={resumen} aviso={aviso} />
      <Productos productos={productos} recargar={() => cargarProductos().catch((e) => flash(e.message, true))} flash={flash} />
      <RegistrarVenta
        productos={productos.filter((p) => p.activo)}
        alRegistrar={() => { cargarVentas().catch(() => {}); }}
        flash={flash}
      />
      <Ventas ventas={ventas} flash={flash} />

      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}

// ---------- Resumen: kilos por material (la base de la declaración) ----------
function ResumenRep({ resumen, aviso }) {
  if (!resumen || resumen.total.n_ventas === 0) return null;
  const anioActual = String(new Date().getFullYear());
  const kgAnio = resumen.por_periodo
    .filter((p) => p.periodo.startsWith(anioActual))
    .reduce((s, p) => s + p.kg_envases, 0);
  return (
    <div className="card card-pad" style={{ marginBottom: 20 }}>
      <h3 style={{ marginTop: 0 }}>Envases puestos en el mercado</h3>
      <div className="stat-grid" style={{ marginBottom: 14 }}>
        <div className="stat"><div className="n green">{fmt(resumen.total.kg_envases, 1)} kg</div><div className="l">Total declarado</div></div>
        <div className="stat"><div className="n">{fmt(resumen.total.kg_reciclables, 1)} kg</div><div className="l">Reciclables</div></div>
        <div className="stat"><div className="n">{fmtInt(resumen.total.n_ventas)}</div><div className="l">Facturas registradas</div></div>
        <div className="stat"><div className="n">{fmtInt(resumen.total.n_unidades)}</div><div className="l">Unidades vendidas</div></div>
      </div>
      <div className="table-scroll">
        <table className="data">
          <thead><tr><th>Material (Ley 20.920)</th><th className="num">kg en el mercado</th><th className="num">kg reciclables</th></tr></thead>
          <tbody>
            {resumen.por_material.map((m) => (
              <tr key={m.material}>
                <td>{m.nombre}</td>
                <td className="num">{fmt(m.kg, 3)}</td>
                <td className="num">{fmt(m.kg_reciclables, 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {kgAnio > 0 && kgAnio < UMBRAL_EXENCION_REP_KG && (
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          Llevas {fmt(kgAnio, 1)} kg este año. {EXENCION_REP_NOTA}
        </p>
      )}
      <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 8 }}>{aviso}</p>
    </div>
  );
}

// ---------- Catálogo de productos con su envase ----------
function Productos({ productos, recargar, flash }) {
  const [edit, setEdit] = useState(null); // {id?, nombre, codigo, componentes:[...]} | null

  const abrirNuevo = () => setEdit({ nombre: '', codigo: '', componentes: [{ ...COMPONENTE_VACIO }] });
  const abrirEditar = (p) => setEdit({
    id: p.id, nombre: p.nombre, codigo: p.codigo || '',
    componentes: p.componentes.map((c) => ({ ...c, peso_gr: String(c.peso_gr), cantidad: String(c.cantidad ?? 1) })),
  });

  async function guardar() {
    const componentes = edit.componentes.map((c) => ({
      material: c.material,
      peso_gr: Number(String(c.peso_gr).replace(',', '.')),
      cantidad: Number(c.cantidad) || 1,
      reciclable: Boolean(c.reciclable),
    }));
    const body = { nombre: edit.nombre, codigo: edit.codigo, componentes };
    try {
      if (edit.id) await api.proveedorRepEditarProducto(edit.id, body);
      else await api.proveedorRepCrearProducto(body);
      setEdit(null); recargar();
      flash(edit.id ? 'Producto actualizado.' : 'Producto creado.');
    } catch (e) { flash(e.message, true); }
  }

  async function toggle(p) {
    try { await api.proveedorRepEditarProducto(p.id, { activo: !p.activo }); recargar(); }
    catch (e) { flash(e.message, true); }
  }

  const preview = edit ? calcularReciclabilidad(edit.componentes.map((c) => ({
    ...c, peso_gr: Number(String(c.peso_gr).replace(',', '.')),
  }))) : null;

  return (
    <div className="card card-pad" style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ margin: 0 }}>Mis productos</h3>
        <button className="btn btn-primary btn-sm" onClick={abrirNuevo}>+ Nuevo producto</button>
      </div>
      {productos.length === 0 ? (
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
          Parte por acá: crea tus productos con la composición de su envase (una sola vez por producto).
        </p>
      ) : (
        <div className="table-scroll">
          <table className="data" style={{ marginTop: 12 }}>
            <thead><tr><th>Producto</th><th className="num">Envase (g/unidad)</th><th className="num">% reciclable</th><th>Nivel</th><th></th></tr></thead>
            <tbody>
              {productos.map((p) => (
                <tr key={p.id} style={p.activo ? {} : { opacity: 0.55 }}>
                  <td>
                    {p.nombre}
                    {p.codigo && <span className="muted" style={{ fontSize: 12 }}> · {p.codigo}</span>}
                    {!p.activo && <span className="badge badge-gray" style={{ marginLeft: 8 }}>Inactivo</span>}
                  </td>
                  <td className="num">{fmt(p.peso_total_gr, 1)}</td>
                  <td className="num">{fmt(p.porcentaje, 1)}%</td>
                  <td><span className={`badge ${p.nivel === 'Alto' ? 'badge-green' : p.nivel === 'Medio' ? 'badge-amber' : 'badge-red'}`}>{p.nivel}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-outline btn-sm" onClick={() => abrirEditar(p)}>Editar</button>{' '}
                    <button className="btn btn-outline btn-sm" onClick={() => toggle(p)}>{p.activo ? 'Desactivar' : 'Activar'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edit && (
        <div className="modal-bg" onClick={(e) => e.target.className === 'modal-bg' && setEdit(null)}>
          <div className="modal" style={{ maxWidth: 640 }}>
            <h2 style={{ marginTop: 0 }}>{edit.id ? 'Editar producto' : 'Nuevo producto'}</h2>
            <div className="form-row" style={{ gridTemplateColumns: '2fr 1fr' }}>
              <div className="field"><label>Nombre del producto</label>
                <input value={edit.nombre} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} placeholder="Mermelada frutilla 250 g" /></div>
              <div className="field"><label>Código (opcional)</label>
                <input value={edit.codigo} onChange={(e) => setEdit({ ...edit, codigo: e.target.value })} placeholder="SKU-001" /></div>
            </div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              Envase de UNA unidad vendida: cada componente con su material, peso y si es reciclable.
            </div>
            {edit.componentes.map((c, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 8 }}>
                <div className="field" style={{ margin: 0, flex: '1 1 140px' }}>
                  <label>Material</label>
                  <select value={c.material} onChange={(e) => {
                    const cs = [...edit.componentes]; cs[i] = { ...c, material: e.target.value }; setEdit({ ...edit, componentes: cs });
                  }}>
                    {MATERIALES_REP.map((m) => <option key={m.codigo} value={m.codigo}>{m.nombre}</option>)}
                  </select>
                </div>
                <div className="field" style={{ margin: 0, width: 110 }}>
                  <label>Peso (g)</label>
                  <input inputMode="decimal" value={c.peso_gr} onChange={(e) => {
                    const cs = [...edit.componentes]; cs[i] = { ...c, peso_gr: e.target.value.replace(/[^\d.,]/g, '') }; setEdit({ ...edit, componentes: cs });
                  }} />
                </div>
                <div className="field" style={{ margin: 0, width: 90 }}>
                  <label>Cantidad</label>
                  <input inputMode="numeric" value={c.cantidad} onChange={(e) => {
                    const cs = [...edit.componentes]; cs[i] = { ...c, cantidad: e.target.value.replace(/\D/g, '') }; setEdit({ ...edit, componentes: cs });
                  }} />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, height: 38, cursor: 'pointer' }}>
                  <input type="checkbox" checked={c.reciclable} onChange={(e) => {
                    const cs = [...edit.componentes]; cs[i] = { ...c, reciclable: e.target.checked }; setEdit({ ...edit, componentes: cs });
                  }} /> Reciclable
                </label>
                {edit.componentes.length > 1 && (
                  <button className="btn btn-outline btn-sm" type="button"
                    onClick={() => setEdit({ ...edit, componentes: edit.componentes.filter((_, j) => j !== i) })}>✕</button>
                )}
              </div>
            ))}
            <button className="btn btn-outline btn-sm" type="button" style={{ marginBottom: 12 }}
              onClick={() => setEdit({ ...edit, componentes: [...edit.componentes, { ...COMPONENTE_VACIO }] })}>
              + Agregar componente
            </button>
            {preview?.nivel && (
              <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
                Vista previa: {fmt(preview.peso_total_gr, 1)} g por unidad · {fmt(preview.porcentaje, 1)}% reciclable
                (nivel {preview.nivel}). El servidor recalcula al guardar.
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setEdit(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardar} disabled={!edit.nombre.trim()}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Registrar una venta: factura + productos vendidos ----------
function RegistrarVenta({ productos, alRegistrar, flash }) {
  const [archivo, setArchivo] = useState(null);
  const [numero, setNumero] = useState('');
  // Fecha LOCAL, no toISOString(): en Chile a las 21:00 ya es "mañana" en
  // UTC y el campo partiría con la fecha del día siguiente.
  const [fecha, setFecha] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [lineas, setLineas] = useState([{ producto_id: '', unidades: '' }]);
  const [enviando, setEnviando] = useState(false);

  if (productos.length === 0) return null;

  async function registrar() {
    if (!archivo) { flash('Adjunta la factura (foto o archivo).', true); return; }
    if (!numero.trim()) { flash('Escribe el número del documento.', true); return; }
    const items = lineas
      .filter((l) => l.producto_id && Number(l.unidades) >= 1)
      .map((l) => ({ producto_id: l.producto_id, unidades: Number(l.unidades) }));
    if (items.length === 0) { flash('Pega la factura a al menos un producto con sus unidades.', true); return; }
    setEnviando(true);
    try {
      const fd = new FormData();
      fd.append('archivo', archivo);
      fd.append('numero_documento', numero.trim());
      fd.append('fecha_documento', fecha);
      fd.append('items', JSON.stringify(items));
      await api.proveedorRepRegistrarVenta(fd);
      setArchivo(null); setNumero(''); setLineas([{ producto_id: '', unidades: '' }]);
      alRegistrar();
      flash('Venta registrada: los kilos ya están en tu resumen REP.');
    } catch (e) { flash(e.message, true); }
    finally { setEnviando(false); }
  }

  return (
    <div className="card card-pad" style={{ marginBottom: 20 }}>
      <h3 style={{ marginTop: 0 }}>Registrar una venta</h3>
      <Dropzone
        accept=".pdf,.xml,.jpg,.jpeg,.png,.heic"
        hint="La factura de la venta: PDF, XML o una foto (JPG, PNG, HEIC)"
        onFiles={(list) => setArchivo(Array.from(list)[0] || null)}
      />
      {archivo && (
        <div className="file-item" style={{ marginTop: 8 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}><Icon.Doc size={14} /> {archivo.name}</span>
          <span className="rm" onClick={() => setArchivo(null)}>Quitar</span>
        </div>
      )}
      <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 12 }}>
        <div className="field"><label>N° del documento</label>
          <input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="F-1234" /></div>
        <div className="field"><label>Fecha del documento</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
      </div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Productos vendidos en esta factura:</div>
      {lineas.map((l, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 8 }}>
          <div className="field" style={{ margin: 0, flex: '1 1 220px' }}>
            <label>Producto</label>
            <select value={l.producto_id} onChange={(e) => {
              const ls = [...lineas]; ls[i] = { ...l, producto_id: e.target.value }; setLineas(ls);
            }}>
              <option value="">— elegir —</option>
              {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.codigo ? ` (${p.codigo})` : ''}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0, width: 110 }}>
            <label>Unidades</label>
            <input inputMode="numeric" value={l.unidades} onChange={(e) => {
              const ls = [...lineas]; ls[i] = { ...l, unidades: e.target.value.replace(/\D/g, '') }; setLineas(ls);
            }} />
          </div>
          {lineas.length > 1 && (
            <button className="btn btn-outline btn-sm" type="button"
              onClick={() => setLineas(lineas.filter((_, j) => j !== i))}>✕</button>
          )}
        </div>
      ))}
      <button className="btn btn-outline btn-sm" type="button" style={{ marginBottom: 14 }}
        onClick={() => setLineas([...lineas, { producto_id: '', unidades: '' }])}>
        + Otro producto
      </button>
      <div>
        <button className="btn btn-primary" onClick={registrar} disabled={enviando}>
          {enviando ? <><span className="spinner" /> Registrando…</> : 'Registrar venta'}
        </button>
      </div>
    </div>
  );
}

// ---------- Historial de ventas registradas ----------
function Ventas({ ventas, flash }) {
  if (ventas.length === 0) return null;
  return (
    <div className="card">
      <div className="table-scroll">
        <table className="data">
          <thead><tr><th>Fecha</th><th>Documento</th><th>Productos</th><th className="num">kg envases</th><th className="num">kg reciclables</th><th>Evidencia</th></tr></thead>
          <tbody>
            {ventas.map((v) => (
              <tr key={v.id}>
                <td className="muted" style={{ fontSize: 13 }}>{fmtFecha(v.fecha_documento)}</td>
                <td>N° {v.numero_documento}</td>
                <td style={{ fontSize: 13 }}>
                  {v.items.map((it) => `${it.nombre} ×${fmtInt(it.unidades)}`).join(' · ')}
                </td>
                <td className="num">{fmt(v.kg_envases, 3)}</td>
                <td className="num">{fmt(v.kg_reciclables, 3)}</td>
                <td>
                  <button className="btn btn-outline btn-sm"
                    onClick={() => api.proveedorRepDescargarEvidencia(v.id, v.archivo_nombre).catch((e) => flash(e.message, true))}>
                    Descargar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
