import { useState, useRef } from 'react';
import { api, fmt, fmtInt, fmtFecha } from '../api.js';
import { Icon } from '../components/icons.jsx';
import { Donut } from '../components/Charts.jsx';
import { validarRut, formatearRut } from '../lib/rut.js';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export default function Trazabilidad() {
  const [tab, setTab] = useState('mensual');
  const [toast, setToast] = useState(null);
  const flash = (msg, err = false) => { setToast({ msg, err }); setTimeout(() => setToast(null), 3500); };

  return (
    <div>
      <div className="admin-head">
        <div>
          <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: 'var(--green-600)' }}><Icon.Doc size={24} /></span> Trazabilidad
          </h1>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>
            Informes mensuales por cliente, cadena comprador-vendedor y verificación local de DTE.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        <button className={`btn btn-sm ${tab === 'mensual' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('mensual')}>Informe mensual</button>
        <button className={`btn btn-sm ${tab === 'cadena' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('cadena')}>Cadena de valor</button>
        <button className={`btn btn-sm ${tab === 'dte' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('dte')}>Verificador DTE</button>
        <button className={`btn btn-sm ${tab === 'valorizacion' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('valorizacion')}>Valorización</button>
      </div>

      {tab === 'mensual' && <InformeMensual flash={flash} />}
      {tab === 'cadena' && <Cadena flash={flash} />}
      {tab === 'dte' && <VerificadorDte flash={flash} />}
      {tab === 'valorizacion' && <Valorizacion flash={flash} />}

      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  );
}

// ---------- Informe mensual por cliente ----------
function InformeMensual({ flash }) {
  const hoy = new Date();
  const [rut, setRut] = useState('');
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [data, setData] = useState(null);
  const [cargando, setCargando] = useState(false);

  const qs = () => `?rut=${encodeURIComponent(rut)}&anio=${anio}&mes=${mes}`;

  async function consultar() {
    if (!validarRut(rut)) { flash('RUT inválido.', true); return; }
    setCargando(true);
    try { setData(await api.informeMensual(qs())); }
    catch (e) { flash(e.message, true); }
    finally { setCargando(false); }
  }

  const donutData = data ? Object.entries(data.por_categoria).map(([label, value]) => ({ label, value })) : [];

  return (
    <>
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="form-row" style={{ gridTemplateColumns: '1fr 130px 150px auto', alignItems: 'end', margin: 0 }}>
          <div className="field"><label>RUT del cliente</label>
            <input value={rut} onChange={(e) => setRut(e.target.value)} onBlur={() => setRut(formatearRut(rut))} placeholder="76.123.456-0" />
          </div>
          <div className="field"><label>Año</label>
            <select value={anio} onChange={(e) => setAnio(Number(e.target.value))}>
              {[hoy.getFullYear(), hoy.getFullYear() - 1].map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="field"><label>Mes</label>
            <select value={mes} onChange={(e) => setMes(Number(e.target.value))}>
              {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" style={{ marginBottom: 4 }} onClick={consultar} disabled={cargando}>
            {cargando ? <span className="spinner" /> : 'Consultar'}
          </button>
        </div>
      </div>

      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 360px) 1fr', gap: 20, alignItems: 'start' }}>
          <div style={{ display: 'grid', gap: 16 }}>
            <div className="card card-pad">
              <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase' }}>Período</div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{data.periodo.nombre}</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--green-600)', margin: '8px 0 2px' }}>{fmt(data.total_co2e, 3)}</div>
              <div className="muted" style={{ fontSize: 13 }}>t CO2e · {data.n_facturas} documento{data.n_facturas === 1 ? '' : 's'}</div>
              {data.n_facturas > 0 && (
                <button className="btn btn-primary" style={{ width: '100%', marginTop: 14 }} onClick={() => api.abrirInformeMensualPdf(qs()).catch((e) => flash(e.message, true))}>
                  Informe mensual (PDF)
                </button>
              )}
            </div>
            {donutData.length > 0 && (
              <div className="card card-pad">
                <h3 style={{ marginTop: 0 }}>Por categoría</h3>
                <Donut data={donutData} unit="t CO2e" />
              </div>
            )}
          </div>
          <div className="card">
            <table className="data">
              <thead><tr><th>Fecha</th><th>Documento</th><th>RUT emisor</th><th>Categoría</th><th className="num">t CO2e</th></tr></thead>
              <tbody>
                {data.facturas.map((f) => (
                  <tr key={f.id}>
                    <td className="muted" style={{ fontSize: 13 }}>{fmtFecha(f.fecha)}</td>
                    <td><b>{f.numero_venta || '—'}</b><div className="muted" style={{ fontSize: 12 }}>{f.archivo_original}</div></td>
                    <td className="muted" style={{ fontSize: 13 }}>{f.rut_emisor || '—'}</td>
                    <td><span className="badge badge-gray">{f.categoria}</span></td>
                    <td className="num">{fmt(f.total_co2e, 3)}</td>
                  </tr>
                ))}
                {data.facturas.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 30 }}>Sin documentos del cliente en {data.periodo.nombre}.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

