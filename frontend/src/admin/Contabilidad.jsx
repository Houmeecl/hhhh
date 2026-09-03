import { useEffect, useMemo, useState } from 'react';
import { api, fmt, fmtFecha } from '../api.js';

const TIPOS = ['activo', 'pasivo', 'patrimonio', 'ingreso', 'costo', 'gasto'];
const ROLES_BANCARIOS = ['caja','cuentas_cobrar','inventario','activo_corriente','activo_no_corriente','pasivo_corriente','deuda_financiera','patrimonio','ingreso','costo','gasto','otro'];
const hoy = new Date().toISOString().slice(0, 10);
const lineaVacia = () => ({ cuenta_id: '', debito: '', haber: '', glosa: '' });

export default function Contabilidad() {
  const [clientes, setClientes] = useState([]);
  const [clienteId, setClienteId] = useState('');
  const [cuentas, setCuentas] = useState([]);
  const [periodos, setPeriodos] = useState([]);
  const [periodoId, setPeriodoId] = useState('');
  const [asientos, setAsientos] = useState([]);
  const [balance, setBalance] = useState(null);
  const [riesgo, setRiesgo] = useState(null);
  const [vinculosCbam, setVinculosCbam] = useState([]);
  const [lotesCbam, setLotesCbam] = useState([]);
  const [mensaje, setMensaje] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [cuenta, setCuenta] = useState({ codigo: '', nombre: '', tipo: 'activo', rol_bancario: 'otro' });
  const [periodo, setPeriodo] = useState({ nombre: new Date().getFullYear().toString(), desde: `${new Date().getFullYear()}-01-01`, hasta: `${new Date().getFullYear()}-12-31` });
  const [asiento, setAsiento] = useState({ fecha: hoy, glosa: '', referencia: '', lineas: [lineaVacia(), lineaVacia()] });
  const [vinculoCbam, setVinculoCbam] = useState({ lote_id: '', relacion: 'titular_lote', referencia_respaldo: '', observaciones: '' });

  const avisar = (texto, error = false) => setMensaje({ texto, error });
  const cargarBase = async (id) => {
    if (!id) { setCuentas([]); setPeriodos([]); setPeriodoId(''); setVinculosCbam([]); return; }
    try {
      const [c, p, v, l] = await Promise.all([api.contabilidadCuentas(id), api.contabilidadPeriodos(id), api.contabilidadLotesCbam(id), api.lotesCbamDisponibles()]);
      setCuentas(c.cuentas || []); setPeriodos(p.periodos || []); setVinculosCbam(v.vinculos || []); setLotesCbam(l.lotes || []); setPeriodoId((actual) => p.periodos?.some((x) => x.id === actual) ? actual : (p.periodos?.[0]?.id || ''));
    } catch (e) { avisar(e.message, true); }
  };
  const cargarPeriodo = async () => {
    if (!clienteId || !periodoId) { setAsientos([]); setBalance(null); setRiesgo(null); return; }
    try {
      const [a, b, r] = await Promise.all([api.asientosContables(clienteId, periodoId), api.balanceContable(clienteId, periodoId), api.riesgoFinanciero(clienteId, periodoId)]);
      setAsientos(a.asientos || []); setBalance(b); setRiesgo(r);
    } catch (e) { avisar(e.message, true); }
  };
  useEffect(() => { api.contabilidadClientes().then((r) => setClientes(r.clientes || [])).catch((e) => avisar(e.message, true)); }, []);
  useEffect(() => { cargarBase(clienteId); }, [clienteId]);
  useEffect(() => { cargarPeriodo(); }, [clienteId, periodoId]);

  const total = useMemo(() => asiento.lineas.reduce((a, l) => ({ debito: a.debito + Number(l.debito || 0), haber: a.haber + Number(l.haber || 0) }), { debito: 0, haber: 0 }), [asiento.lineas]);
  const cuadrado = Math.round(total.debito * 100) === Math.round(total.haber * 100) && total.debito > 0;
  const actualizarLinea = (indice, campo, valor) => setAsiento((a) => ({ ...a, lineas: a.lineas.map((l, i) => i === indice ? { ...l, [campo]: valor } : l) }));

  async function crearPlanBase() {
    if (!clienteId) return avisar('Selecciona una empresa.', true);
    setCargando(true); try { const r = await api.crearPlanCuentasBase(clienteId); avisar(`${r.creadas?.length || 0} cuentas base incorporadas.`); await cargarBase(clienteId); } catch (e) { avisar(e.message, true); } finally { setCargando(false); }
  }
  async function crearCuenta(e) {
    e.preventDefault(); setCargando(true); try { await api.crearCuentaContable({ cliente_id: clienteId, ...cuenta }); setCuenta({ codigo: '', nombre: '', tipo: 'activo', rol_bancario: 'otro' }); avisar('Cuenta creada.'); await cargarBase(clienteId); } catch (err) { avisar(err.message, true); } finally { setCargando(false); }
  }
  async function crearPeriodo(e) {
    e.preventDefault(); setCargando(true); try { const r = await api.crearPeriodoContable({ cliente_id: clienteId, ...periodo }); avisar('Período abierto.'); await cargarBase(clienteId); setPeriodoId(r.periodo.id); } catch (err) { avisar(err.message, true); } finally { setCargando(false); }
  }
  async function registrarAsiento(e) {
    e.preventDefault(); if (!cuadrado) return avisar('El asiento debe cuadrar antes de registrarlo.', true);
    setCargando(true); try { await api.crearAsientoContable({ cliente_id: clienteId, periodo_id: periodoId, ...asiento }); setAsiento({ fecha: hoy, glosa: '', referencia: '', lineas: [lineaVacia(), lineaVacia()] }); avisar('Asiento registrado e inmovilizado.'); await cargarPeriodo(); } catch (err) { avisar(err.message, true); } finally { setCargando(false); }
  }
  async function crearVinculoCbam(e) {
    e.preventDefault();
    if (!clienteId || !vinculoCbam.lote_id) return avisar('Selecciona un lote y registra su referencia de respaldo.', true);
    setCargando(true);
    try {
      await api.vincularLoteCbam({ cliente_id: clienteId, ...vinculoCbam });
      setVinculoCbam({ lote_id: '', relacion: 'titular_lote', referencia_respaldo: '', observaciones: '' });
      avisar('Vínculo CBAM registrado con su respaldo.'); await cargarBase(clienteId); await cargarPeriodo();
    } catch (err) { avisar(err.message, true); } finally { setCargando(false); }
  }
  async function revocarVinculoCbam(vinculo) {
    const motivo = window.prompt(`Motivo para revocar el vínculo ${vinculo.codigo}:`);
    if (!motivo) return;
    setCargando(true);
    try { await api.revocarVinculoLoteCbam(clienteId, vinculo.vinculo_id, motivo); avisar('Vínculo revocado conservando su trazabilidad.'); await cargarBase(clienteId); await cargarPeriodo(); }
    catch (err) { avisar(err.message, true); } finally { setCargando(false); }
  }

  return <div>
    <h1>Contabilidad financiera</h1>
    <p className="muted" style={{ maxWidth: 850 }}>Libro privado de doble partida para cada empresa. Es independiente de la contabilidad de carbono y del capital natural. Los asientos registrados no se editan: una corrección se hace con un nuevo asiento de reversa.</p>
    {mensaje && <div className={`badge ${mensaje.error ? 'badge-red' : 'badge-green'}`} style={{ display: 'block', margin: '16px 0', padding: 12 }}>{mensaje.texto}</div>}

    <div className="card card-pad" style={{ marginTop: 18 }}>
      <div className="field" style={{ maxWidth: 480 }}><label htmlFor="cont-cliente">Empresa</label><select id="cont-cliente" value={clienteId} onChange={(e) => setClienteId(e.target.value)}><option value="">Selecciona una empresa…</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre_empresa} · {c.rut}</option>)}</select></div>
      {!clienteId && <p className="muted">Elige una empresa para abrir su libro contable.</p>}
    </div>

    {clienteId && <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 16, marginTop: 16 }}>
        <div className="card card-pad"><h2 style={{ marginTop: 0 }}>1. Plan de cuentas</h2><p className="muted">Usa un plan base como punto de partida o agrega tus cuentas.</p><button className="btn btn-outline" disabled={cargando} onClick={crearPlanBase}>Incorporar plan base</button>
          <form onSubmit={crearCuenta} style={{ marginTop: 14 }}><div className="field"><label>Código</label><input required value={cuenta.codigo} onChange={(e) => setCuenta({ ...cuenta, codigo: e.target.value })} placeholder="Ej. 1103" /></div><div className="field"><label>Nombre</label><input required value={cuenta.nombre} onChange={(e) => setCuenta({ ...cuenta, nombre: e.target.value })} placeholder="Ej. Anticipos" /></div><div className="field"><label>Tipo</label><select value={cuenta.tipo} onChange={(e) => setCuenta({ ...cuenta, tipo: e.target.value })}>{TIPOS.map((t) => <option key={t}>{t}</option>)}</select></div><div className="field"><label>Rol para ficha financiera</label><select value={cuenta.rol_bancario} onChange={(e) => setCuenta({ ...cuenta, rol_bancario: e.target.value })}>{ROLES_BANCARIOS.map((t) => <option key={t}>{t.replaceAll('_', ' ')}</option>)}</select></div><button className="btn btn-primary" disabled={cargando}>Agregar cuenta</button></form>
        </div>
        <div className="card card-pad"><h2 style={{ marginTop: 0 }}>2. Período contable</h2><form onSubmit={crearPeriodo}><div className="field"><label>Nombre</label><input required value={periodo.nombre} onChange={(e) => setPeriodo({ ...periodo, nombre: e.target.value })} placeholder="2026" /></div><div className="field"><label>Desde</label><input required type="date" value={periodo.desde} onChange={(e) => setPeriodo({ ...periodo, desde: e.target.value })} /></div><div className="field"><label>Hasta</label><input required type="date" value={periodo.hasta} onChange={(e) => setPeriodo({ ...periodo, hasta: e.target.value })} /></div><button className="btn btn-primary" disabled={cargando}>Abrir período</button></form>
          <div className="field" style={{ marginTop: 18 }}><label>Período activo</label><select value={periodoId} onChange={(e) => setPeriodoId(e.target.value)}><option value="">Selecciona un período…</option>{periodos.map((p) => <option key={p.id} value={p.id}>{p.nombre} · {p.estado}</option>)}</select></div>
        </div>
      </div>

      <div className="card card-pad" style={{ marginTop: 16 }}><h2 style={{ marginTop: 0 }}>3. Registrar asiento</h2>
        {!cuentas.length ? <p className="muted">Primero incorpora o crea las cuentas de esta empresa.</p> : !periodoId ? <p className="muted">Selecciona un período abierto.</p> : <form onSubmit={registrarAsiento}>
          <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr 220px', gap: 12 }}><div className="field"><label>Fecha</label><input type="date" required value={asiento.fecha} onChange={(e) => setAsiento({ ...asiento, fecha: e.target.value })} /></div><div className="field"><label>Glosa</label><input required value={asiento.glosa} onChange={(e) => setAsiento({ ...asiento, glosa: e.target.value })} placeholder="Descripción del hecho económico" /></div><div className="field"><label>Referencia</label><input value={asiento.referencia} onChange={(e) => setAsiento({ ...asiento, referencia: e.target.value })} placeholder="Folio, OC o respaldo" /></div></div>
          <div className="table-scroll"><table className="data" style={{ marginTop: 12 }}><thead><tr><th>Cuenta</th><th>Glosa línea</th><th className="num">Débito</th><th className="num">Haber</th><th /></tr></thead><tbody>{asiento.lineas.map((l, i) => <tr key={i}><td><select value={l.cuenta_id} onChange={(e) => actualizarLinea(i, 'cuenta_id', e.target.value)} required><option value="">Cuenta…</option>{cuentas.filter((c) => c.activa).map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}</select></td><td><input value={l.glosa} onChange={(e) => actualizarLinea(i, 'glosa', e.target.value)} /></td><td><input type="number" min="0" step="0.01" value={l.debito} onChange={(e) => actualizarLinea(i, 'debito', e.target.value)} /></td><td><input type="number" min="0" step="0.01" value={l.haber} onChange={(e) => actualizarLinea(i, 'haber', e.target.value)} /></td><td>{asiento.lineas.length > 2 && <button type="button" className="btn btn-outline btn-sm" onClick={() => setAsiento({ ...asiento, lineas: asiento.lineas.filter((_, x) => x !== i) })}>Quitar</button>}</td></tr>)}</tbody></table></div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}><button type="button" className="btn btn-outline" onClick={() => setAsiento({ ...asiento, lineas: [...asiento.lineas, lineaVacia()] })}>+ Línea</button><span className={cuadrado ? 'badge badge-green' : 'badge badge-red'}>Débito {fmt(total.debito, 2)} · Haber {fmt(total.haber, 2)} {cuadrado ? '· Cuadra' : '· No cuadra'}</span><button className="btn btn-primary" disabled={cargando || !cuadrado}>Registrar asiento</button></div>
        </form>}
      </div>

      <div className="card card-pad" style={{ marginTop: 16 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}><div><h2 style={{ margin: 0 }}>Balance de comprobación</h2><p className="muted" style={{ marginBottom: 0 }}>Saldos construidos únicamente desde los asientos del período seleccionado.</p></div>{balance && <button className="btn btn-outline" onClick={() => api.abrirBalanceContablePdf(clienteId, periodoId)}>Descargar PDF</button>}</div>
        {!balance ? <p className="muted">Selecciona un período para ver el balance.</p> : <div className="table-scroll"><table className="data" style={{ marginTop: 14 }}><thead><tr><th>Cuenta</th><th>Tipo</th><th className="num">Débito</th><th className="num">Haber</th><th className="num">Saldo deudor</th><th className="num">Saldo acreedor</th></tr></thead><tbody>{balance.cuentas.map((c) => <tr key={c.id}><td><b>{c.codigo}</b> · {c.nombre}</td><td><span className="badge badge-gray">{c.tipo}</span></td><td className="num">{fmt(c.debito, 2)}</td><td className="num">{fmt(c.haber, 2)}</td><td className="num">{fmt(c.saldo_deudor, 2)}</td><td className="num">{fmt(c.saldo_acreedor, 2)}</td></tr>)}<tr><td colSpan={2}><b>Totales</b></td><td className="num"><b>{fmt(balance.totales.debito, 2)}</b></td><td className="num"><b>{fmt(balance.totales.haber, 2)}</b></td><td className="num"><b>{fmt(balance.totales.saldo_deudor, 2)}</b></td><td className="num"><b>{fmt(balance.totales.saldo_acreedor, 2)}</b></td></tr></tbody></table></div>}
      </div>

      <div className="card card-pad" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>Perfil para analista financiero</h2>
        <p className="muted">Indicadores automáticos desde el mismo libro y sus referencias. Es una ficha de información para evaluación; no es una aprobación, clasificación de riesgo ni decisión de crédito.</p>
        {!riesgo ? <p className="muted">Selecciona un período para calcular el perfil.</p> : <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}><span className={`badge ${riesgo.estado === 'informacion_estructurada' ? 'badge-green' : riesgo.estado === 'requiere_revision' ? 'badge-red' : 'badge-gray'}`}>{riesgo.estado.replaceAll('_', ' ')}</span><span className="badge badge-gray">Respaldo {fmt((riesgo.metricas.cobertura_respaldo || 0) * 100, 1)}%</span><span className="badge badge-gray">{riesgo.metricas.n_asientos} asientos</span></div>
          <div className="table-scroll"><table className="data"><tbody><tr><td>Activos corrientes registrados</td><td className="num">{fmt(riesgo.metricas.activos_corrientes, 2)}</td></tr><tr><td>Pasivos corrientes registrados</td><td className="num">{fmt(riesgo.metricas.pasivos_corrientes, 2)}</td></tr><tr><td>Razón de liquidez</td><td className="num">{riesgo.metricas.razon_liquidez == null ? 'Sin base suficiente' : fmt(riesgo.metricas.razon_liquidez, 2)}</td></tr><tr><td>Deuda financiera / patrimonio</td><td className="num">{riesgo.metricas.deuda_patrimonio == null ? 'Sin base suficiente' : fmt(riesgo.metricas.deuda_patrimonio, 2)}</td></tr><tr><td>Resultado del período registrado</td><td className="num">{fmt(riesgo.metricas.resultado_periodo, 2)}</td></tr></tbody></table></div>
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border,#ddd)' }}><h3 style={{ margin: '0 0 6px' }}>Exposición CBAM vinculada</h3><p className="muted" style={{ marginTop: 0 }}>{riesgo.exposicion_cbam?.mensaje}</p><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><span className={`badge ${riesgo.exposicion_cbam?.estado === 'informacion_estructurada' ? 'badge-green' : riesgo.exposicion_cbam?.estado === 'requiere_revision' ? 'badge-red' : 'badge-gray'}`}>{riesgo.exposicion_cbam?.estado?.replaceAll('_', ' ')}</span><span className="badge badge-gray">{riesgo.exposicion_cbam?.metricas?.lotes_cbam_aplicables || 0} lotes aplicables</span><span className="badge badge-gray">{riesgo.exposicion_cbam?.metricas?.lotes_cbam_pendientes || 0} pendientes</span></div>{riesgo.exposicion_cbam?.faltantes?.length ? <p className="muted">Campos pendientes: {riesgo.exposicion_cbam.faltantes.join(', ')}.</p> : null}<p className="muted" style={{ fontSize: 12 }}>{riesgo.exposicion_cbam?.limitacion}</p></div>
          {riesgo.alertas.length ? <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>{riesgo.alertas.map((a) => <div key={a.codigo} className={`badge ${a.nivel === 'alto' ? 'badge-red' : 'badge-gray'}`} style={{ display: 'block', padding: 10 }}><b>{a.codigo.replaceAll('_', ' ')}</b> · {a.texto}</div>)}</div> : <p className="badge badge-green" style={{ display: 'inline-block', marginTop: 14 }}>Sin alertas automáticas bajo las reglas configuradas.</p>}
        </>}
      </div>

      <div className="card card-pad" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>Vínculos empresa–lote CBAM</h2>
        <p className="muted">Asocia solo un lote cuya relación con esta empresa fue revisada por SICR3P. El vínculo conserva la referencia utilizada; no modifica el lote ni transforma datos declarados en una certificación.</p>
        <form onSubmit={crearVinculoCbam} style={{ display: 'grid', gridTemplateColumns: 'minmax(260px,2fr) minmax(160px,1fr) minmax(220px,1fr) auto', gap: 12, alignItems: 'end' }}>
          <div className="field"><label>Lote de origen</label><select required value={vinculoCbam.lote_id} onChange={(e) => setVinculoCbam({ ...vinculoCbam, lote_id: e.target.value })}><option value="">Selecciona un lote…</option>{lotesCbam.map((l) => <option key={l.id} value={l.id}>{l.codigo} · {l.material} · NC {l.codigo_nc || 'pendiente'} · {l.cbam?.aplicable ? (l.cbam?.listo ? 'CBAM documentado' : 'CBAM pendiente') : 'fuera del alcance configurado'}</option>)}</select></div>
          <div className="field"><label>Relación confirmada</label><select value={vinculoCbam.relacion} onChange={(e) => setVinculoCbam({ ...vinculoCbam, relacion: e.target.value })}><option value="titular_lote">Titular del lote</option><option value="operador_instalacion">Operador instalación</option><option value="exportador">Exportador</option><option value="financiado">Empresa financiada</option></select></div>
          <div className="field"><label>Referencia de respaldo</label><input required minLength="3" value={vinculoCbam.referencia_respaldo} onChange={(e) => setVinculoCbam({ ...vinculoCbam, referencia_respaldo: e.target.value })} placeholder="Contrato, OC o expediente" /></div>
          <button className="btn btn-primary" disabled={cargando}>Vincular</button>
        </form>
        <div className="field" style={{ marginTop: 10 }}><label>Observación opcional</label><input value={vinculoCbam.observaciones} onChange={(e) => setVinculoCbam({ ...vinculoCbam, observaciones: e.target.value })} placeholder="Alcance del vínculo revisado" /></div>
        {!vinculosCbam.length ? <p className="muted">Aún no hay lotes vinculados a esta empresa.</p> : <div className="table-scroll"><table className="data"><thead><tr><th>Lote</th><th>Relación</th><th>Estado CBAM</th><th>Respaldo</th><th /></tr></thead><tbody>{vinculosCbam.map((v) => <tr key={v.vinculo_id}><td><b>{v.codigo}</b><div className="muted">NC {v.codigo_nc || 'pendiente'} · {v.faena_origen || 'instalación pendiente'}</div></td><td>{v.relacion.replaceAll('_', ' ')}</td><td><span className={`badge ${v.cbam?.listo ? 'badge-green' : 'badge-gray'}`}>{v.cbam?.aplicable ? (v.cbam?.listo ? 'documentado' : `pendiente: ${v.cbam?.faltantes?.join(', ')}`) : 'no aplicable configurado'}</span></td><td>{v.referencia_respaldo}</td><td><button type="button" className="btn btn-outline btn-sm" disabled={cargando} onClick={() => revocarVinculoCbam(v)}>Revocar</button></td></tr>)}</tbody></table></div>}
      </div>

      <div className="card card-pad" style={{ marginTop: 16 }}><h2 style={{ marginTop: 0 }}>Asientos del período</h2>{!asientos.length ? <p className="muted">Aún no hay asientos registrados.</p> : <div className="table-scroll"><table className="data"><thead><tr><th>N°</th><th>Fecha</th><th>Glosa</th><th>Referencia</th><th>Integridad</th></tr></thead><tbody>{asientos.map((a) => <tr key={a.id}><td>{a.numero}</td><td>{fmtFecha(a.fecha)}</td><td>{a.glosa}<div className="muted" style={{ fontSize: 12 }}>{a.lineas?.map((l) => `${l.cuenta_codigo}: ${Number(l.debito) ? `D ${fmt(l.debito, 2)}` : `H ${fmt(l.haber, 2)}`}`).join(' · ')}</div></td><td>{a.referencia || '—'}</td><td><code title={a.hash_asiento}>{String(a.hash_asiento).slice(0, 12)}…</code></td></tr>)}</tbody></table></div>}</div>
    </>}
  </div>;
}
