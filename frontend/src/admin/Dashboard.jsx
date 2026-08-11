import { useEffect, useState } from 'react';
import { api, fmt, fmtInt, fmtFecha } from '../api.js';
import { Icon } from '../components/icons.jsx';
import { Donut, Serie } from '../components/Charts.jsx';
import { SkeletonCards } from '../components/Skeleton.jsx';

// Flecha de variación % vs. el mes anterior. null (mes anterior en 0)
// no muestra nada — evita un falso "+infinito%".
function Variacion({ v }) {
  if (v === null || v === undefined) return null;
  const sube = v >= 0;
  return (
    <span style={{ fontSize: 12.5, fontWeight: 700, color: sube ? 'var(--green-600)' : '#b91c1c' }}>
      {sube ? '▲' : '▼'} {Math.abs(v)}% <span className="muted" style={{ fontWeight: 400 }}>vs. mes anterior</span>
    </span>
  );
}

const ACCION_LABEL = {
  crear_cliente: 'Cliente creado', crear_cuenta: 'Cuenta creada', crear_usuario: 'Usuario creado',
  reenviar_activacion: 'Activación reenviada', login: 'Inicio de sesión',
  password_reset: 'Contraseña restablecida', password_activacion: 'Cuenta activada',
  eliminar_cliente: 'Cliente eliminado',
};