// ---------- Cadena comprador-vendedor ----------
function Cadena({ flash }) {
  const [rut, setRut] = useState('');
  const [data, setData] = useState(null);
  const [cargando, setCargando] = useState(false);

  async function consultar() {
    if (!validarRut(rut)) { flash('RUT inválido.', true); return; }
    setCargando(true);
    try { setData(await api.cadena(`?rut=${encodeURIComponent(rut)}`)); }
    catch (e) { flash(e.message, true); }
    finally { setCargando(false); }
  }

  const TablaRel = ({ titulo, filas, dir }) => (
    <div className="card">
      <div style={{ padding: '14px 16px 0', fontWeight: 700 }}>{titulo}</div>
      <table className="data">
        <thead><tr><th>RUT</th><th className="num">Documentos</th><th className="num">t CO2e</th><th>Categorías</th><th>Último</th></tr></thead>
        <tbody>
          {filas.map((p) => (
            <tr key={p.rut}>
              <td><b>{p.rut}</b></td>
              <td className="num">{p.n_documentos}</td>
              <td className="num">{fmt(p.total_co2e, 3)}</td>
              <td style={{ fontSize: 12 }}>{(p.categorias || []).filter(Boolean).join(', ') || '—'}</td>
              <td className="muted" style={{ fontSize: 13 }}>{fmtFecha(p.ultimo_documento)}</td>
            </tr>
          ))}
          {filas.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 24 }}>Sin relaciones {dir} registradas.</td></tr>}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="form-row" style={{ gridTemplateColumns: '1fr auto', alignItems: 'end', margin: 0 }}>
          <div className="field"><label>RUT (empresa a trazar)</label>
            <input value={rut} onChange={(e) => setRut(e.target.value)} onBlur={() => setRut(formatearRut(rut))} placeholder="11.111.111-1" />
          </div>
          <button className="btn btn-primary" style={{ marginBottom: 4 }} onClick={consultar} disabled={cargando}>
            {cargando ? <span className="spinner" /> : 'Trazar cadena'}
          </button>
        </div>
        <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>
          Enlaza los RUT emisor y receptor de cada documento procesado: aguas arriba (proveedores) y aguas abajo (compradores).
        </p>
      </div>

      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 16 }}>
            {[
              { label: 'Proveedores', value: fmtInt(data.resumen.n_proveedores) },
              { label: 'CO2e comprado (t)', value: fmt(data.resumen.co2e_comprado, 3) },
              { label: 'Compradores', value: fmtInt(data.resumen.n_compradores) },
              { label: 'CO2e vendido (t)', value: fmt(data.resumen.co2e_vendido, 3) },
            ].map((c) => (
              <div className="card card-pad" key={c.label}>
                <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase' }}>{c.label}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--green-600)' }}>{c.value}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
            <TablaRel titulo="Aguas arriba — proveedores (le emiten a este RUT)" filas={data.proveedores} dir="de compra" />
            <TablaRel titulo="Aguas abajo — compradores (reciben de este RUT)" filas={data.compradores} dir="de venta" />
          </div>
        </>
      )}
    </>
  );
}

// ---------- Valorización de inventario FIFO / PMP ----------
const MOV_INV_VACIO = { descripcion: '', tipo: 'salida', cantidad: '', precio_unitario: '', co2e_unitario: '', fecha: '' };