export default function Dashboard() {
  const [d, setD] = useState(null);
  const [alertas, setAlertas] = useState([]);
  const [cadena, setCadena] = useState(null);
  const [motor, setMotor] = useState(null);
  const [verificacion, setVerificacion] = useState(null); // null | 'cargando' | resultado
  const [compensacion, setCompensacion] = useState(null); // resumen de compensaciones POS | null
  // Sin pasarela conectada, ocultar la tarjeta en vez de mostrar un monto
  // simulado junto a los demás KPI del panel. Ver COMPENSACION_HABILITADA.
  const [compensacionHabilitada, setCompensacionHabilitada] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.dashboard().then(setD).catch((e) => setErr(e.message));
    api.alertasContratos().then((r) => setAlertas(r.alertas)).catch(() => {});
    api.cadenaEstado().then((r) => setCadena(r.estado)).catch(() => {});
    api.posConfig().then((c) => setCompensacionHabilitada(c?.compensacion_habilitada === true)).catch(() => {});
    api.motorEstadisticas().then(setMotor).catch(() => {});
  }, []);

  useEffect(() => {
    if (!compensacionHabilitada) return;
    api.compensacionesResumen().then(setCompensacion).catch(() => {});
  }, [compensacionHabilitada]);

  async function verificarCadena() {
    setVerificacion('cargando');
    try { setVerificacion(await api.cadenaVerificar()); }
    catch (e) { setVerificacion({ valido: false, motivo: e.message }); }
  }

  if (err) return <div className="badge badge-red" style={{ padding: 14 }}>{err}</div>;
  if (!d) return <div><div className="admin-head"><h1>Dashboard</h1></div><SkeletonCards n={4} /></div>;

  const est = d.clientes_por_estado;
  const clientesTotales = (est.piloto || 0) + (est.activo || 0) + (est.vencido || 0);
  const serieMeses = (d.serie_mensual || []).map((m) => ({
    label: new Date(`${m.mes}-01T12:00:00`).toLocaleDateString('es-CL', { month: 'short' }).replace('.', ''),
    value: m.co2e,
  }));

  const motorPropioTotal = motor ? (motor.propio + motor.propio_texto + motor.propio_ocr + motor.propio_revisado) : 0;

  return (
    <div>
      <div className="admin-head"><h1>Dashboard</h1></div>

      <div className="stat-grid">
        <div className="stat">
          <div className="n green">{fmt(d.co2e_mes, 2)}</div>
          <div className="l">t CO2e este mes</div>
          <Variacion v={d.co2e_mes_var} />
        </div>
        <div className="stat">
          <div className="n">{fmtInt(d.sesiones_mes)}</div>
          <div className="l">Sesiones del mes</div>
          <Variacion v={d.sesiones_mes_var} />
        </div>
        <div className="stat">
          <div className="n">{fmtInt(d.facturas_mes)}</div>
          <div className="l">Facturas del mes</div>
          <Variacion v={d.facturas_mes_var} />
        </div>
        <div className="stat">
          <div className="n">{fmtInt(clientesTotales)}</div>
          <div className="l">Clientes totales</div>
          <span className="muted" style={{ fontSize: 12.5 }}>{fmt(d.co2e_acumulado, 1)} t CO2e acumulado</span>
        </div>
      </div>

      <div className="two-col-grid" style={{ marginTop: 20, alignItems: 'stretch' }}>
        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Tendencia — t CO2e por mes (últimos 6 meses)</h3>
          <Serie data={serieMeses} />
        </div>

        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Motor propio vs. externo</h3>
          {motor ? (
            <>
              <Donut
                size={140}
                unit="facturas"
                data={[
                  { label: 'Motor propio', value: motorPropioTotal },
                  { label: 'En cola de revisión', value: motor.revision },
                  { label: 'Motor externo', value: motor.externo },
                ]}
              />
              <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>
                <b style={{ color: 'var(--navy)' }}>{motor.porcentaje_propio}%</b> de independencia del motor externo
                {!motor.motor_externo_activo && <span className="badge badge-green" style={{ marginLeft: 8, fontSize: 11 }}>Motor externo apagado</span>}
              </div>
            </>
          ) : <p className="muted" style={{ fontSize: 13 }}>Cargando…</p>}
        </div>
      </div>

      <div className="two-col-grid" style={{ marginTop: 16, alignItems: 'stretch' }}>
        {cadena && (
          <div className="card card-pad">
            <h3 style={{ marginTop: 0 }}>Cadena de integridad</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span className="badge badge-green">● {fmtInt(cadena.n_eslabones)} eslabón{cadena.n_eslabones === 1 ? '' : 'es'}</span>
              <span className="muted" style={{ fontSize: 13 }}>hash SHA-256 encadenado por documento, interno</span>
              <button className="btn btn-outline btn-sm" onClick={verificarCadena} disabled={verificacion === 'cargando'}>
                {verificacion === 'cargando' ? <span className="spinner" /> : 'Verificar cadena completa'}
              </button>
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 10, fontFamily: 'monospace', wordBreak: 'break-all' }}>
              Último hash: {cadena.ultimo_hash}
            </div>
            {verificacion && verificacion !== 'cargando' && (
              <div className={`badge ${verificacion.valido ? 'badge-green' : 'badge-red'}`} style={{ display: 'inline-block', marginTop: 10 }}>
                {verificacion.valido
                  ? `✓ Cadena íntegra — ${fmtInt(verificacion.total_eslabones)} eslabones verificados`
                  : `⚠ Cadena rota en factura ${verificacion.rompe_en || '?'} (${verificacion.motivo || 'error'})`}
              </div>
            )}
          </div>
        )}

        {compensacionHabilitada && (
          <div className="card card-pad">
            <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Icon.Leaf size={18} /> Compensación (simulada)
              <span className="badge badge-amber" style={{ fontSize: 11 }}>Pago simulado — sin pasarela</span>
            </h3>
            {compensacion ? (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--navy)' }}>
                    ${fmtInt(compensacion.total_monto_clp)} <small style={{ fontSize: 14, fontWeight: 600 }}>CLP</small>
                  </div>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {fmtInt(compensacion.n)} trámite{Number(compensacion.n) === 1 ? '' : 's'} ·{' '}
                    {fmt(compensacion.total_t_co2e, 3)} t CO2e
                  </span>
                </div>
                {compensacion.por_estado && Object.keys(compensacion.por_estado).length > 0 && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                    {Object.entries(compensacion.por_estado).map(([estado, n]) => (
                      <span key={estado} className="badge badge-gray">{estado}: {fmtInt(n)}</span>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                Aún no hay compensaciones registradas desde el panel de terreno o el flujo web.
              </p>
            )}
            <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
              Los cobros son simulados: no hay pasarela de pago ni convenio de compensación activos todavía.
              Estos montos son registro operativo, no dinero recaudado.
            </p>
          </div>
        )}
      </div>

      <div className="two-col-grid" style={{ marginTop: 16, alignItems: 'stretch' }}>
        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Actividad reciente</h3>
          {(d.actividad_reciente || []).length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {d.actividad_reciente.map((a, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, paddingBottom: 8, borderBottom: i < d.actividad_reciente.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <span>{ACCION_LABEL[a.accion] || a.accion}{a.usuario_email ? ` · ${a.usuario_email}` : ''}</span>
                  <span className="muted" style={{ whiteSpace: 'nowrap' }}>{fmtFecha(a.created_at)}</span>
                </div>
              ))}
            </div>
          ) : <p className="muted" style={{ fontSize: 13 }}>Sin actividad registrada todavía.</p>}
        </div>

        <div className="card card-pad">
          <h3 style={{ marginTop: 0 }}>Motor externo</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className={`badge ${d.simple_api.ok ? 'badge-green' : 'badge-red'}`}>
              {d.simple_api.ok ? '● Operativo' : '● Sin conexión'}
            </span>
            <span className="badge badge-gray">{d.simple_api.mock ? 'Modo MOCK' : 'Producción'}</span>
            {d.simple_api.latencia_ms != null && <span className="muted" style={{ fontSize: 13 }}>{d.simple_api.latencia_ms} ms</span>}
          </div>
          <div style={{ marginTop: 14 }} className="muted">
            Consumo del mes: <b>{fmtInt(d.consumo_api_mes.llamadas)}</b> llamadas ·
            costo estimado <b>${fmtInt(Math.round(d.consumo_api_mes.costo))} CLP</b>
          </div>
          <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span className="badge badge-gray">Piloto: {fmtInt(est.piloto || 0)}</span>
            <span className="badge badge-green">Activo: {fmtInt(est.activo || 0)}</span>
            <span className="badge badge-red">Vencido: {fmtInt(est.vencido || 0)}</span>
          </div>
        </div>
      </div>

      {alertas.length > 0 && (
        <div className="card card-pad" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8, color: '#b45309' }}><Icon.Alert size={18} /> <span style={{ color: 'var(--navy)' }}>Contratos por vencer / vencidos</span></h3>
          <div className="table-scroll">
          <table className="data">
            <thead><tr><th>Empresa</th><th>Estado</th><th>Vence</th><th className="num">Días</th></tr></thead>
            <tbody>
              {alertas.map((a) => (
                <tr key={a.id}>
                  <td>{a.nombre_empresa}</td>
                  <td><span className="badge badge-gray">{a.estado_contrato}</span></td>
                  <td>{fmtFecha(a.fecha_fin)}</td>
                  <td className="num">{a.dias_restantes < 0 ? `Vencido hace ${-a.dias_restantes}` : a.dias_restantes}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