function Valorizacion({ flash }) {
  const [rut, setRut] = useState('');
  const [metodo, setMetodo] = useState('fifo');
  const [data, setData] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [nuevo, setNuevo] = useState(null);

  async function consultar(m = metodo) {
    if (!validarRut(rut)) { flash('RUT inválido.', true); return; }
    setCargando(true);
    try { setData(await api.inventario(`?rut=${encodeURIComponent(rut)}&metodo=${m}`)); }
    catch (e) { flash(e.message, true); }
    finally { setCargando(false); }
  }

  async function guardarMovimiento() {
    try {
      await api.crearMovInventario({ ...nuevo, rut });
      setNuevo(null); consultar(); flash('Movimiento registrado.');
    } catch (e) { flash(e.message, true); }
  }

  return (
    <>
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="form-row" style={{ gridTemplateColumns: '1fr 170px auto auto', alignItems: 'end', margin: 0 }}>
          <div className="field"><label>RUT del cliente</label>
            <input value={rut} onChange={(e) => setRut(e.target.value)} onBlur={() => setRut(formatearRut(rut))} placeholder="11.111.111-1" />
          </div>
          <div className="field"><label>Método</label>
            <select value={metodo} onChange={(e) => { setMetodo(e.target.value); if (data) consultar(e.target.value); }}>
              <option value="fifo">FIFO</option>
              <option value="pmp">PMP (promedio)</option>
            </select>
          </div>
          <button className="btn btn-primary" style={{ marginBottom: 4 }} onClick={() => consultar()} disabled={cargando}>
            {cargando ? <span className="spinner" /> : 'Valorizar'}
          </button>
          {data && <button className="btn btn-outline btn-sm" style={{ marginBottom: 4 }} onClick={() => setNuevo({ ...MOV_INV_VACIO })}>+ Movimiento</button>}
        </div>
        <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>
          Las entradas llegan solas desde los <b>DTE XML</b> (precio real por ítem, CO2e repartido por monto). Registra salidas para valorizar el consumo.
        </p>
      </div>

      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 16 }}>
            {[
              { label: `Inventario (${data.metodo.toUpperCase()})`, value: `$ ${fmtInt(data.totales.valor_clp)}` },
              { label: 'CO2e del stock (t)', value: fmt(data.totales.co2e_stock, 3) },
              { label: 'Costo salidas (CLP)', value: `$ ${fmtInt(data.totales.costo_salidas_clp)}` },
              { label: 'CO2e salidas (t)', value: fmt(data.totales.costo_salidas_co2e, 3) },
            ].map((c) => (
              <div className="card card-pad" key={c.label}>
                <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase' }}>{c.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--green-600)' }}>{c.value}</div>
              </div>
            ))}
          </div>
          <div className="card">
            <table className="data">
              <thead><tr><th>Ítem</th><th className="num">Stock</th><th className="num">$ unitario</th><th className="num">Valor (CLP)</th><th className="num">t CO2e stock</th><th className="num">Costo salidas</th></tr></thead>
              <tbody>
                {data.items.map((it) => (
                  <tr key={it.descripcion}>
                    <td><b>{it.descripcion}</b>
                      {it.salidas_sin_stock && <div className="badge badge-amber" style={{ fontSize: 11, marginTop: 4 }}>△ {fmt(it.salidas_sin_stock, 1)} sin stock</div>}
                    </td>
                    <td className="num">{fmt(it.stock, 1)}</td>
                    <td className="num">$ {fmtInt(it.precio_unitario)}</td>
                    <td className="num">$ {fmtInt(it.valor_clp)}</td>
                    <td className="num">{fmt(it.co2e_stock, 4)}</td>
                    <td className="num">$ {fmtInt(it.costo_salidas_clp)}</td>
                  </tr>
                ))}
                {data.items.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 30 }}>Sin inventario para este RUT. Sube DTE XML en el flujo público o registra entradas manuales.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {nuevo && (
        <div className="modal-bg" onClick={(e) => e.target.className === 'modal-bg' && setNuevo(null)}>
          <div className="modal">
            <h2 style={{ marginTop: 0 }}>Movimiento de inventario</h2>
            <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="field"><label>Ítem</label><input value={nuevo.descripcion} onChange={(e) => setNuevo({ ...nuevo, descripcion: e.target.value })} placeholder="Suministro eléctrico" /></div>
              <div className="field"><label>Tipo</label>
                <select value={nuevo.tipo} onChange={(e) => setNuevo({ ...nuevo, tipo: e.target.value })}>
                  <option value="salida">Salida (consumo)</option>
                  <option value="entrada">Entrada</option>
                </select>
              </div>
              <div className="field"><label>Cantidad</label><input value={nuevo.cantidad} onChange={(e) => setNuevo({ ...nuevo, cantidad: e.target.value.replace(/[^\d.,]/g, '').replace(',', '.') })} /></div>
              <div className="field"><label>Fecha</label><input type="date" value={nuevo.fecha} onChange={(e) => setNuevo({ ...nuevo, fecha: e.target.value })} /></div>
              {nuevo.tipo === 'entrada' && (
                <>
                  <div className="field"><label>Precio unitario (CLP)</label><input value={nuevo.precio_unitario} onChange={(e) => setNuevo({ ...nuevo, precio_unitario: e.target.value.replace(/\D/g, '') })} /></div>
                  <div className="field"><label>t CO2e por unidad (opcional)</label><input value={nuevo.co2e_unitario} onChange={(e) => setNuevo({ ...nuevo, co2e_unitario: e.target.value.replace(/[^\d.,]/g, '').replace(',', '.') })} /></div>
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setNuevo(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardarMovimiento} disabled={!nuevo.descripcion || !nuevo.cantidad}>Registrar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------- Verificador local de DTE ----------
function VerificadorDte({ flash }) {
  const [dte, setDte] = useState(null);
  const [cargando, setCargando] = useState(false);
  const fileRef = useRef();

  async function verificar(file) {
    if (!file) return;
    setCargando(true);
    try {
      const fd = new FormData();
      fd.append('archivo', file);
      const r = await api.verificarDte(fd);
      setDte(r.dte);
    } catch (e) { flash(e.message, true); setDte(null); }
    finally { setCargando(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  const CHECK_LABELS = {
    rut_emisor_valido: 'RUT emisor válido (módulo 11)',
    rut_receptor_valido: 'RUT receptor válido (módulo 11)',
    folio_presente: 'Folio presente',
    fecha_valida: 'Fecha de emisión válida',
    totales_consistentes: 'Neto + IVA = Total',
    detalle_consistente: 'Suma del detalle = Neto',
    firma_presente: 'Firma electrónica presente',
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 360px) 1fr', gap: 20, alignItems: 'start' }}>
      <div className="card card-pad">
        <h3 style={{ marginTop: 0 }}>Verificar DTE (XML)</h3>
        <p className="muted" style={{ fontSize: 13 }}>
          Verificación local de estructura y consistencia del documento tributario electrónico. No requiere conexión al SII.
        </p>
        <input ref={fileRef} type="file" accept=".xml" onChange={(e) => verificar(e.target.files[0])} style={{ fontSize: 13, width: '100%' }} />
        {cargando && <div style={{ marginTop: 10 }}><span className="spinner dark" /> Verificando…</div>}
      </div>

      {dte && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="card card-pad">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <b style={{ fontSize: 17 }}>{dte.tipo_nombre} · Folio {dte.folio || 's/f'}</b>
                <div className="muted" style={{ fontSize: 13 }}>Emitida el {dte.fecha_emision || '—'}</div>
              </div>
              <span className={`badge ${dte.verificacion_ok ? 'badge-green' : 'badge-amber'}`} style={{ fontSize: 13 }}>
                {dte.verificacion_ok ? '✓ Estructura verificada' : '△ Con observaciones'}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
              <div>
                <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase' }}>Emisor</div>
                <div><b>{dte.razon_social_emisor || '—'}</b></div>
                <div className="muted" style={{ fontSize: 13 }}>{dte.rut_emisor} · {dte.giro_emisor || 'giro no informado'}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase' }}>Receptor</div>
                <div><b>{dte.razon_social_receptor || '—'}</b></div>
                <div className="muted" style={{ fontSize: 13 }}>{dte.rut_receptor}</div>
              </div>
            </div>
            <table className="data" style={{ marginTop: 14 }}>
              <tbody>
                <tr><td className="muted">Neto</td><td className="num">$ {fmtInt(dte.monto_neto)}</td></tr>
                <tr><td className="muted">IVA</td><td className="num">$ {fmtInt(dte.iva)}</td></tr>
                <tr><td><b>Total</b></td><td className="num"><b>$ {fmtInt(dte.monto_total)}</b></td></tr>
              </tbody>
            </table>
          </div>

          <div className="card card-pad">
            <h3 style={{ marginTop: 0 }}>Verificaciones locales</h3>
            <div style={{ display: 'grid', gap: 8 }}>
              {Object.entries(dte.verificaciones).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14 }}>
                  <span className={`badge ${v === true ? 'badge-green' : v === false ? 'badge-red' : 'badge-gray'}`} style={{ minWidth: 34, textAlign: 'center' }}>
                    {v === true ? '✓' : v === false ? '✗' : '—'}
                  </span>
                  {CHECK_LABELS[k] || k}
                </div>
              ))}
            </div>
          </div>

          {dte.items.length > 0 && (
            <div className="card">
              <table className="data">
                <thead><tr><th>Ítem</th><th className="num">Cantidad</th><th className="num">Precio</th><th className="num">Monto</th></tr></thead>
                <tbody>
                  {dte.items.map((it, i) => (
                    <tr key={i}>
                      <td>{it.nombre}{it.descripcion && <div className="muted" style={{ fontSize: 12 }}>{it.descripcion}</div>}</td>
                      <td className="num">{fmt(it.cantidad, 0)} {it.unidad || ''}</td>
                      <td className="num">$ {fmtInt(it.precio)}</td>
                      <td className="num">$ {fmtInt(it.monto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
